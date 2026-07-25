import { Application, Container, Graphics } from "pixi.js";
import { TILE_SIZE, Terrain, tileIndex } from "@/sim/grid";
import type { EntityId } from "@/sim/components";
import type { World } from "@/sim/world";
import { createLayers, type Layers } from "@/render/layers";

const STAGE_SCALE = 3;

const TERRAIN_COLORS: Record<number, number> = {
  [Terrain.Grass]: 0x4a7c3a,
  [Terrain.Water]: 0x2b5d8c,
  [Terrain.Rock]: 0x7a7168,
};

// Owns the pixi view tree and reconciles it against the World every frame:
// spawn sprites for new entities, drop stale ones, lerp positions between ticks.
class GameRenderer {
  private layers: Layers;
  private sprites = new Map<EntityId, Graphics>();

  constructor(app: Application, world: World) {
    this.layers = createLayers(STAGE_SCALE);
    app.stage.addChild(this.layers.root);
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
      }
    }
  }

  // Placeholder graphics until real 16px/32px spritesheets are atlased.
  private createSprite(world: World, id: EntityId): void {
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

export { GameRenderer, STAGE_SCALE };
