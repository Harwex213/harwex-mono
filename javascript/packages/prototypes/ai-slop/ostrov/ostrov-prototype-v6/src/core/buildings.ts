import farmArt from "../assets/buildings/farm.png";
import masonsGuildArt from "../assets/buildings/masons-guild.png";
import mineArt from "../assets/buildings/mine.png";
import observatoryArt from "../assets/buildings/observatory.png";
import sawmillArt from "../assets/buildings/sawmill.png";
import universityArt from "../assets/buildings/university.png";
import villageArt from "../assets/buildings/village.png";
import type {
  TBiomeId,
  TBuildCost,
  TBuilding,
  TBuildingId,
  TFace,
  TResourcePool,
  TYieldResourceId,
} from "./types";

/**
 * The seven buildings of the spec, with their yield tables copied from it
 * verbatim. A building is a die: `baseFaces` are the faces every copy has, and
 * the biome it stands on adds one more face. The tax phase rolls one face.
 */

const face = (resource: TYieldResourceId, amount: number, toxicity: number): TFace => ({
  resource,
  amount,
  toxicity,
});

/**
 * Village, masons guild, observatory and university are written in the spec
 * with the same numbers on the same eight biomes; only the resource differs.
 */
const settlementBaseFaces = (resource: TYieldResourceId): readonly TFace[] => [
  face(resource, 1, 0),
  face(resource, 2, 2),
  face(resource, 3, 3),
  face(resource, 1, 1),
];

const settlementBiomeFaces = (resource: TYieldResourceId): Readonly<Partial<Record<TBiomeId, TFace>>> => ({
  grassland: face(resource, 3, 1),
  plains: face(resource, 2, 1),
  desert: face(resource, 1, 2),
  tundra: face(resource, 2, 2),
  polar_desert: face(resource, 1, 3),
  swamp: face(resource, 2, 3),
  badlands: face(resource, 1, 4),
  cliffs: face(resource, 1, 0),
});

const BUILDINGS: readonly TBuilding[] = [
  {
    id: "farm",
    label: "Ферма",
    yields: "food",
    art: farmArt,
    cost: { stone: 1, wood: 3, hammers: 1 },
    baseFaces: [face("food", 1, 0), face("food", 5, 0), face("food", 3, 0), face("food", 3, 0)],
    biomeFaces: {
      grassland: face("food", 4, 1),
      plains: face("food", 2, 0),
      tundra: face("food", 2, 0),
      swamp: face("food", 5, 3),
      hills: face("food", 3, 1),
    },
  },
  {
    id: "mine",
    label: "Рудник",
    yields: "stone",
    art: mineArt,
    cost: { stone: 3, wood: 2, hammers: 2 },
    baseFaces: [face("stone", 1, 0), face("stone", 5, 3), face("stone", 3, 2), face("stone", 3, 1)],
    biomeFaces: {
      mountains: face("stone", 7, 3),
      volcano: face("stone", 10, 5),
      crater: face("stone", 3, 1),
      cliffs: face("stone", 4, 1),
      swamp: face("stone", 2, 1),
    },
  },
  {
    id: "sawmill",
    label: "Лесопилка",
    yields: "wood",
    art: sawmillArt,
    cost: { stone: 2, wood: 3, hammers: 1 },
    baseFaces: [face("wood", 1, 0), face("wood", 5, 3), face("wood", 3, 2), face("wood", 3, 1)],
    biomeFaces: {
      forrest: face("wood", 5, 1),
      savanna: face("wood", 2, 0),
      rainforest: face("wood", 8, 4),
      taiga: face("wood", 5, 2),
    },
  },
  {
    id: "village",
    label: "Деревня",
    yields: "population",
    art: villageArt,
    cost: { stone: 3, wood: 3, hammers: 1 },
    baseFaces: settlementBaseFaces("population"),
    biomeFaces: settlementBiomeFaces("population"),
  },
  {
    id: "masons_guild",
    label: "Гильдия масонов",
    yields: "hammers",
    art: masonsGuildArt,
    cost: { stone: 4, wood: 2, hammers: 2 },
    baseFaces: settlementBaseFaces("hammers"),
    biomeFaces: settlementBiomeFaces("hammers"),
  },
  {
    id: "observatory",
    label: "Обсерватория",
    yields: "scouting",
    art: observatoryArt,
    cost: { stone: 3, wood: 3, hammers: 3 },
    baseFaces: settlementBaseFaces("scouting"),
    biomeFaces: settlementBiomeFaces("scouting"),
  },
  {
    id: "university",
    label: "Университет",
    yields: "science",
    art: universityArt,
    cost: { stone: 4, wood: 4, hammers: 3 },
    baseFaces: settlementBaseFaces("science"),
    biomeFaces: settlementBiomeFaces("science"),
  },
];

const BUILDING_BY_ID = new Map(BUILDINGS.map((building) => [building.id, building]));

const getBuilding = (id: TBuildingId) => {
  const building = BUILDING_BY_ID.get(id);
  if (!building) {
    throw new Error(`Unknown building: ${id}`);
  }

  return building;
};

/** A building can stand on a biome only if the spec gives it a face there. */
const canBuildOn = (building: TBuilding, biomeId: TBiomeId) => {
  return building.biomeFaces[biomeId] !== undefined;
};

const buildingsForBiome = (biomeId: TBiomeId) => {
  return BUILDINGS.filter((building) => canBuildOn(building, biomeId));
};

/** The die a building becomes once it stands on a biome: base faces plus one. */
const facesOn = (building: TBuilding, biomeId: TBiomeId): readonly TFace[] => {
  const biomeFace = building.biomeFaces[biomeId];
  if (!biomeFace) {
    return building.baseFaces;
  }

  return [...building.baseFaces, biomeFace];
};

/** Average yield of the die, which is what the hex modal ranks buildings by. */
const averageYieldOn = (building: TBuilding, biomeId: TBiomeId) => {
  const faces = facesOn(building, biomeId);

  return faces.reduce((sum, item) => sum + item.amount, 0) / faces.length;
};

const averageToxicityOn = (building: TBuilding, biomeId: TBiomeId) => {
  const faces = facesOn(building, biomeId);

  return faces.reduce((sum, item) => sum + item.toxicity, 0) / faces.length;
};

/** What the hex modal suggests: the allowed building with the richest die. */
const bestBuildingForBiome = (biomeId: TBiomeId) => {
  const allowed = buildingsForBiome(biomeId);
  if (allowed.length === 0) {
    return null;
  }

  return allowed.reduce((best, building) => {
    return averageYieldOn(building, biomeId) > averageYieldOn(best, biomeId) ? building : best;
  });
};

/** The price after technologies. Masonry takes a stone off every building. */
const effectiveCost = (building: TBuilding, stoneDiscount: number): TBuildCost => ({
  stone: Math.max(0, building.cost.stone - stoneDiscount),
  wood: building.cost.wood,
  hammers: building.cost.hammers,
});

const canAfford = (pool: TResourcePool, building: TBuilding, stoneDiscount = 0) => {
  const cost = effectiveCost(building, stoneDiscount);

  return pool.stone >= cost.stone && pool.wood >= cost.wood && pool.hammers >= cost.hammers;
};

export {
  averageToxicityOn,
  averageYieldOn,
  bestBuildingForBiome,
  BUILDINGS,
  buildingsForBiome,
  canAfford,
  canBuildOn,
  effectiveCost,
  facesOn,
  getBuilding,
};
