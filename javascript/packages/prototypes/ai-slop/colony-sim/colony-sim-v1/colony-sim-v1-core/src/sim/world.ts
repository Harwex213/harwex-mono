import { createRng, randInt, type Rng } from "./rng";
import { createGrid, type Grid, GRID_H, GRID_W, isWalkable, Terrain, tileIndex } from "./grid";
import { DEFAULT_MAP_GEN, getMapGenerator, type MapGenId } from "./mapgen";
import { pickEntity } from "./picking";
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

// A walkable tile with nothing standing on it, for spawns that were told what to
// create but not where (see the spawn command). Rejection sampling rather than a
// scan of the map: on a mostly-empty grid a handful of draws hit, and the caller
// gets `null` instead of a hang on the pathological one. Occupancy is asked of
// `pickEntity` so "free" here means the same thing it does to a click.
function randomFreeTile(world: World, rng: Rng): Position | null {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const x = randInt(rng, 0, world.grid.width);
    const y = randInt(rng, 0, world.grid.height);
    if (isWalkable(world.grid, x, y) && pickEntity(world, x, y) === null) {
      return { x, y };
    }
  }
  return null;
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
      if (terrain === Terrain.Water || terrain === Terrain.Mountain || taken.has(index)) {
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

// How far from the stockpile the starting colonists may land. A map can put a
// wall across itself (see the divided-lands generator), and a colonist dropped
// on the far side of one would never reach the stockpile: the colony starts as
// one cluster, and the map says where that cluster goes.
const COLONIST_SPAWN_RADIUS = 8;

// New game: let the chosen generator draw the map, scatter rocks, then place
// colonists around the colony spot it picked and the rest of the life on
// whatever walkable tiles are left.
function newGame(seed: number, mapGenId: MapGenId = DEFAULT_MAP_GEN): World {
  const world = createEmptyWorld(seed);
  const rng = createRng(seed);
  const { colonyOrigin } = getMapGenerator(mapGenId).generate(world.grid, rng);
  world.stockpile = colonyOrigin;

  const taken = new Set<number>([tileIndex(world.grid, world.stockpile.x, world.stockpile.y)]);
  scatterRocks(world, rng, taken);

  const claim = (x: number, y: number): boolean => {
    if (!isWalkable(world.grid, x, y) || taken.has(tileIndex(world.grid, x, y))) {
      return false;
    }
    taken.add(tileIndex(world.grid, x, y));
    return true;
  };

  const claimWalkableTile = (): Position => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const x = randInt(rng, 0, world.grid.width);
      const y = randInt(rng, 0, world.grid.height);
      if (claim(x, y)) {
        return { x, y };
      }
    }
    return { x: world.stockpile.x, y: world.stockpile.y };
  };

  // Rejection sampling in a box around the stockpile; a cramped spot (a pocket
  // in the cliffs, a shore) falls back to anywhere walkable rather than hangs.
  const claimTileNearColony = (): Position => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const x = colonyOrigin.x + randInt(rng, -COLONIST_SPAWN_RADIUS, COLONIST_SPAWN_RADIUS + 1);
      const y = colonyOrigin.y + randInt(rng, -COLONIST_SPAWN_RADIUS, COLONIST_SPAWN_RADIUS + 1);
      if (claim(x, y)) {
        return { x, y };
      }
    }
    return claimWalkableTile();
  };

  for (let i = 0; i < 6; i += 1) {
    spawnColonist(world, claimTileNearColony());
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
export { SCHEMA_VERSION, newGame, allocId, randomFreeTile, spawnColonist, spawnTree, spawnRock, spawnChicken };
