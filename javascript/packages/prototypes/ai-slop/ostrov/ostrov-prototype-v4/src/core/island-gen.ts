import { hexId, hexNeighbours } from "./hex";
import { createRng } from "./rng";

import type { TBiomeId, TBuildingId, THex, TIsland, TRng } from "./types";

/**
 * Island generation and the pure edits the store applies to an island.
 * A blob of 12 to 20 hexes grows from (0, 0) by random neighbour accretion;
 * biomes cluster because a new hex copies a neighbour most of the time.
 */

const MIN_START_HEX_COUNT = 12;
const MAX_START_HEX_COUNT = 20;

/** Absorption in the clearing phase stops here (plan §3.8). */
const MAX_ISLAND_HEX_COUNT = 25;

/** Demolition may not take the island below this (plan §3.2). */
const MIN_ISLAND_HEX_COUNT = 7;

const TOXICITY_MIN = 0;
const TOXICITY_MAX = 100;

/** How often a new hex copies the biome of a neighbour instead of rolling a fresh one. */
const BIOME_AFFINITY_CHANCE = 0.62;

/** Common biomes appear more than once, so the roll is weighted without a weight table. */
const WEIGHTED_BIOMES: readonly TBiomeId[] = [
  "grassland",
  "grassland",
  "grassland",
  "plains",
  "plains",
  "plains",
  "forrest",
  "forrest",
  "savanna",
  "rainforest",
  "taiga",
  "taiga",
  "tundra",
  "desert",
  "polar_desert",
  "swamp",
  "swamp",
  "badlands",
  "crater",
  "volcano",
  "hills",
  "hills",
  "mountains",
  "mountains",
  "cliffs",
];

const FOOD_BIOMES: readonly TBiomeId[] = ["grassland", "plains"];
const WOOD_BIOMES: readonly TBiomeId[] = ["forrest", "taiga", "rainforest", "savanna"];
const STONE_BIOMES: readonly TBiomeId[] = ["mountains", "cliffs"];

type TBiomeRequirement = {
  readonly biomes: readonly TBiomeId[];
  readonly minimum: number;
  readonly fill: TBiomeId;
};

/**
 * A starting island must let the player build a farm, a sawmill and a mine on
 * turn one. `STONE_BIOMES` is a subset of mountains/hills/cliffs that a mine
 * actually accepts, so satisfying it satisfies the looser rule too.
 */
const BIOME_REQUIREMENTS: readonly TBiomeRequirement[] = [
  { biomes: FOOD_BIOMES, minimum: 2, fill: "grassland" },
  { biomes: WOOD_BIOMES, minimum: 1, fill: "forrest" },
  { biomes: STONE_BIOMES, minimum: 1, fill: "mountains" },
];

type TGrownCell = {
  readonly q: number;
  readonly r: number;
};

/** Grows a connected blob of `count` cells out of (0, 0). */
const growBlob = (rng: TRng, count: number): readonly TGrownCell[] => {
  const taken = new Map<string, TGrownCell>();
  const frontier = new Map<string, TGrownCell>();
  const addCell = (cell: TGrownCell): void => {
    const id = hexId(cell.q, cell.r);
    taken.set(id, cell);
    frontier.delete(id);
    for (const neighbour of hexNeighbours(cell.q, cell.r)) {
      const neighbourId = hexId(neighbour.q, neighbour.r);
      if (taken.has(neighbourId) === true) {
        continue;
      }
      frontier.set(neighbourId, neighbour);
    }
  };
  addCell({ q: 0, r: 0 });
  while (taken.size < count) {
    const candidates = [...frontier.values()];
    if (candidates.length === 0) {
      break;
    }
    addCell(rng.pick(candidates));
  }
  return [...taken.values()];
};

const countBiomes = (biomes: Map<string, TBiomeId>, wanted: readonly TBiomeId[]): number => {
  let total = 0;
  for (const biome of biomes.values()) {
    if (wanted.includes(biome) === true) {
      total += 1;
    }
  }
  return total;
};

/** A hex whose biome no requirement needs, so it may be overwritten. */
const isSpareHex = (biomes: Map<string, TBiomeId>, id: string, forbidden: readonly TBiomeId[]): boolean => {
  const biome = biomes.get(id);
  if (biome === undefined) {
    return false;
  }
  if (forbidden.includes(biome) === true) {
    return false;
  }
  for (const requirement of BIOME_REQUIREMENTS) {
    if (requirement.biomes.includes(biome) === false) {
      continue;
    }
    if (countBiomes(biomes, requirement.biomes) <= requirement.minimum) {
      return false;
    }
  }
  return true;
};

