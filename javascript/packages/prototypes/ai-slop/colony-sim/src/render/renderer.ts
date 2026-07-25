import { Application, Container, Graphics, Sprite } from "pixi.js";
import { TILE_SIZE, Terrain, tileIndex } from "@/sim/grid";
import type { EntityId, Position } from "@/sim/components";
import type { World } from "@/sim/world";
import { createLayers, type Layers } from "@/render/layers";
import { Camera } from "@/render/camera";
import { Facing, FRAMES_PER_ROW, chickenFrames } from "@/render/textures";
import type { CommandDispatcher } from "@/commands";

const TERRAIN_COLORS: Record<number, number> = {
  [Terrain.Grass]: 0x4a7c3a,
  [Terrain.Water]: 0x2b5d8c,
  [Terrain.Rock]: 0x7a7168,
};

const ANIM_TICKS_PER_FRAME = 2; // 10 ticks/s ÷ 2 = 5 fps walk cycle

// Owns the pixi view tree and reconciles it against the World every frame:
// spawn sprites for new entities, drop stale ones, lerp positions between ticks.
class GameRenderer {
  readonly camera: Camera;
  private layers: Layers;
  private sprites = new Map<EntityId, Container>();
  // Animated subset of `sprites`, plus the facing derived from their movement.
  // Both are view-only state: nothing here is persisted.
  private animals = new Map<EntityId, Sprite>();
  private facings = new Map<EntityId, Facing>();

  constructor(app: Application, world: World, commands: CommandDispatcher) {
    this.layers = createLayers();
    app.stage.addChild(this.layers.root);
    this.camera = new Camera(app, this.layers.root, commands);
    this.drawGround(world);
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

  // Pick the sheet frame per animal. Frames advance on sim ticks rather than
  // wall clock, so pause freezes the walk cycle and 2×/3× speeds it up for free.
  private animate(world: World): void {
    const frames = chickenFrames();
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

  // Animals use the real 16px sheets; trees and colonists are still placeholder
  // graphics until their spritesheets are atlased.
  private createSprite(world: World, id: EntityId): void {
    if (world.animals.has(id)) {
      const sprite = new Sprite(chickenFrames()[Facing.Down][0]);
      sprite.anchor.set(0.5, 0.6); // feet on the tile point, not the body centre
      this.layers.entities.addChild(sprite);
      this.sprites.set(id, sprite);
      this.animals.set(id, sprite);
      return;
    }

    const g = new Graphics();
    let parent: Container;
    if (world.trees.has(id)) {
      g.poly([0, -12, 6, 2, -6, 2]).fill(0x2f6b2a);
      parent = this.layers.objects;
    } else {
      g.circle(0, 0, 5).fill(0xe8c39e);
      g.circle(0, -1, 5).stroke({ color: 0x3a2a1a, width: 1 });
      parent = this.layers.entities;
    }
    parent.addChild(g);
    this.sprites.set(id, g);
  }

  private drawGround(world: World): void {
    const g = new Graphics();
    const { grid } = world;
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const terrain = grid.terrain[tileIndex(grid, x, y)];
        g.rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        g.fill(TERRAIN_COLORS[terrain] ?? 0x000000);
      }
    }
    // Stockpile marker.
    g.rect(world.stockpile.x * TILE_SIZE, world.stockpile.y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    g.fill(0xcaa24a);
    this.layers.ground.addChild(g);
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
