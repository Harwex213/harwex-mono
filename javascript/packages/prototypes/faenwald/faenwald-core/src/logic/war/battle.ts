import type { TGameContext, TGameState } from "../../model/game-context.js";
import {
  type TWarBattleUnit,
  type TWarEvent_Battle,
  UNIT_PROPERTY_TO_BATTLE_UNIT_PROPERTY
} from "../../model/war/battle.js";
import { createEvent } from "../event/create-event.js";
import { FaenwaldCoreError } from "../../model/core-error.js";
import type { THouse } from "../../model/base/house.js";
import type { TArmy, TArmyUnit } from "../../model/war/army.js";

export const createBattleEvent = (
  ctx: TGameContext,
  params: {
    currentPhase: number;
    provinceId: string;
  },
) => {
  const battleEvent = {
    type: "TWarEvent_Battle",
    eventId: `TWarEvent_Battle_${ctx.counters.globalEvent++}`,
    provinceId: params.provinceId,
    attack: [],
    defense: [],
    battleUnits: {},
    winner: "pending",
  } satisfies TWarEvent_Battle;

  createEvent(ctx, { event: { type: "war", event: battleEvent } });
};

export const addSideToBattle = (
  gameState: TGameState,
  params: {
    event: TWarEvent_Battle;
    armyId: string;
    side: "attacker" | "defender";
  }
) => {
  const {
    event,
    armyId,
    side,
  } = params;

  const army = gameState.armies[armyId];
  if (!army) {
    throw new FaenwaldCoreError(`Unable to create BattleEvent: army not found with id ${armyId}`);
  }

  const province = gameState.provinces[army.provinceId];
  if (!province) {
    throw new FaenwaldCoreError(`Unable to create BattleEvent: province not found with id ${army.provinceId}`);
  }

  if (province.provinceId !== event.provinceId) {
    throw new FaenwaldCoreError(`Unable to create BattleEvent: tried to assign army, which is not located in battle province, but in ${army.provinceId}`);
  }

  if (side === "attacker") {
    const alreadyExist = event.attack.indexOf(armyId);
    if (alreadyExist === -1) {
      event.attack.push(armyId);
    }
    return;
  }

  const alreadyExist = event.defense.indexOf(armyId);
  if (alreadyExist === -1) {
    event.defense.push(armyId);
  }
  return;
};

export const createBattleUnit = (
  side: "attacker" | "defender",
  unit: TArmyUnit,
  houses: Record<string, THouse>,
): TWarBattleUnit => {
  const battleUnit = {
    id: unit.id,
    side,
    type: unit.type,
    hp: unit.baseHp,
    afterBattleHp: unit.baseHp,
    attack: unit.baseAttack,
    morale: unit.baseMorale,
    speed: unit.baseSpeed,
    thresholdHpForRetreat: 0,
    peopleAmount: unit.amount,
  } satisfies TWarBattleUnit;

  for (const modifier of unit.modifiers) {
    for (const implication of modifier.implications) {
      if (implication.modifierType === "percent") {
        const affectedProperty = UNIT_PROPERTY_TO_BATTLE_UNIT_PROPERTY[implication.modifierProperty];
        battleUnit[affectedProperty] = battleUnit[affectedProperty] * (1 + (implication.modifierValue / 100));
      }

      if (implication.modifierType === "value") {
        const affectedProperty = UNIT_PROPERTY_TO_BATTLE_UNIT_PROPERTY[implication.modifierProperty];
        battleUnit[affectedProperty] = battleUnit[affectedProperty] + implication.modifierValue;
      }
    }
  }

  battleUnit.afterBattleHp = battleUnit.hp;

  if (unit.kind === "regular") {
    return battleUnit;
  }

  const houseAuthority = houses[unit.houseId]!;
  if (houseAuthority.authority < 2) {
    battleUnit.thresholdHpForRetreat = battleUnit.hp * 0.8;
  }
  if (houseAuthority.authority >= 2 && houseAuthority.authority < 3) {
    battleUnit.thresholdHpForRetreat = battleUnit.hp * 0.66;
  }
  if (houseAuthority.authority >= 3 && houseAuthority.authority < 4) {
    battleUnit.thresholdHpForRetreat = battleUnit.hp * 0.5;
  }
  if (houseAuthority.authority >= 4 && houseAuthority.authority < 5) {
    battleUnit.thresholdHpForRetreat = battleUnit.hp * 0.25;
  }

  return battleUnit;
};

export const createBattleUnits = (
  gameState: TGameState,
  event: TWarEvent_Battle,
) => {
  const battleUnits: Record<string, TWarBattleUnit> = {};

  for (const attackerId of event.attack) {
    const army = gameState.armies[attackerId]!;

    for (const unit of army.units) {
      battleUnits[unit.id] = createBattleUnit("attacker", unit, gameState.houses);
    }
  }

  for (const attackerId of event.defense) {
    const army = gameState.armies[attackerId]!;

    for (const unit of army.units) {
      battleUnits[unit.id] = createBattleUnit("defender", unit, gameState.houses);
    }
  }

  event.battleUnits = battleUnits;
};

export const calculateUnitAmountAfterBattle = (
  maxHp: number,
  afterBattleHp: number,
  unitAmount: number = 100
) => unitAmount - (unitAmount * ((1 - (afterBattleHp / maxHp)) / 2));

export const calculateAttackerAmount = (battle: TWarEvent_Battle, armies: Record<string, TArmy>) => {
  let amount = 0;

  for (const armyId of battle.attack) {
    const army = armies[armyId]!;

    for (const unit of army.units) {
      amount += unit.amount;
    }
  }

  return amount;
};

export const calculateDefenderAmount = (battle: TWarEvent_Battle, armies: Record<string, TArmy>) => {
  let amount = 0;

  for (const armyId of battle.defense) {
    const army = armies[armyId]!;

    for (const unit of army.units) {
      amount += unit.amount;
    }
  }

  return amount;
};
