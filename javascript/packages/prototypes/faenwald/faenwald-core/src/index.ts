// model - base
export type { THouse, THouseModifier, THouseModifierProperty } from "./model/base/house.js";
export type { TModifierSource, TModifierImplication } from "./model/base/modifier.js";
export type { TProvince, TProvinceRaw } from "./model/base/province.js";

// model - game context
export type {
  TGameTurnPhaseSystemEvent,
  TGameTurnPhaseEvent,
  TGameState,
  TGameTurn,
  TGameContext,
} from "./model/game-context.js";

// model - core error
export { FaenwaldCoreError } from "./model/core-error.js";

// model - war
export type {
  TArmyUnitType,
  TArmyUnitTypeModifierProperty,
  TArmyUnitModifier,
  TArmyUnitKind,
  TArmyUnitRank,
  TArmyUnit,
  TArmyUnitTemplate,
  TArmy,
} from "./model/war/army.js";
export {
  ARMY_UNIT_TYPE_TO_SUPPLY,
  ARMY_UNIT_TEMPLATES,
  ARMY_RANK_TO_MODIFIER,
  ARMY_UNIT_TYPE_TRANSLATE,
  ARMY_RANK_TO_TRANSLATE,
} from "./model/war/army-constants.js";
export type {
  TWarBattleUnit,
  TWarEvent_Battle,
  TWarEvent_FortressAssault,
  TWarBattleUnitModifierProperty,
} from "./model/war/battle.js";
export { UNIT_PROPERTY_TO_BATTLE_UNIT_PROPERTY } from "./model/war/battle.js";
export type {
  TWarEvent_ProvincePillaged,
  TWarEvent_SiegeStarted,
  TWarEvent_ArmyMoved,
  TWarEvent_ArmyMoveCommand,
  TWarEvent_UnitStartCreating,
  TWarEvent_UnitCreated,
  TWarEvent_ArmyCorrection,
  TGameTurnPhaseWarEvent,
} from "./model/war/war.js";
export type {
  TAssaultDeviceUnitType,
  TAssaultDevice,
  TAssaultDeviceTemplate,
  TSiegeArmy,
} from "./model/war/siege.js";

// logic - game
export {
  createGameState,
  assignProvinceSupply,
} from "./logic/game.js";

// logic - event
export { applyWarEvent } from "./logic/event/apply-war-event.js";
export { getWarEvent, createEvent, swapEvents } from "./logic/event/create-event.js";

// logic - war
export {
  calculateArmySupply,
  calculateArmySanitaryLosses,
  calculateArmyUnitSanitaryLossesCost,
  calculateArmySanitaryLossesCost,
} from "./logic/war/army.js";
export {
  createBattleEvent,
  addSideToBattle,
  createBattleUnit,
  createBattleUnits,
  calculateUnitAmountAfterBattle,
  calculateAttackerAmount,
  calculateDefenderAmount,
} from "./logic/war/battle.js";

// utils
export {
  beautifyPercent,
  beautifyNumber,
  numberToFixed2,
  mutableSwap,
} from "./utils.js";
