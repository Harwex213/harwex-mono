import type { GameConfig } from "@hw/ostrov-prototype-v2-config";
import { BUILDING_CATEGORY_OPTIONS, SCHEMA, config } from "@hw/ostrov-prototype-v2-config";
import type { Cost, ResourceKind } from "../economy/stock";
import { costOf } from "../economy/stock";
import { BUILD_TIME_MIN_SEC, BUILD_TIME_SPEEDUP } from "../tuning";

/**
 * The building roster, read straight out of the config library.
 *
 * Labels, costs, build times, prerequisites and the panel section all come from
 * `config` and from `SCHEMA.buildings.entities`. Nothing here retypes a number
 * or a grouping the designer owns.
 */

type BuildingId = keyof GameConfig["buildings"];

type BuildingValues = GameConfig["buildings"][BuildingId];

type CategoryId = BuildingValues["category"];

type Category = {
  id: CategoryId;
  /** Name of the section, as the designer wrote it in the schema. */
  label: string;
};

/** The five sections, in the order the schema declares them. */
const CATEGORIES: readonly Category[] = BUILDING_CATEGORY_OPTIONS.map((option) => ({
  id: option.value,
  label: option.label,
}));

/** Value of `requires` for a building that is available from the first minute. */
const NO_PREREQUISITE = "none";

/** Value of `productionResource` for a building that produces nothing. */
const NO_RESOURCE = "none";

/**
 * Where goods are delivered and what everything else is unlocked by. Two of
 * these on the map are legal: a parcel walks to whichever is nearer.
 */
const CASTLE_ID: BuildingId = "castle1";

/** The one other building with art of its own; the rest share the placeholder cottage. */
const SAWMILL_ID: BuildingId = "sawmill1";

type BuildingSpec = BuildingValues & {
  id: BuildingId;
  label: string;
  /** One paragraph from the schema, shown in the tooltip. */
  description: string;
};

function buildingSpec(id: BuildingId): BuildingSpec {
  const entity = SCHEMA.buildings.entities[id];
  return { id, label: entity.label, description: entity.description, ...config.buildings[id] };
}

function buildingLabel(id: BuildingId): string {
  return SCHEMA.buildings.entities[id].label;
}

/** The building this one needs built first, or null when it is available from the start. */
function prerequisiteOf(id: BuildingId): BuildingId | null {
  const requires = config.buildings[id].requires;
  return requires === NO_PREREQUISITE ? null : (requires as BuildingId);
}

/**
 * How long this building takes to go up in the prototype, in seconds. The
 * config number is balance time; a demo cannot sit through ten minutes of it.
 */
function constructionSeconds(id: BuildingId): number {
  return Math.max(BUILD_TIME_MIN_SEC, config.buildings[id].buildTimeSec / BUILD_TIME_SPEEDUP);
}

/** Every building id the roster knows, in schema order. */
function allBuildingIds(): BuildingId[] {
  return Object.keys(config.buildings) as BuildingId[];
}

/** Buildings the designer put in this section, in schema order. */
function buildingsOfCategory(category: CategoryId): BuildingId[] {
  return allBuildingIds().filter((id) => config.buildings[id].category === category);
}

/** What this building costs to lay. */
function buildingCost(id: BuildingId): Cost {
  const values = config.buildings[id];
  return costOf({ wood: values.costWood, stone: values.costStone, gold: values.costGold });
}

/** Every price the roster holds, in schema order, for the starting-pile derivation. */
function allBuildingCosts(): Record<string, Cost> {
  const costs: Record<string, Cost> = {};
  for (const id of allBuildingIds()) {
    costs[id] = buildingCost(id);
  }
  return costs;
}

/** What this building sends to the castle, or null when it produces nothing. */
function productionOf(id: BuildingId): ResourceKind | null {
  const resource = config.buildings[id].productionResource;
  if (resource === NO_RESOURCE || config.buildings[id].productionPerMin <= 0) {
    return null;
  }
  return resource as ResourceKind;
}

/**
 * Biomes the producers of the first tier stand on.
 *
 * World generation owes the starting islands a few tiles of each: the sawmill
 * wants forest, the mill a meadow and the mine a wasteland, and an island that
 * rolled none of them is an island whose whole economy can never be started.
 * The seed shipped in the config used to produce exactly that — eight ice hexes
 * and one meadow.
 *
 * The test is what a building produces and where it may stand, not what unlocks
 * it: a designer who puts the sawmill behind the castle has not stopped the
 * sawmill needing a wood to cut.
 */
function startingTerrains(): string[] {
  const wanted: string[] = [];
  for (const id of allBuildingIds()) {
    const values = config.buildings[id];
    if (productionOf(id) === null || values.terrain === "any") {
      continue;
    }
    if (!wanted.includes(values.terrain)) {
      wanted.push(values.terrain);
    }
  }
  return wanted;
}

export type { BuildingId, BuildingSpec, Category, CategoryId };
export {
  CASTLE_ID,
  CATEGORIES,
  NO_PREREQUISITE,
  NO_RESOURCE,
  SAWMILL_ID,
  allBuildingCosts,
  allBuildingIds,
  buildingCost,
  buildingLabel,
  buildingSpec,
  buildingsOfCategory,
  constructionSeconds,
  prerequisiteOf,
  productionOf,
  startingTerrains,
};
