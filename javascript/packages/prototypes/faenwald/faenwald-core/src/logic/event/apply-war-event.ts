import type { TGameState } from "../../model/game-context.js";
import type {
  TGameTurnPhaseWarEvent,
  TWarEvent_ArmyCorrection,
  TWarEvent_ArmyMoveCommand,
  TWarEvent_ArmyMoved,
  TWarEvent_ProvincePillaged
} from "../../model/war/war.js";
import { numberToFixed2 } from "../../utils.js";
import type { TWarEvent_Battle } from "../../model/war/battle.js";
import { calculateUnitAmountAfterBattle } from "../war/battle.js";

const applyProvincePillaged = (
  gameState: TGameState,
  event: TWarEvent_ProvincePillaged,
) => {
  const army = gameState.armies[event.armyId]!;
  const provinceId = army.provinceId;
  const province = gameState.provinces[provinceId]!;

  const pillagedTurnover = province.turnover * event.percent;
  const accumulatedRobbery = numberToFixed2(pillagedTurnover / 3);

  army.accumulatedRobbery += accumulatedRobbery;
  province.turnover -= pillagedTurnover;
  province.supply = province.turnover * 0.00001;
};

const applyBattleEvent = (
  gameState: TGameState,
  event: TWarEvent_Battle,
) => {
  if (event.winner === "pending") {
    return;
  }

  for (const armyId of event.attack) {
    const army = gameState.armies[armyId]!;
    for (const unit of army.units) {
      const battleUnit = event.battleUnits[unit.id]!;
      const newAmount = calculateUnitAmountAfterBattle(battleUnit.hp, battleUnit.afterBattleHp, battleUnit.peopleAmount);
      unit.amount = newAmount;
    }
  }
};

const applyFortressAssault = (
  _: TGameState,
  __: any,
) => {
  // TODO

  return;
};

const applySiegeStarted = (
  _: TGameState,
  __: any,
) => {
  // TODO

  return;
};

const applyArmyMoved = (
  gameState: TGameState,
  event: TWarEvent_ArmyMoved,
) => {
  const army = gameState.armies[event.armyId];
  if (!army) {
    return;
  }

  army.provinceId = event.newProvinceId;
};

const applyArmyMoveCommand = (
  gameState: TGameState,
  event: TWarEvent_ArmyMoveCommand,
) => {
  const army = gameState.armies[event.armyId];
  if (!army) {
    return;
  }

  army.movement = event.movement;
};

const applyUnitStartCreating = (
  _: TGameState,
  __: any,
) => {
  return;
};

const applyUnitCreated = (
  _: TGameState,
  __: any,
) => {
  return;
};

const applyArmyCorrection = (
  gameState: TGameState,
  event: TWarEvent_ArmyCorrection,
) => {
  const army = gameState.armies[event.armyId];
  if (!army) {
    return;
  }

  const newUnits = army.units.filter((unit) => event.deletedUnits.includes(unit.id) === false);

  for (const addedUnit of event.addedUnits) {
    newUnits.push(addedUnit);
  }

  army.units = newUnits;
};

const WAR_EVENT_TYPE_TO_HANDLER: Record<TGameTurnPhaseWarEvent["event"]["type"], (gameState: TGameState, event: any) => void> = {
  "TWarEvent_ProvincePillaged": applyProvincePillaged,
  "TWarEvent_Battle": applyBattleEvent,
  "TWarEvent_FortressAssault": applyFortressAssault,
  "TWarEvent_SiegeStarted": applySiegeStarted,
  "TWarEvent_ArmyMoved": applyArmyMoved,
  "TWarEvent_ArmyMoveCommand": applyArmyMoveCommand,
  "TWarEvent_UnitStartCreating": applyUnitStartCreating,
  "TWarEvent_UnitCreated": applyUnitCreated,
  "TWarEvent_ArmyCorrection": applyArmyCorrection,
};

export const applyWarEvent = (gameState: TGameState, event: TGameTurnPhaseWarEvent) => {
  const handler = WAR_EVENT_TYPE_TO_HANDLER[event.event.type];

  if (handler) {
    handler(gameState, event.event);
  }
};
