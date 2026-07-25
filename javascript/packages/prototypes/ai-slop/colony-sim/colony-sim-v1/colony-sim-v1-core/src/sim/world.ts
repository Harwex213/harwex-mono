import { createRng, randInt, type Rng } from "./rng";
import { createGrid, type Grid, GRID_H, GRID_W, isWalkable, Terrain, tileIndex } from "./grid";
import { DEFAULT_MAP_GEN, getMapGenerator, type MapGenId } from "./mapgen";
import { pickEntity } from "./picking";
import { type MapObjectKind, PLAYER_IDS, RESOURCE_DEFS } from "../data/defs";
import type {
  Animal,
  Building,
  BuildOrder,
  EntityId,
  Inventory,
  ItemStack,
  Job,
  Needs,
  PathFollow,
  PlayerId,
  Position,
  ResourceKind,
} from "./components";
import { AnimalKind, BuildingKind, JobKind } from "./components";

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
  owners: Map<EntityId, PlayerId>; // whose entity this is; scenery and wildlife are in nobody's
  needs: Map<EntityId, Needs>;
  paths: Map<EntityId, PathFollow>;
  jobs: Map<EntityId, Job>;
  inventories: Map<EntityId, Inventory>;
  animals: Map<EntityId, Animal>;
  items: Map<EntityId, ItemStack>; // loose resource stacks lying on the ground
  buildings: Map<EntityId, Building>; // placed stores and producers
  trees: Set<EntityId>;
  rocks: Set<EntityId>;
  stockpile: Position;
}

// 2: added the animals component Map.
// 3: rocks became entities (were baked ground decor).
// 4: storedWood → stock record (wood / stone / food).
// 5: grid widened to 96×64 — an old snapshot's grid is narrower than the camera
//    bounds this build clamps to, so it pans into nothing.
// 6: added the items component Map (loose resources on the ground).
// 7: colonists belong to a player — the owners component Map.
// 8: the grid carries a region per tile beside its terrain.
// 9: buildings; the colony's resources moved into the stores, so `stock` is gone
//    and a colonist carries one stack instead of a wood counter.
const SCHEMA_VERSION = 9;

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
    owners: new Map(),
    needs: new Map(),
    paths: new Map(),
    jobs: new Map(),
    inventories: new Map(),
    animals: new Map(),
    items: new Map(),
    buildings: new Map(),
    trees: new Set(),
    rocks: new Set(),
    stockpile: { x: Math.floor(GRID_W / 2), y: Math.floor(GRID_H / 2) },
  };
}

