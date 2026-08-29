export type { TResourceKind, TResources } from "./resources";
export type { TBuildingDef, TBuildingKind, TPlacementRule } from "./building-def";
export type { TBuildingData, TBuildingStatus } from "./building";
export type { TPlacementCheck, TPlacementContext, TPlacementProblem } from "./placement";
export type { TSettlementData, TTurnEvent, TTurnReport } from "./settlement";

export { Building } from "./building";
export { Settlement } from "./settlement";
export { BUILDING_CATALOG, buildingDef } from "./catalog";
export { checkPlacement, placeableTiles } from "./placement";
export {
  EMPTY_RESOURCES,
  RESOURCE_LABELS,
  RESOURCE_LIST,
  RESOURCE_PURPOSES,
  addResources,
  canAfford,
  missingResources,
  resources,
  scaleResources,
  subtractResources,
} from "./resources";
