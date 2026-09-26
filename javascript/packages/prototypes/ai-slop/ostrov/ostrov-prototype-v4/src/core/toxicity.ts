import { BUILDINGS, DEAD_HEX_TOXICITY } from "./buildings";

import type { THex, TIsland, TResourceId, TResources, TRng, TTechId, TYieldEntry } from "./types";

/**
 * The toxic economy: how a hex pays out once it is poisoned, how the poison
 * turns citizens into insane ones, what everybody eats and when the island riots.
 * Plan §3.1 and the `50-100` spec node.
 */

/** A hex at this toxicity produces nothing and cannot be built on. */
const TOXICITY_FULL_PERCENT = 100;

/** A farm on a hex this toxic produces no food at all, whatever the formula says. */
const FARM_DEAD_TOXICITY_PERCENT = 50;

const IRRIGATION_FOOD_BONUS = 1;
const DEEP_SHAFTS_STONE_BONUS = 2;
const DEEP_SHAFTS_TOXICITY_PENALTY = 1;
const STAR_CHARTS_SCOUTING_BONUS = 1;
const SCRUBBERS_TOXICITY_RELIEF = 1;

/** Output the insane drag down: hammers, science and scouting (plan §3.1 point 3). */
const INSANE_DRAGGED_RESOURCES: readonly TResourceId[] = ["hammers", "science", "scouting"];
const INSANE_MULTIPLIER_FLOOR = 0.5;
const INSANE_MULTIPLIER_PER_INSANE = 0.02;

const TOXICITY_POINTS_PER_INSANE = 10;

const FOOD_PER_POPULATION = 1;
const FOOD_PER_INSANE = 2;
const STARVATION_POPULATION_DIVISOR = 2;
const STARVATION_INSANE_DIVISOR = 5;

const RIOT_POPULATION_RATIO = 0.5;
const RIOT_CHANCE_MAX_PERCENT = 80;
const RIOT_CHANCE_OFFSET_PERCENT = 50;
const PERCENT_SCALE = 100;

const MANA_PER_TURN = 1;
const SCIENCE_PER_EXTRA_MANA = 10;

/** Plan §3.5. */
const INITIAL_RESOURCES: TResources = {
  food: 20,
  stone: 30,
  wood: 30,
  population: 6,
  hammers: 5,
  science: 0,
  scouting: 4,
  mana: 2,
  toxicity: 0,
  insane: 0,
};

/** What one hex pays this tax phase, or `null` when it pays nothing at all. */
const hexYield = (hex: THex, researched: readonly TTechId[]): TYieldEntry | null => {
  if (hex.building === null) {
    return null;
  }
  if (hex.toxicity >= DEAD_HEX_TOXICITY) {
    return null;
  }
  const info = BUILDINGS[hex.building];
  const base = info.yields[hex.biome];
  if (base === undefined) {
    return null;
  }
  let amount = Math.floor(base.amount * (1 - hex.toxicity / TOXICITY_FULL_PERCENT));
  let toxicity = base.toxicity;
  if (hex.building === "farm" && researched.includes("irrigation") === true) {
    amount += IRRIGATION_FOOD_BONUS;
  }
  if (hex.building === "mine" && researched.includes("deep_shafts") === true) {
    amount += DEEP_SHAFTS_STONE_BONUS;
    toxicity += DEEP_SHAFTS_TOXICITY_PENALTY;
  }
  if (hex.building === "observatory" && researched.includes("star_charts") === true) {
    amount += STAR_CHARTS_SCOUTING_BONUS;
  }
  if (researched.includes("scrubbers") === true) {
    toxicity = Math.max(0, toxicity - SCRUBBERS_TOXICITY_RELIEF);
  }
  if (hex.building === "farm" && hex.toxicity >= FARM_DEAD_TOXICITY_PERCENT) {
    amount = 0;
  }
  return {
    hexId: hex.id,
    resource: info.produces,
    amount: Math.max(0, amount),
    toxicity,
  };
};

