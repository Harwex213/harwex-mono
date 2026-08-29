import { BUILDING_DEFS, canAfford } from "./buildings";
import type { TBuildingKind, TPlacedBuilding, TResources } from "./types";
import type { TTile } from "../world/types";

/** Why a tile cannot take a building, or `null` when it can. */
type TBuildRefusal = "off-map" | "occupied" | "wrong-terrain" | "too-expensive" | "finished" | null;

const REFUSAL_LABELS: Record<Exclude<TBuildRefusal, null>, string> = {
  "off-map": "Не суша",
  occupied: "Клетка занята",
  "wrong-terrain": "Другой тип клетки",
  "too-expensive": "Не хватает ресурсов",
  finished: "Партия окончена",
};

type TBuildQuery = {
  tile: TTile | undefined;
  occupant: TPlacedBuilding | null;
  resources: TResources;
  kind: TBuildingKind;
  victory: boolean;
};

const buildRefusal = (query: TBuildQuery): TBuildRefusal => {
  if (query.victory) {
    return "finished";
  }
  if (!query.tile || !query.tile.isLand) {
    return "off-map";
  }
  if (query.occupant) {
    return "occupied";
  }
  if (BUILDING_DEFS[query.kind].terrain !== query.tile.terrain) {
    return "wrong-terrain";
  }
  if (!canAfford(query.resources, BUILDING_DEFS[query.kind].cost)) {
    return "too-expensive";
  }

  return null;
};

export type { TBuildQuery, TBuildRefusal };
export { REFUSAL_LABELS, buildRefusal };