const enforceBiomeRequirements = (
  rng: TRng,
  biomes: Map<string, TBiomeId>,
): void => {
  const ids = [...biomes.keys()];
  for (const requirement of BIOME_REQUIREMENTS) {
    while (countBiomes(biomes, requirement.biomes) < requirement.minimum) {
      const spare = ids.filter((id) => {
        return isSpareHex(biomes, id, requirement.biomes);
      });
      const pool = spare.length > 0 ? spare : ids;
      biomes.set(rng.pick(pool), requirement.fill);
    }
  }
};

const createIsland = (seed: number, ownerId: string): TIsland => {
  const rng = createRng(seed);
  const cells = growBlob(rng, rng.int(MIN_START_HEX_COUNT, MAX_START_HEX_COUNT));
  const biomes = new Map<string, TBiomeId>();
  for (const cell of cells) {
    const id = hexId(cell.q, cell.r);
    const assignedNeighbours: TBiomeId[] = [];
    for (const neighbour of hexNeighbours(cell.q, cell.r)) {
      const neighbourBiome = biomes.get(hexId(neighbour.q, neighbour.r));
      if (neighbourBiome !== undefined) {
        assignedNeighbours.push(neighbourBiome);
      }
    }
    if (assignedNeighbours.length > 0 && rng.next() < BIOME_AFFINITY_CHANCE) {
      biomes.set(id, rng.pick(assignedNeighbours));
      continue;
    }
    biomes.set(id, rng.pick(WEIGHTED_BIOMES));
  }
  enforceBiomeRequirements(rng, biomes);
  const hexes: Record<string, THex> = {};
  for (const cell of cells) {
    const id = hexId(cell.q, cell.r);
    const biome = biomes.get(id);
    if (biome === undefined) {
      continue;
    }
    hexes[id] = {
      id,
      q: cell.q,
      r: cell.r,
      biome,
      building: null,
      toxicity: 0,
    };
  }
  return { ownerId, hexes };
};

/** The first free cell touching the island, so an appended hex never floats away. */
const findFreeSlot = (hexes: Readonly<Record<string, THex>>): TGrownCell | null => {
  for (const hex of Object.values(hexes)) {
    for (const neighbour of hexNeighbours(hex.q, hex.r)) {
      if (hexes[hexId(neighbour.q, neighbour.r)] === undefined) {
        return neighbour;
      }
    }
  }
  return null;
};

/**
 * Appends absorbed hexes, each one relocated to a free cell on the island's rim
 * so the blob stays connected. The island stops growing at 25 hexes.
 */
const addHexesToIsland = (island: TIsland, hexes: readonly THex[]): TIsland => {
  const next: Record<string, THex> = { ...island.hexes };
  for (const hex of hexes) {
    if (Object.keys(next).length >= MAX_ISLAND_HEX_COUNT) {
      break;
    }
    const slot = findFreeSlot(next);
    if (slot === null) {
      break;
    }
    const id = hexId(slot.q, slot.r);
    next[id] = { ...hex, id, q: slot.q, r: slot.r };
  }
  return { ...island, hexes: next };
};

const removeHex = (island: TIsland, targetHexId: string): TIsland => {
  const next: Record<string, THex> = { ...island.hexes };
  delete next[targetHexId];
  return { ...island, hexes: next };
};

const setBuilding = (island: TIsland, targetHexId: string, building: TBuildingId | null): TIsland => {
  const hex = island.hexes[targetHexId];
  if (hex === undefined) {
    return island;
  }
  return { ...island, hexes: { ...island.hexes, [targetHexId]: { ...hex, building } } };
};

const addToxicity = (island: TIsland, targetHexId: string, delta: number): TIsland => {
  const hex = island.hexes[targetHexId];
  if (hex === undefined) {
    return island;
  }
  const toxicity = Math.max(TOXICITY_MIN, Math.min(TOXICITY_MAX, hex.toxicity + delta));
  return { ...island, hexes: { ...island.hexes, [targetHexId]: { ...hex, toxicity } } };
};

const builtHexIds = (island: TIsland): readonly string[] => {
  const ids: string[] = [];
  for (const hex of Object.values(island.hexes)) {
    if (hex.building !== null) {
      ids.push(hex.id);
    }
  }
  return ids;
};

export {
  MAX_ISLAND_HEX_COUNT,
  MAX_START_HEX_COUNT,
  MIN_ISLAND_HEX_COUNT,
  MIN_START_HEX_COUNT,
  addHexesToIsland,
  addToxicity,
  builtHexIds,
  createIsland,
  removeHex,
  setBuilding,
};
