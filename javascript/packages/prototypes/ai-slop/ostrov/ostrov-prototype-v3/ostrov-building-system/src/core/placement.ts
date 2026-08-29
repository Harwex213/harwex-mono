import { hexKey, neighboursOf } from "@hw/ostrov-utils";
import type { Island, TTile } from "@hw/ostrov-island-system";
import { canAfford, missingResources } from "./resources";
import { RESOURCE_LABELS } from "./resources";
import type { Building } from "./building";
import type { TBuildingDef } from "./building-def";
import type { TResources } from "./resources";

type TPlacementProblem =
  | "water"
  | "occupied"
  | "terrain"
  | "coast"
  | "adjacency"
  | "unique"
  | "requires"
  | "resources";

type TPlacementCheck = {
  ok: boolean;
  problems: TPlacementProblem[];
  /** Human-readable reasons in the same order as `problems`. */
  reasons: string[];
};

type TPlacementContext = {
  island: Island;
  buildings: readonly Building[];
  resources: TResources;
};

/**
 * Every rule a placement must pass, checked in the order they are listed, so
 * "under water" comes before "too expensive". All failures are reported so the
 * UI can list them; `ok` is true only when there are none.
 */
const checkPlacement = (context: TPlacementContext, def: TBuildingDef, tile: TTile): TPlacementCheck => {
  const { buildings, resources } = context;
  const problems: TPlacementProblem[] = [];
  const reasons: string[] = [];
  const fail = (problem: TPlacementProblem, reason: string) => {
    problems.push(problem);
    reasons.push(reason);
  };

  if (!tile.land || tile.terrain === null) {
    fail("water", "Здесь вода");

    return { ok: false, problems, reasons };
  }

  if (buildings.some((building) => building.tileKey === tile.key)) {
    fail("occupied", "Клетка занята");
  }

  if (!def.placement.terrains.includes(tile.terrain)) {
    fail("terrain", "Не тот тип земли");
  }

  if (def.placement.coastal && !tile.coastal) {
    fail("coast", "Нужен берег");
  }

  if (def.placement.adjacent) {
    const touches = neighboursOf(tile).some((neighbour) => {
      const key = hexKey(neighbour.q, neighbour.r);

      return buildings.some((building) => building.tileKey === key);
    });

    if (!touches) {
      fail("adjacency", "Нет соседней постройки");
    }
  }

  if (def.unique && buildings.some((building) => building.kind === def.id)) {
    fail("unique", "Может быть только одна");
  }

  if (def.requires) {
    const required = def.requires;
    const has = buildings.some((building) => building.kind === required && building.isActive);

    if (!has) {
      fail("requires", `Сначала нужна постройка: ${required}`);
    }
  }

  if (!canAfford(resources, def.cost)) {
    const missing = missingResources(resources, def.cost).map((kind) => RESOURCE_LABELS[kind].toLowerCase());

    fail("resources", `Не хватает: ${missing.join(", ")}`);
  }

  return { ok: problems.length === 0, problems, reasons };
};

/** Every land tile where `def` could go right now. */
const placeableTiles = (context: TPlacementContext, def: TBuildingDef) => {
  return context.island.landTiles().filter((tile) => checkPlacement(context, def, tile).ok);
};

export type { TPlacementCheck, TPlacementContext, TPlacementProblem };
export { checkPlacement, placeableTiles };
