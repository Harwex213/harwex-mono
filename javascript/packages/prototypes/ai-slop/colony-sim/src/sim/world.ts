import { createNoise2D } from "simplex-noise";
import { createRng, randInt, type Rng } from "@/sim/rng";
import { createGrid, tileIndex, isWalkable, Terrain, GRID_W, GRID_H, type Grid } from "@/sim/grid";
import type { EntityId, Position, Needs, PathFollow, Job, Inventory } from "@/sim/components";
import { JobKind } from "@/sim/components";

// The World is the single runtime source of truth. Pure data only (no
// functions) so it round-trips through IndexedDB's structured clone verbatim.
interface World {
  schemaVersion: number;
  tick: number;
  seed: number;
  nextId: EntityId;
  grid: Grid;
  entities: Set<EntityId>;
  positions: Map<EntityId, Position>;
  prevPositions: Map<EntityId, Position>; // last-tick pos, for render lerp
  needs: Map<EntityId, Needs>;
  paths: Map<EntityId, PathFollow>;
  jobs: Map<EntityId, Job>;
  inventories: Map<EntityId, Inventory>;
  trees: Set<EntityId>;
  stockpile: Position;
  storedWood: number;
}

const SCHEMA_VERSION = 1;

function allocId(world: World): EntityId {
  const id = world.nextId;
  world.nextId += 1;
  world.entities.add(id);
  return id;
}

function generateTerrain(grid: Grid, rng: Rng): void {
  const noise = createNoise2D(rng);
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const n = noise(x / 16, y / 16);
      let terrain = Terrain.Grass;
      if (n < -0.55) {
        terrain = Terrain.Water;
      } else if (n > 0.6) {
        terrain = Terrain.Rock;
      }
      grid.terrain[tileIndex(grid, x, y)] = terrain;
    }
  }
}

function createEmptyWorld(seed: number): World {
  return {
    schemaVersion: SCHEMA_VERSION,
    tick: 0,
    seed,
    nextId: 1,
    grid: createGrid(GRID_W, GRID_H),
    entities: new Set(),
    positions: new Map(),
    prevPositions: new Map(),
    needs: new Map(),
    paths: new Map(),
    jobs: new Map(),
    inventories: new Map(),
    trees: new Set(),
    stockpile: { x: Math.floor(GRID_W / 2), y: Math.floor(GRID_H / 2) },
    storedWood: 0,
  };
}

function spawnColonist(world: World, pos: Position): EntityId {
  const id = allocId(world);
  world.positions.set(id, { x: pos.x, y: pos.y });
  world.prevPositions.set(id, { x: pos.x, y: pos.y });
  world.needs.set(id, { hunger: 0, fatigue: 0 });
  world.jobs.set(id, { kind: JobKind.Wander, targetId: null, targetTile: null, progress: 0 });
  world.inventories.set(id, { wood: 0 });
  return id;
}

function spawnTree(world: World, pos: Position): EntityId {
  const id = allocId(world);
  world.positions.set(id, { x: pos.x, y: pos.y });
  world.prevPositions.set(id, { x: pos.x, y: pos.y });
  world.trees.add(id);
  return id;
}

// New game: generate terrain, then scatter colonists and trees on walkable land.
function newGame(seed: number): World {
  const world = createEmptyWorld(seed);
  const rng = createRng(seed);
  generateTerrain(world.grid, rng);

  const randomWalkableTile = (): Position => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const x = randInt(rng, 0, world.grid.width);
      const y = randInt(rng, 0, world.grid.height);
      if (isWalkable(world.grid, x, y)) {
        return { x, y };
      }
    }
    return { x: world.stockpile.x, y: world.stockpile.y };
  };

  for (let i = 0; i < 6; i += 1) {
    spawnColonist(world, randomWalkableTile());
  }
  for (let i = 0; i < 40; i += 1) {
    spawnTree(world, randomWalkableTile());
  }
  return world;
}

export type { World };
export { SCHEMA_VERSION, newGame, allocId, spawnColonist, spawnTree };
