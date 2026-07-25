import { Application, Container, Graphics, Sprite } from "pixi.js";
import { TILE_SIZE } from "@/sim/grid";
import type { EntityId, Position } from "@/sim/components";
import type { World } from "@/sim/world";
import { createLayers, type Layers } from "@/render/layers";
import { Camera } from "@/render/camera";
import { buildGround } from "@/render/ground";
import type { WaterSurface } from "@/render/water";
import { Facing, FRAMES_PER_ROW, TREE_VARIANTS, sheets } from "@/render/textures";
import type { CommandDispatcher } from "@/commands";

const ANIM_TICKS_PER_FRAME = 2; // 10 ticks/s ÷ 2 = 5 fps walk cycle

// Trees.png frame 0 is a bare stump, kept for a future harvested state; the
// canopies follow it.
const TREE_CANOPIES = TREE_VARIANTS - 1;
// Trunk base sits on the entity's tile point, canopy grows up from it.
const TREE_ANCHOR_Y = 0.85;

// Owns the pixi view tree and reconciles it against the World every frame:
// spawn sprites for new entities, drop stale ones, lerp positions between ticks.
class GameRenderer {
  readonly camera: Camera;
  private layers: Layers;
  private water: WaterSurface;
  private sprites = new Map<EntityId, Container>();
  // Animated subset of `sprites`, plus the facing derived from their movement.
  // Both are view-only state: nothing here is persisted.
  private animals = new Map<EntityId, Sprite>();
  private facings = new Map<EntityId, Facing>();

  constructor(app: Application, world: World, commands: CommandDispatcher) {
    this.layers = createLayers();
    app.stage.addChild(this.layers.root);
    this.camera = new Camera(app, this.layers.root, commands);
    const ground = buildGround(world);
    this.water = ground.water;
    this.layers.ground.addChild(ground.layer);
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
    this.animate(world);
  }

  // Pick the sheet frame per animal, and step the water shader. Both advance on
  // sim ticks rather than wall clock, so pause freezes them and 2×/3× speeds
  // them up for free.
  private animate(world: World): void {
    this.water.setTick(world.tick);
    const frames = sheets().chicken;
    for (const [id, sprite] of this.animals) {
      const cur = world.positions.get(id);
      const prev = world.prevPositions.get(id);
      if (!cur || !prev) {
        continue;
      }
      const facing = deriveFacing(prev, cur, this.facings.get(id) ?? Facing.Down);
      this.facings.set(id, facing);
      const walking = world.paths.has(id);
      const frame = walking ? Math.floor(world.tick / ANIM_TICKS_PER_FRAME) % FRAMES_PER_ROW : 0;
      sprite.texture = frames[facing][frame];
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
        this.animals.delete(id);
        this.facings.delete(id);
      }
    }
  }

  // Animals and trees use the real 16px sheets; colonists are still placeholder
  // graphics until a worker sheet is picked and recoloured.
  private createSprite(world: World, id: EntityId): void {
    if (world.animals.has(id)) {
      const sprite = new Sprite(sheets().chicken[Facing.Down][0]);
      sprite.anchor.set(0.5, 0.6); // feet on the tile point, not the body centre
      this.layers.entities.addChild(sprite);
      this.sprites.set(id, sprite);
      this.animals.set(id, sprite);
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

    const colonist = new Graphics();
    colonist.circle(0, 0, 5).fill(0xe8c39e);
    colonist.circle(0, -1, 5).stroke({ color: 0x3a2a1a, width: 1 });
    this.layers.entities.addChild(colonist);
    this.sprites.set(id, colonist);
  }
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
