import { createNoise2D } from "simplex-noise";
import { createRng, randInt, type Rng } from "./rng";
import { createGrid, type Grid, GRID_H, GRID_W, isWalkable, Terrain, tileIndex } from "./grid";
import type { Animal, EntityId, Inventory, Job, Needs, PathFollow, Position, Stock } from "./components";
import { AnimalKind, JobKind } from "./components";

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
  animals: Map<EntityId, Animal>;
  trees: Set<EntityId>;
  rocks: Set<EntityId>;
  stockpile: Position;
  stock: Stock;
}

// 2: added the animals component Map.
// 3: rocks became entities (were baked ground decor).
// 4: storedWood → stock record (wood / stone / food).
const SCHEMA_VERSION = 4;

// Rock density per terrain, in percent of eligible tiles. High ground is strewn
// with boulders; grassland gets the occasional one.
const STONE_ROCK_PERCENT = 22;
const GRASS_ROCK_PERCENT = 3;

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
    animals: new Map(),
    trees: new Set(),
    rocks: new Set(),
    stockpile: { x: Math.floor(GRID_W / 2), y: Math.floor(GRID_H / 2) },
    stock: { wood: 0, stone: 0, food: 0 },
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

function spawnChicken(world: World, pos: Position): EntityId {
  const id = allocId(world);
  world.positions.set(id, { x: pos.x, y: pos.y });
  world.prevPositions.set(id, { x: pos.x, y: pos.y });
  world.animals.set(id, { kind: AnimalKind.Chicken, idleTicks: 0 });
  return id;
}

function spawnTree(world: World, pos: Position): EntityId {
  const id = allocId(world);
  world.positions.set(id, { x: pos.x, y: pos.y });
  world.prevPositions.set(id, { x: pos.x, y: pos.y });
  world.trees.add(id);
  return id;
}

function spawnRock(world: World, pos: Position): EntityId {
  const id = allocId(world);
  world.positions.set(id, { x: pos.x, y: pos.y });
  world.prevPositions.set(id, { x: pos.x, y: pos.y });
  world.rocks.add(id);
  return id;
}

// Boulders are entities rather than ground decor because they are selectable
// (and one day mineable) — that is the line between the baked layer and the
// world. Their tiles are claimed here so nothing else spawns on top of them.
function scatterRocks(world: World, rng: Rng, taken: Set<number>): void {
  const { grid } = world;
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const index = tileIndex(grid, x, y);
      const terrain = grid.terrain[index];
      if (terrain === Terrain.Water || taken.has(index)) {
        continue;
      }
      const density = terrain === Terrain.Rock ? STONE_ROCK_PERCENT : GRASS_ROCK_PERCENT;
      if (rng() * 100 >= density) {
        continue;
      }
      taken.add(index);
      spawnRock(world, { x, y });
    }
  }
}

// New game: generate terrain, scatter rocks, then place colonists, trees and
// animals on whatever walkable tiles are left.
function newGame(seed: number): World {
  const world = createEmptyWorld(seed);
  const rng = createRng(seed);
  generateTerrain(world.grid, rng);

  const taken = new Set<number>([tileIndex(world.grid, world.stockpile.x, world.stockpile.y)]);
  scatterRocks(world, rng, taken);

  const claimWalkableTile = (): Position => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const x = randInt(rng, 0, world.grid.width);
      const y = randInt(rng, 0, world.grid.height);
      if (isWalkable(world.grid, x, y) && !taken.has(tileIndex(world.grid, x, y))) {
        taken.add(tileIndex(world.grid, x, y));
        return { x, y };
      }
    }
    return { x: world.stockpile.x, y: world.stockpile.y };
  };

  for (let i = 0; i < 6; i += 1) {
    spawnColonist(world, claimWalkableTile());
  }
  for (let i = 0; i < 40; i += 1) {
    spawnTree(world, claimWalkableTile());
  }
  for (let i = 0; i < 8; i += 1) {
    spawnChicken(world, claimWalkableTile());
  }
  return world;
}

export type { World };
export { SCHEMA_VERSION, newGame, allocId, spawnColonist, spawnTree, spawnRock, spawnChicken };