/** The multiplier the insane put on hammers, science and scouting. */
const insaneMultiplier = (insane: number): number => {
  return Math.max(INSANE_MULTIPLIER_FLOOR, 1 - INSANE_MULTIPLIER_PER_INSANE * insane);
};

/** Every payout of the tax phase, one entry per producing hex. */
const computeTaxYields = (
  island: TIsland,
  researched: readonly TTechId[],
  insane: number,
): readonly TYieldEntry[] => {
  const multiplier = insaneMultiplier(insane);
  const entries: TYieldEntry[] = [];
  for (const hex of Object.values(island.hexes)) {
    const entry = hexYield(hex, researched);
    if (entry === null) {
      continue;
    }
    if (INSANE_DRAGGED_RESOURCES.includes(entry.resource) === false) {
      entries.push(entry);
      continue;
    }
    entries.push({ ...entry, amount: Math.floor(entry.amount * multiplier) });
  }
  return entries;
};

/** Adds every payout to its resource and every hex's poison to the island total. */
const applyYields = (resources: TResources, yields: readonly TYieldEntry[]): TResources => {
  const next: TResources = { ...resources };
  for (const entry of yields) {
    next[entry.resource] += entry.amount;
    next.toxicity += entry.toxicity;
  }
  return next;
};

/** Poison turns citizens into insane ones, capped by how many citizens are left. */
const applyInsaneConversion = (resources: TResources, toxicityPoints: number): TResources => {
  const converted = Math.min(
    Math.floor(toxicityPoints / TOXICITY_POINTS_PER_INSANE),
    resources.population,
  );
  return {
    ...resources,
    population: resources.population - converted,
    insane: resources.insane + converted,
  };
};

/** A citizen eats one food, an insane one eats two. A deficit kills and maddens. */
const applyUpkeep = (resources: TResources): TResources => {
  const eaten = resources.population * FOOD_PER_POPULATION + resources.insane * FOOD_PER_INSANE;
  const food = resources.food - eaten;
  if (food >= 0) {
    return { ...resources, food };
  }
  const deficit = -food;
  const starved = Math.floor(deficit / STARVATION_POPULATION_DIVISOR);
  const maddened = Math.floor(deficit / STARVATION_INSANE_DIVISOR);
  return {
    ...resources,
    food: 0,
    population: Math.max(0, resources.population - starved),
    insane: resources.insane + maddened,
  };
};

/** The chance in percent that the island riots this tax phase. */
const riotChancePercent = (resources: TResources): number => {
  if (resources.insane <= resources.population * RIOT_POPULATION_RATIO) {
    return 0;
  }
  const ratio = Math.round(resources.insane / Math.max(1, resources.population) * PERCENT_SCALE);
  return Math.max(0, Math.min(RIOT_CHANCE_MAX_PERCENT, ratio - RIOT_CHANCE_OFFSET_PERCENT));
};

const rollRiot = (rng: TRng, resources: TResources): boolean => {
  const chance = riotChancePercent(resources);
  if (chance <= 0) {
    return false;
  }
  return rng.next() * PERCENT_SCALE < chance;
};

/** Mana has no producer in the spec, so science pays for it (plan §3.1). */
const manaIncome = (science: number): number => {
  return MANA_PER_TURN + Math.floor(science / SCIENCE_PER_EXTRA_MANA);
};

const islandToxicityPoints = (island: TIsland): number => {
  let total = 0;
  for (const hex of Object.values(island.hexes)) {
    total += hex.toxicity;
  }
  return total;
};

const islandToxicityPercent = (island: TIsland): number => {
  const hexes = Object.values(island.hexes);
  if (hexes.length === 0) {
    return 0;
  }
  return islandToxicityPoints(island) / hexes.length;
};

export {
  FARM_DEAD_TOXICITY_PERCENT,
  INITIAL_RESOURCES,
  TOXICITY_FULL_PERCENT,
  applyInsaneConversion,
  applyUpkeep,
  applyYields,
  computeTaxYields,
  hexYield,
  insaneMultiplier,
  islandToxicityPercent,
  islandToxicityPoints,
  manaIncome,
  riotChancePercent,
  rollRiot,
};
