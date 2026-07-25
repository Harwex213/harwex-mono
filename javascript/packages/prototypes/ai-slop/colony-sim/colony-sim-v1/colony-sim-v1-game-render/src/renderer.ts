import { Application, Container, Sprite, type Texture } from "pixi.js";
import {
  DEFAULT_PLAYER,
  type Dispatcher,
  type EntityId,
  type GameView,
  type PointerHandlers,
  type Position,
  selection,
  type Selection,
  Terrain,
  TILE_SIZE,
  tileIndex,
  type World,
} from "@hw/colony-sim-v1-core";
import { createLayers, type Layers } from "./layers";
import { Camera } from "./camera";
import { buildGround } from "./ground";
import { HOVER_STYLE, Marker, SELECTION_STYLE } from "./selection";
import { type Creature, Facing, sheets, TREE_VARIANTS } from "./textures";
import type { WaterSurface } from "./water";

const ANIM_TICKS_PER_FRAME = 2; // 10 ticks/s ÷ 2 = 5 fps walk cycle

// Feet on the tile point rather than the body centre, so y-sorting matches where
// the creature actually stands. The two sheets draw their feet at different
// heights inside the 16px frame, hence two values.
const CHICKEN_ANCHOR_Y = 0.6;
const COLONIST_ANCHOR_Y = 0.85;

// Trees.png frame 0 is a bare stump, kept for a future harvested state; the
// canopies follow it.
const TREE_CANOPIES = TREE_VARIANTS - 1;
// Trunk base sits on the entity's tile point, canopy grows up from it.
const TREE_ANCHOR_Y = 0.85;

// Rocks.png rows are tints; only the first two are in play here.
const ROCK_TINT_BARE = 0;
const ROCK_TINT_MOSSY = 1; // the sheet's yellow-green moss row, matching the grass
// A boulder sits on its tile rather than standing on it, so it hugs the point
// more closely than a tree does.
const ROCK_ANCHOR_Y = 0.65;

// A dropped stack lies flat on the ground, so its frame is centred on the tile
// point instead of standing above it.
const ITEM_ANCHOR_Y = 0.6;

// Owns the pixi view tree and reconciles it against the World every frame:
// spawn sprites for new entities, drop stale ones, lerp positions between ticks.
// This is core's GameView: world in, pixels out, nothing written back.
class GameRenderer implements GameView {
  readonly camera: Camera;
  private layers: Layers;
  private water: WaterSurface;
  private marker: Marker;
  private hoverMarker: Marker;
  // What a click would take right now, as resolved by the engine. View-only: it
  // never reaches the World and never goes into a signal — the DOM HUD does not
  // draw it, and repainting the HUD on every pointer move would be wasteful.
  private hovered: Selection | null = null;
  private sprites = new Map<EntityId, Container>();
  // Animated subset of `sprites`, plus the facing derived from their movement.
  // Both are view-only state: nothing here is persisted.
  private creatures = new Map<EntityId, { sprite: Sprite; sheet: Creature }>();
  private facings = new Map<EntityId, Facing>();

  constructor(app: Application, world: World, commands: Dispatcher, handlers: PointerHandlers) {
    this.layers = createLayers();
    app.stage.addChild(this.layers.root);
    this.camera = new Camera(app, this.layers.root, commands, handlers);
    // The camera's own default is the middle of the grid, which is only the
    // right guess for a map that put the colony there. On a map that did not
    // (the divided lands sit their colony well off-centre) the first frame would
    // open on empty ground.
    this.camera.centerOn(world.stockpile.x, world.stockpile.y);
    const ground = buildGround(world);
    this.water = ground.water;
    this.layers.ground.addChild(ground.layer);
    // Hover first so the selection brackets stay on top where the two overlap.
    this.hoverMarker = new Marker(this.layers.fx, HOVER_STYLE);
    this.marker = new Marker(this.layers.fx, SELECTION_STYLE);
  }

  // Hover feedback is a view concern, so the engine only says *what* is under the
  // cursor and the renderer decides how it looks — marker plus cursor shape.
  setHover(target: Selection | null): void {
    this.hovered = target;
    this.camera.setHoverKind(target ? target.kind : null);
  }

  render(world: World, alpha: number): void {
    this.reconcile(world);
    for (const [id, sprite] of this.sprites) {
      const cur = world.positions.get(id);
      const prev = world.prevPositions.get(id) ?? cur;
      if (!cur || !prev) {
        continue;
      }
      const x = prev.x + (cur.x - prev.x) * alpha;
      const y = prev.y + (cur.y - prev.y) * alpha;
      sprite.x = x * TILE_SIZE;
      sprite.y = y * TILE_SIZE;
      sprite.zIndex = y;
    }
    this.animate(world, alpha);
    const selected = selection.value;
    this.place(this.marker, selected);
    // Two markers on the same thing would just darken it; the selection already
    // says everything the hover would.
    this.place(this.hoverMarker, sameTarget(this.hovered, selected) ? null : this.hovered);
  }

  // The selection marker mirrors the `selection` signal — the same UI state the
  // DOM panel reads, so canvas and HUD can never disagree about what is selected.
  private place(marker: Marker, target: Selection | null): void {
    if (!target) {
      marker.hide();
      return;
    }
    if (target.kind === "tile") {
      marker.atTile(target.x, target.y);
      return;
    }
    const sprite = this.sprites.get(target.id);
    if (!sprite) {
      marker.hide();
      return;
    }
    marker.atSprite(sprite);
  }

