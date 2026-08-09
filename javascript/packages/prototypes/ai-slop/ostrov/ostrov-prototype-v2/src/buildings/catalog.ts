import type { GameConfig } from "@hw/ostrov-prototype-v2-config";
import { BUILDING_CATEGORY_OPTIONS, SCHEMA, config } from "@hw/ostrov-prototype-v2-config";
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

/** The building whose full flow is implemented; everything else uses the placeholder art. */
const CASTLE_ID: BuildingId = "castle1";

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

export type { BuildingId, BuildingSpec, Category, CategoryId };
export {
  CASTLE_ID,
  CATEGORIES,
  NO_PREREQUISITE,
  allBuildingIds,
  buildingLabel,
  buildingSpec,
  buildingsOfCategory,
  constructionSeconds,
  prerequisiteOf,
};
