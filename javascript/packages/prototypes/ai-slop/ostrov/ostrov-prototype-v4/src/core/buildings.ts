import type { TBiomeId, TBuildingId, TBuildingInfo, TIsland, TResources } from "./types";

/**
 * The seven buildings. Every per-biome `(amount, toxicity)` row is copied
 * verbatim from spec nodes 52-55 and 65-67; the costs are plan §3.5.
 */

/** A hex at this toxicity is dead: nothing produces and nothing may be built. */
const DEAD_HEX_TOXICITY = 100;

/** Left to right in the buildings panel, cheapest first. */
const BUILDING_ORDER: readonly TBuildingId[] = [
  "farm",
  "sawmill",
  "mine",
  "village",
  "masons_guild",
  "observatory",
  "university",
];

const BUILDINGS: Readonly<Record<TBuildingId, TBuildingInfo>> = {
  farm: {
    id: "farm",
    nameRu: "Ферма",
    produces: "food",
    cost: { stone: 0, wood: 10, hammers: 1 },
    yields: {
      grassland: { amount: 4, toxicity: 1 },
      plains: { amount: 2, toxicity: 0 },
      tundra: { amount: 2, toxicity: 0 },
      swamp: { amount: 5, toxicity: 3 },
      hills: { amount: 3, toxicity: 1 },
    },
  },
  sawmill: {
    id: "sawmill",
    nameRu: "Лесопилка",
    produces: "wood",
    cost: { stone: 5, wood: 5, hammers: 1 },
    yields: {
      forrest: { amount: 5, toxicity: 1 },
      savanna: { amount: 2, toxicity: 0 },
      rainforest: { amount: 8, toxicity: 4 },
      taiga: { amount: 5, toxicity: 2 },
    },
  },
  mine: {
    id: "mine",
    nameRu: "Рудник",
    produces: "stone",
    cost: { stone: 10, wood: 10, hammers: 2 },
    yields: {
      mountains: { amount: 7, toxicity: 3 },
      volcano: { amount: 10, toxicity: 5 },
      crater: { amount: 3, toxicity: 1 },
      cliffs: { amount: 4, toxicity: 1 },
      swamp: { amount: 2, toxicity: 1 },
    },
  },
  village: {
    id: "village",
    nameRu: "Деревня",
    produces: "population",
    cost: { stone: 10, wood: 15, hammers: 2 },
    yields: {
      grassland: { amount: 3, toxicity: 1 },
      plains: { amount: 2, toxicity: 1 },
      desert: { amount: 1, toxicity: 2 },
      tundra: { amount: 2, toxicity: 2 },
      polar_desert: { amount: 1, toxicity: 3 },
      swamp: { amount: 2, toxicity: 3 },
      badlands: { amount: 1, toxicity: 4 },
      cliffs: { amount: 1, toxicity: 0 },
    },
  },
  masons_guild: {
    id: "masons_guild",
    nameRu: "Гильдия масонов",
    produces: "hammers",
    cost: { stone: 20, wood: 10, hammers: 3 },
    yields: {
      grassland: { amount: 3, toxicity: 1 },
      plains: { amount: 2, toxicity: 1 },
      desert: { amount: 1, toxicity: 2 },
      tundra: { amount: 2, toxicity: 2 },
      polar_desert: { amount: 1, toxicity: 3 },
      swamp: { amount: 2, toxicity: 3 },
      badlands: { amount: 1, toxicity: 4 },
      cliffs: { amount: 1, toxicity: 0 },
    },
  },
  observatory: {
    id: "observatory",
    nameRu: "Обсерватория",
    produces: "scouting",
    cost: { stone: 15, wood: 20, hammers: 4 },
    yields: {
      grassland: { amount: 3, toxicity: 1 },
      plains: { amount: 2, toxicity: 1 },
      desert: { amount: 1, toxicity: 2 },
      tundra: { amount: 2, toxicity: 2 },
      polar_desert: { amount: 1, toxicity: 3 },
      swamp: { amount: 2, toxicity: 3 },
      badlands: { amount: 1, toxicity: 4 },
      cliffs: { amount: 1, toxicity: 0 },
    },
  },
  university: {
    id: "university",
    nameRu: "Университет",
    produces: "science",
    cost: { stone: 25, wood: 25, hammers: 5 },
    yields: {
      grassland: { amount: 3, toxicity: 1 },
      plains: { amount: 2, toxicity: 1 },
      desert: { amount: 1, toxicity: 2 },
      tundra: { amount: 2, toxicity: 2 },
      polar_desert: { amount: 1, toxicity: 3 },
      swamp: { amount: 2, toxicity: 3 },
      badlands: { amount: 1, toxicity: 4 },
      cliffs: { amount: 1, toxicity: 0 },
    },
  },
};

const canAfford = (resources: TResources, building: TBuildingId): boolean => {
  const cost = BUILDINGS[building].cost;
  return resources.stone >= cost.stone
    && resources.wood >= cost.wood
    && resources.hammers >= cost.hammers;
};

/** Every hex the building may go on: the biome is in its table, the hex is empty and the hex is alive. */
const legalHexesFor = (island: TIsland, building: TBuildingId): readonly string[] => {
  const table = BUILDINGS[building].yields;
  const legal: string[] = [];
  for (const hex of Object.values(island.hexes)) {
    if (table[hex.biome] === undefined) {
      continue;
    }
    if (hex.building !== null) {
      continue;
    }
    if (hex.toxicity >= DEAD_HEX_TOXICITY) {
      continue;
    }
    legal.push(hex.id);
  }
  return legal;
};

/** The biomes the building may be placed on, in the order the spec lists them. */
const biomesForBuilding = (building: TBuildingId): readonly TBiomeId[] => {
  return Object.keys(BUILDINGS[building].yields) as TBiomeId[];
};

export { BUILDINGS, BUILDING_ORDER, DEAD_HEX_TOXICITY, biomesForBuilding, canAfford, legalHexesFor };
