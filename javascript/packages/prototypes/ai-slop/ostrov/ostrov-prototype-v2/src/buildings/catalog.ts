import type { GameConfig } from "@hw/ostrov-prototype-v2-config";
import { SCHEMA, config } from "@hw/ostrov-prototype-v2-config";
import { BUILD_TIME_MIN_SEC, BUILD_TIME_SPEEDUP } from "../tuning";

/**
 * The building roster, read straight out of the config library.
 *
 * Labels, costs, build times and prerequisites all come from `config` and from
 * `SCHEMA.buildings.entities`. Nothing here retypes a number the designer owns.
 *
 * The one thing the config schema has no room for is the category a building
 * belongs to, so `CATEGORIES` below is local. It is a follow-up candidate for a
 * `category` enum field on the `buildings` group; once that field exists this
 * map goes away and the panel groups on `config.buildings[id].category`.
 */

type BuildingId = keyof GameConfig["buildings"];

type BuildingValues = GameConfig["buildings"][BuildingId];

type CategoryId = "core" | "economic" | "war" | "magic" | "defense";

type Category = {
  id: CategoryId;
  /** Heading shown above the group. */
  label: string;
  /** Buildings of this category, in display order. May be empty. */
  buildings: readonly BuildingId[];
};

/** Display order of the five groups. An empty group still renders, with a note. */
const CATEGORIES: readonly Category[] = [
  { id: "core", label: "Основа", buildings: ["castle1", "hut1", "islandController1"] },
  { id: "economic", label: "Экономика", buildings: ["sawmill1", "mill1", "mine1"] },
  { id: "war", label: "Война", buildings: ["barracks1"] },
  { id: "magic", label: "Магия", buildings: [] },
  { id: "defense", label: "Оборона", buildings: [] },
];

/** Value of `requires` for a building that is available from the first minute. */
const NO_PREREQUISITE = "none";

/** The building whose full flow is implemented; everything else uses the placeholder art. */
const CASTLE_ID: BuildingId = "castle1";

type BuildingSpec = BuildingValues & {
  id: BuildingId;
  label: string;
};

function buildingSpec(id: BuildingId): BuildingSpec {
  return { id, label: SCHEMA.buildings.entities[id].label, ...config.buildings[id] };
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

/** Every building id the roster knows, in category order. */
function allBuildingIds(): BuildingId[] {
  return CATEGORIES.flatMap((category) => [...category.buildings]);
}

export type { BuildingId, BuildingSpec, Category, CategoryId };
export {
  CASTLE_ID,
  CATEGORIES,
  NO_PREREQUISITE,
  allBuildingIds,
  buildingLabel,
  buildingSpec,
  constructionSeconds,
  prerequisiteOf,
};
