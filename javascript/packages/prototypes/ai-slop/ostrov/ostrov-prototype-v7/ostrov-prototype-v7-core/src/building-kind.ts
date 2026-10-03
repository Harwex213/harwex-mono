import type { BiomeId } from "./biome";
import type { Combo, Cost, ResourceKind } from "./resource";

type BuildingKindId =
  | "farm"
  | "mine"
  | "sawmill"
  | "village"
  | "masons"
  | "observatory"
  | "university";

type Site = Combo & {
  biome: BiomeId;
};

type BuildingKind = {
  id: BuildingKindId;
  title: string;
  resource: ResourceKind;
  cost: Cost;
  combos: readonly Combo[];
  sites: readonly Site[];
};

const settlementSites: readonly Site[] = [
  { biome: "grassland", amount: 3, toxicity: 1 },
  { biome: "plains", amount: 2, toxicity: 1 },
  { biome: "desert", amount: 1, toxicity: 2 },
  { biome: "tundra", amount: 2, toxicity: 2 },
  { biome: "polar_desert", amount: 1, toxicity: 3 },
  { biome: "swamp", amount: 2, toxicity: 3 },
  { biome: "badlands", amount: 1, toxicity: 4 },
  { biome: "cliffs", amount: 1, toxicity: 0 },
];

const settlementCombos: readonly Combo[] = [
  { amount: 1, toxicity: 0 },
  { amount: 2, toxicity: 2 },
  { amount: 3, toxicity: 3 },
  { amount: 1, toxicity: 1 },
];

const buildingKinds: readonly BuildingKind[] = [
  {
    id: "farm",
    title: "ферма",
    resource: "food",
    cost: { wood: 2 },
    combos: [
      { amount: 1, toxicity: 0 },
      { amount: 5, toxicity: 0 },
      { amount: 3, toxicity: 0 },
      { amount: 3, toxicity: 0 },
    ],
    sites: [
      { biome: "grassland", amount: 4, toxicity: 1 },
      { biome: "plains", amount: 2, toxicity: 0 },
      { biome: "tundra", amount: 2, toxicity: 0 },
      { biome: "swamp", amount: 5, toxicity: 3 },
      { biome: "hills", amount: 3, toxicity: 1 },
    ],
  },
  {
    id: "mine",
    title: "рудник",
    resource: "stone",
    cost: { wood: 3, hammers: 1 },
    combos: [
      { amount: 1, toxicity: 0 },
      { amount: 5, toxicity: 3 },
      { amount: 3, toxicity: 2 },
      { amount: 3, toxicity: 1 },
    ],
    sites: [
      { biome: "mountains", amount: 7, toxicity: 3 },
      { biome: "volcano", amount: 10, toxicity: 5 },
      { biome: "crater", amount: 3, toxicity: 1 },
      { biome: "cliffs", amount: 4, toxicity: 1 },
      { biome: "swamp", amount: 2, toxicity: 1 },
    ],
  },
  {
    id: "sawmill",
    title: "лесопилка",
    resource: "wood",
    cost: { stone: 3 },
    combos: [
      { amount: 1, toxicity: 0 },
      { amount: 5, toxicity: 3 },
      { amount: 3, toxicity: 2 },
      { amount: 3, toxicity: 1 },
    ],
    sites: [
      { biome: "forrest", amount: 5, toxicity: 1 },
      { biome: "savanna", amount: 2, toxicity: 0 },
      { biome: "rainforest", amount: 8, toxicity: 4 },
      { biome: "taiga", amount: 5, toxicity: 2 },
    ],
  },
  {
    id: "village",
    title: "деревня",
    resource: "population",
    cost: { wood: 4, stone: 2 },
    combos: settlementCombos,
    sites: settlementSites,
  },
  {
    id: "masons",
    title: "гильдия масонов",
    resource: "hammers",
    cost: { stone: 5, wood: 2 },
    combos: settlementCombos,
    sites: settlementSites,
  },
  {
    id: "observatory",
    title: "обсерватория",
    resource: "scouting",
    cost: { stone: 4, wood: 4 },
    combos: settlementCombos,
    sites: settlementSites,
  },
  {
    id: "university",
    title: "университет",
    resource: "science",
    cost: { stone: 6, hammers: 2 },
    combos: settlementCombos,
    sites: settlementSites,
  },
];

export { buildingKinds };
export type { BuildingKind, BuildingKindId, Site };