// An owner is required rather than defaulted: a colonist nobody owns is a colonist
// the renderer has no sheet for and the HUD cannot count, and the caller always
// knows whose it is (a starting camp, a spawn command).
function spawnColonist(world: World, pos: Position, owner: PlayerId): EntityId {
  const id = allocId(world);
  world.positions.set(id, { x: pos.x, y: pos.y });
  world.prevPositions.set(id, { x: pos.x, y: pos.y });
  world.owners.set(id, owner);
  world.needs.set(id, { hunger: 0, fatigue: 0 });
  world.jobs.set(id, { kind: JobKind.Wander, targetId: null, targetTile: null, progress: 0 });
  world.inventories.set(id, { kind: null, amount: 0 });
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

function spawnItem(world: World, pos: Position, kind: ResourceKind, amount: number): EntityId {
  const id = allocId(world);
  world.positions.set(id, { x: pos.x, y: pos.y });
  world.prevPositions.set(id, { x: pos.x, y: pos.y });
  world.items.set(id, { kind, amount });
  return id;
}

// Whether a tile takes a building: standable, and with nothing already on it. A
// building fills its tile and blocks it, so one placed over a colonist would wall
// it in and one placed over a tree would leave the tree inside a hut. The renderer
// asks this same function for its placement ghost — a second copy of the rule would
// promise spots the command then refuses.
function canBuildAt(world: World, x: number, y: number): boolean {
  return isWalkable(world.grid, x, y) && pickEntity(world, x, y) === null;
}

// Places a building on a tile, or returns null when that tile does not take one.
// The occupancy bit is written here rather than by a system: `blocked` is the
// grid's derived copy of where the buildings are, and this and `despawn` are the
// only two places allowed to disagree with it for a moment.
function buildAt(world: World, order: BuildOrder, tile: Position, owner: PlayerId): EntityId | null {
  const x = Math.floor(tile.x);
  const y = Math.floor(tile.y);
  if (!canBuildAt(world, x, y)) {
    return null;
  }
  const id = allocId(world);
  world.positions.set(id, { x, y });
  world.prevPositions.set(id, { x, y });
  world.owners.set(id, owner);
  world.buildings.set(id, {
    kind: order.kind,
    stores: order.kind === BuildingKind.Warehouse ? order.stores : null,
    amount: 0,
    growth: 0,
  });
  world.grid.blocked[tileIndex(world.grid, x, y)] = 1;
  return id;
}

// The only way an entity leaves the world. Every collection has to be cleared,
// not just `entities`: the renderer reconciles against that Set, but a row left
// behind in any component Map is a job target, a sprite pick or a roster line
// pointing at something that no longer exists — and ids are never reused, so the
// leak is silent until something iterates that Map instead of `entities`.
function despawn(world: World, id: EntityId): void {
  // The tile a building held is freed here rather than by the caller, and before
  // the position it is read from is gone: a tile left blocked under nothing is a
  // hole in the map that no later pass can tell from a real wall.
  const pos = world.positions.get(id);
  if (pos && world.buildings.has(id)) {
    world.grid.blocked[tileIndex(world.grid, Math.floor(pos.x), Math.floor(pos.y))] = 0;
  }
  world.entities.delete(id);
  world.positions.delete(id);
  world.prevPositions.delete(id);
  world.owners.delete(id);
  world.needs.delete(id);
  world.paths.delete(id);
  world.jobs.delete(id);
  world.inventories.delete(id);
  world.animals.delete(id);
  world.items.delete(id);
  world.buildings.delete(id);
  world.trees.delete(id);
  world.rocks.delete(id);
}

function objectKindOf(world: World, id: EntityId): MapObjectKind | null {
  if (world.trees.has(id)) {
    return "tree";
  }
  if (world.rocks.has(id)) {
    return "rock";
  }
  return null;
}

// Destroying a map object is what puts resources on the ground, and the drop
// comes from the shared table in `defs` — so a chopped tree, a mined boulder and
// a debug click cannot disagree about what an object is worth. The stack lands on
// the tile the object stood on, which is free by definition now, and it goes to
// the ground rather than into a store: hauling it home is a separate job, and the
// player should be able to see the loot waiting for one.
// Returns the new stack's id, or null for an entity that leaves nothing behind —
// a colonist, an animal, an already-dropped stack, a demolished building.
function destroyObject(world: World, id: EntityId): EntityId | null {
  // A building is destructible too, and drops nothing: what a store held is gone
  // with it. Salvage would be a second drop table for the same click.
  if (world.buildings.has(id)) {
    despawn(world, id);
    return null;
  }
  const kind = objectKindOf(world, id);
  const pos = world.positions.get(id);
  if (!kind || !pos) {
    return null;
  }
  const tile = { x: pos.x, y: pos.y };
  despawn(world, id);
  const def = RESOURCE_DEFS[kind];
  return spawnItem(world, tile, def.yields, def.amount);
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

// How far from its camp centre a starting colonist may land. A map can put a wall
// across itself (see the divided-lands generator), and a colonist dropped on the
// far side of one would never reach the stockpile: a player starts as one cluster,
// and the map says where that cluster goes.
const COLONIST_SPAWN_RADIUS = 6;

// Each player's own starting crew. Where that crew lands is the map's call, not
// this builder's: only the generator knows which half of the map is worth settling
// and where a wall runs (see MapGenResult.camps).
const COLONISTS_PER_PLAYER = 6;

// Loot the map starts with, lying about as if something had already been felled
// here. Without it the ground stays bare until the first tree comes down, and
// everything that will read loose stacks (hauling, the inspector, picking) would
// have nothing to be tried against on a fresh game.
const STARTING_PILES: readonly { kind: ResourceKind; count: number }[] = [
  { kind: "wood", count: 12 },
  { kind: "stone", count: 10 },
];
const STARTING_PILE_MAX = 4; // stack size drawn from 1..this, so piles are uneven

// New game: let the chosen generator draw the map, scatter rocks, then fill in the
// crew of every camp it marked and put the rest of the life on whatever walkable
// tiles are left. Nobody starts with a building: a store is the first thing the
// player builds, and until one stands the loose loot below has nowhere to go —
// which is the point of putting it on the map.
//
// Who gets a crew is the caller's policy (dev-game runs a single colony), but the
// map is still drawn for every player in `PLAYER_IDS`: a seed has to produce the
// same terrain wherever it is opened, or dev stops being a preview of the game.
function newGame(
  seed: number,
  mapGenId: MapGenId = DEFAULT_MAP_GEN,
  players: readonly PlayerId[] = PLAYER_IDS,
): World {
  const world = createEmptyWorld(seed);
  const rng = createRng(seed);
  const { colonyOrigin, camps } = getMapGenerator(mapGenId).generate(world.grid, rng, PLAYER_IDS.length);
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

  // Rejection sampling in a box around a camp centre; a cramped spot (a pocket
  // in the cliffs, a shore) falls back to anywhere walkable rather than hangs.
  const claimTileNear = (center: Position): Position => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const x = Math.round(center.x) + randInt(rng, -COLONIST_SPAWN_RADIUS, COLONIST_SPAWN_RADIUS + 1);
      const y = Math.round(center.y) + randInt(rng, -COLONIST_SPAWN_RADIUS, COLONIST_SPAWN_RADIUS + 1);
      if (claim(x, y)) {
        return { x, y };
      }
    }
    return claimWalkableTile();
  };

  // One camp per player, in PLAYER_IDS order — the map returns them in that same
  // order, so the first player gets the first camp the generator drew. A generator
  // that hands back fewer camps than there are players (it cannot, but the type
  // cannot say so) drops the rest on the colony spot instead of nowhere. Camps of
  // players who are not in this game stay empty.
  players.forEach((player) => {
    const index = PLAYER_IDS.indexOf(player);
    const camp = camps[index] ?? colonyOrigin;
    for (let i = 0; i < COLONISTS_PER_PLAYER; i += 1) {
      spawnColonist(world, claimTileNear(camp), player);
    }
  });
  for (let i = 0; i < 40; i += 1) {
    spawnTree(world, claimWalkableTile());
  }
  for (let i = 0; i < 8; i += 1) {
    spawnChicken(world, claimWalkableTile());
  }
  for (const pile of STARTING_PILES) {
    for (let i = 0; i < pile.count; i += 1) {
      spawnItem(world, claimWalkableTile(), pile.kind, randInt(rng, 1, STARTING_PILE_MAX + 1));
    }
  }
  return world;
}

export type { World };
export {
  SCHEMA_VERSION,
  newGame,
  allocId,
  buildAt,
  canBuildAt,
  despawn,
  destroyObject,
  objectKindOf,
  randomFreeTile,
  spawnColonist,
  spawnItem,
  spawnTree,
  spawnRock,
  spawnChicken,
};
