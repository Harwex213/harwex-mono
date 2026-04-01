// game
export { type TGameTurn, assignProvinceSupply } from "./game.js";

// base
export type { THouse } from "./base/house.js";
export type { TModifierSource, TModifierImplication } from "./base/modifier.js";
export type { TProvince, TProvincesMap } from "./base/province.js";

// war
export type {
  TArmyUnitType,
  TArmyUnitTypeModifierProperty,
  TArmyUnitModifier,
  TArmyUnitKind,
  TArmyUnit,
  TSerializedArmyUnit,
  TArmyUnitTemplate,
  TArmy,
} from "./war/army.js";
export { ARMY_UNIT_TYPE_TO_SUPPLY } from "./war/army-constants.js";
export type {
  TAssaultDeviceUnitType,
  TAssaultDevice,
  TAssaultDeviceTemplate,
  TSiegeArmy,
} from "./war/siege.js";
export type {
  TWarPhaseActionMove,
  TWarPhaseActionRetreat,
  TWarPhaseActionFight,
  TWarPhaseActionSiege,
  TWarPhaseActionAssault,
  TWarPhaseActionPillage,
  TWarPhaseAction,
  TWarPhase,
} from "./war/war.js";