  // Pick the sheet frame per creature, and advance the water shader. Both run on
  // the sim clock rather than wall clock, so pause freezes them and 2×/3× speeds
  // them up for free. A sheet frame is a whole tick's worth of animation; the water
  // is a continuous surface, so it gets the interpolated clock instead of stepping
  // at 10 fps under a 60 fps picture.
  private animate(world: World, alpha: number): void {
    this.water.setPhase(world.tick + alpha);
    for (const [id, actor] of this.creatures) {
      const cur = world.positions.get(id);
      const prev = world.prevPositions.get(id);
      if (!cur || !prev) {
        continue;
      }
      const facing = deriveFacing(prev, cur, this.facings.get(id) ?? Facing.Down);
      this.facings.set(id, facing);
      // Having a path is what "moving" means here: the sim clears it on arrival,
      // so the cycle stops on the same tick the entity does.
      if (!world.paths.has(id)) {
        actor.sprite.texture = actor.sheet.stand[facing];
        continue;
      }
      const cycle = actor.sheet.walk[facing];
      actor.sprite.texture = cycle[Math.floor(world.tick / ANIM_TICKS_PER_FRAME) % cycle.length];
    }
  }

  private reconcile(world: World): void {
    for (const id of world.entities) {
      if (!this.sprites.has(id)) {
        this.createSprite(world, id);
      }
    }
    for (const [id, sprite] of this.sprites) {
      if (!world.entities.has(id)) {
        sprite.destroy();
        this.sprites.delete(id);
        this.creatures.delete(id);
        this.facings.delete(id);
      }
    }
  }

  // Everything on the map comes from the 16px sheets; which one is decided by the
  // component that makes the entity what it is.
  private createSprite(world: World, id: EntityId): void {
    if (world.animals.has(id)) {
      this.createCreature(id, sheets().chicken, CHICKEN_ANCHOR_Y);
      return;
    }

    if (world.trees.has(id)) {
      // Canopy variant from the entity id: a view-only detail, so it stays out of
      // the save yet never changes for a given tree.
      const sprite = new Sprite(sheets().trees[1 + (id % TREE_CANOPIES)]);
      sprite.anchor.set(0.5, TREE_ANCHOR_Y);
      this.layers.objects.addChild(sprite);
      this.sprites.set(id, sprite);
      return;
    }

    if (world.rocks.has(id)) {
      const sprite = new Sprite(rockTexture(world, id));
      sprite.anchor.set(0.5, ROCK_ANCHOR_Y);
      this.layers.objects.addChild(sprite);
      this.sprites.set(id, sprite);
      return;
    }

    // Dropped stacks belong to the object layer, y-sorted against the trees and
    // boulders around them — creatures live a layer above and pass over a pile
    // either way, which is what walking over loot should look like.
    const item = world.items.get(id);
    if (item) {
      const sprite = new Sprite(sheets().items[item.kind]);
      sprite.anchor.set(0.5, ITEM_ANCHOR_Y);
      this.layers.objects.addChild(sprite);
      this.sprites.set(id, sprite);
      return;
    }

    // Which worker sheet a colonist draws from is the one thing about its art that
    // comes from the world rather than from its id: teams have to stay apart across
    // a reload, and a colonist that changed hands has to change colour with it.
    // An unowned colonist is a spawner bug, not a state to draw as sheet-less.
    this.createCreature(id, sheets().colonists[world.owners.get(id) ?? DEFAULT_PLAYER], COLONIST_ANCHOR_Y);
  }

  // Creatures are the animated entities: one sprite plus the sheet it draws from,
  // so animate() needs to know nothing about what kind of creature it is.
  private createCreature(id: EntityId, sheet: Creature, anchorY: number): void {
    const sprite = new Sprite(sheet.stand[Facing.Down]);
    sprite.anchor.set(0.5, anchorY);
    this.layers.entities.addChild(sprite);
    this.sprites.set(id, sprite);
    this.creatures.set(id, { sprite, sheet });
  }
}

function sameTarget(a: Selection | null, b: Selection | null): boolean {
  if (!a || !b || a.kind !== b.kind) {
    return false;
  }
  if (a.kind === "entity" && b.kind === "entity") {
    return a.id === b.id;
  }
  if (a.kind === "tile" && b.kind === "tile") {
    return a.x === b.x && a.y === b.y;
  }
  return false;
}

// Size and tint of a boulder: derived from its id and the ground beneath it, so
// they stay out of the save yet never change for a given rock. Bare stone on high
// ground; on grass, half the boulders grow moss.
function rockTexture(world: World, id: EntityId): Texture {
  const { rocks } = sheets();
  const pos = world.positions.get(id);
  const terrain = pos
    ? world.grid.terrain[tileIndex(world.grid, Math.round(pos.x), Math.round(pos.y))]
    : Terrain.Rock;
  const hash = hashId(id);
  const tint = terrain !== Terrain.Rock && hash % 2 === 0 ? ROCK_TINT_MOSSY : ROCK_TINT_BARE;
  return rocks[tint][(hash >>> 8) % rocks[tint].length];
}

// Entity ids run sequentially and have no bit spread of their own; one mixing
// round gives the derived picks something to slice.
function hashId(id: number): number {
  let h = Math.imul(id ^ 0x9e3779b1, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// Facing comes from the last tick's movement; standing still keeps the previous
// direction instead of snapping back to a default.
function deriveFacing(prev: Position, cur: Position, last: Facing): Facing {
  const dx = cur.x - prev.x;
  const dy = cur.y - prev.y;
  if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) {
    return last;
  }
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? Facing.Right : Facing.Left;
  }
  return dy > 0 ? Facing.Down : Facing.Up;
}

export { GameRenderer };
