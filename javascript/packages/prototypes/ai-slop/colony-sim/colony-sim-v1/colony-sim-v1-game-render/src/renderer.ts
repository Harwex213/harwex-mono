import { Application, Container, Sprite, type Texture } from "pixi.js";
import {
  type Building,
  buildOrder,
  DEFAULT_PLAYER,
  type EntityId,
  type GameView,
  type PlayerId,
  type Position,
  selection,
  type Selection,
  Terrain,
  TILE_SIZE,
  tileIndex,
  type ViewDeps,
  type World,
} from "@hw/colony-sim-v1-core";
import { buildingSprite, resourceBadge } from "./buildings";
import { createLayers, type Layers } from "./layers";
import { Camera } from "./camera";
import { experiments } from "./experiments";
import { buildFogOfWar, type FogOfWar, hiddenByFog, visionSources } from "./fog";
import { BuildGhost } from "./ghost";
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
  private ghost: BuildGhost;
  // Whose client this is, for the one thing the view still needs an owner id for
  // that the world cannot answer: the colour of a building not yet placed.
  private player: PlayerId;
  // What a click would take right now, as resolved by the engine. View-only: it
  // never reaches the World and never goes into a signal — the DOM HUD does not
  // draw it, and repainting the HUD on every pointer move would be wasteful.
  private hovered: Selection | null = null;
  // EXPERIMENT (`experiments.fogOfWar`): built the first frame the flag is on and
  // kept afterwards — baking it costs a pass over the map, and the flag is a switch
  // to flick while watching, not a setting. Null once `fogBuilt` is set means the
  // map has no dead lands to shroud.
  private fog: FogOfWar | null = null;
  private fogBuilt = false;
  private fogging = false;
  private sprites = new Map<EntityId, Container>();
  // Animated subset of `sprites`, plus the facing derived from their movement.
  // Both are view-only state: nothing here is persisted.
  private creatures = new Map<EntityId, { sprite: Sprite; sheet: Creature }>();
  private facings = new Map<EntityId, Facing>();

  constructor(app: Application, deps: ViewDeps) {
    const { world } = deps;
    this.player = deps.player;
    this.layers = createLayers();
    app.stage.addChild(this.layers.root);
    this.camera = new Camera(app, this.layers.root, deps.commands, deps.pointer);
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
    // Above both: the ghost is what the click is about while it is on screen.
    this.ghost = new BuildGhost(this.layers.fx);
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
    this.updateFog(world, alpha);
    const selected = selection.value;
    this.place(this.marker, world, selected);
    // Two markers on the same thing would just darken it; the selection already
    // says everything the hover would.
    this.place(this.hoverMarker, world, sameTarget(this.hovered, selected) ? null : this.hovered);
    // The armed order comes off the same signal the build menu writes, so cursor and
    // menu cannot disagree about what is about to be placed.
    this.ghost.show(world, this.player, buildOrder.value, this.hovered);
  }

  // The selection marker mirrors the `selection` signal — the same UI state the
  // DOM panel reads, so canvas and HUD can never disagree about what is selected.
  private place(marker: Marker, world: World, target: Selection | null): void {
    if (!target) {
      marker.hide();
      return;
    }
    if (target.kind === "tile") {
      marker.atTile(target.x, target.y);
      return;
    }
    // A building is framed as the tile it fills. Following its sprite would put the
    // brackets half a tile off: the marker centres itself on a sprite's position,
    // which is right for everything that merely stands at a point and wrong for the
    // one thing anchored to a tile's corner.
    const tile = world.buildings.has(target.id) ? world.positions.get(target.id) : undefined;
    if (tile) {
      marker.atTile(tile.x, tile.y);
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

  // EXPERIMENT (`experiments.fogOfWar`). The flag is looked at once a frame instead
  // of subscribed to: this view already re-derives itself from the world every
  // frame, so a boolean is one more thing to read while doing it — and it can never
  // flip halfway through a frame and leave the picture half shrouded.
  //
  // The world is not told any of this. What the fog hides, it hides from the eye:
  // the sim still paths, picks and works over the whole map.
  private updateFog(world: World, alpha: number): void {
    const on = experiments.fogOfWar;
    if (on && !this.fogBuilt) {
      this.fog = buildFogOfWar(world);
      this.fogBuilt = true;
      if (this.fog) {
        // Over the entities, under the markers: the bank hides what stands in it,
        // but not the brackets around what this client has selected — those are the
        // client talking to itself, not something it can see out there.
        this.layers.fx.addChildAt(this.fog.view, 0);
      }
    }
    if (!this.fog) {
      return;
    }

    this.fog.view.visible = on;
    if (!on) {
      // Switching the experiment off has to give back everything it hid, and only
      // then: sprite visibility is nobody else's business here, so it is written
      // exactly on the frame the flag changes.
      if (this.fogging) {
        for (const sprite of this.sprites.values()) {
          sprite.visible = true;
        }
        this.fogging = false;
      }
      return;
    }

    const eyes = visionSources(world, this.player, alpha);
    this.fog.setPhase(world.tick + alpha);
    this.fog.setVision(eyes);
    for (const sprite of this.sprites.values()) {
      sprite.visible = !hiddenByFog(world.grid, eyes, sprite.x, sprite.y);
    }
    this.fogging = true;
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

    const building = world.buildings.get(id);
    if (building) {
      this.createBuilding(world, id, building);
      return;
    }

    // Which worker sheet a colonist draws from is the one thing about its art that
    // comes from the world rather than from its id: teams have to stay apart across
    // a reload, and a colonist that changed hands has to change colour with it.
    // An unowned colonist is a spawner bug, not a state to draw as sheet-less.
    this.createCreature(id, sheets().colonists[world.owners.get(id) ?? DEFAULT_PLAYER], COLONIST_ANCHOR_Y);
  }

  // A building is a small tree of its own: the frame on its tile, plus — for a store
  // — the badge naming the one resource it keeps. The badge is built once because the
  // resource never changes; how full the store is belongs in the inspector, not in a
  // sprite that would have to be rebuilt every deposit.
  private createBuilding(world: World, id: EntityId, building: Building): void {
    const container = new Container();
    const player = world.owners.get(id) ?? DEFAULT_PLAYER;
    container.addChild(buildingSprite(player, building.kind, hashId(id)));
    if (building.stores !== null) {
      container.addChild(resourceBadge(building.stores));
    }
    this.layers.objects.addChild(container);
    this.sprites.set(id, container);
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
