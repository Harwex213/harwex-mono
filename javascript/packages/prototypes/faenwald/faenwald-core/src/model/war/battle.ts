import type { TArmyUnitType, TArmyUnitTypeModifierProperty } from "./army.js";

export type TWarBattleUnit = {
  id: string;
  side: "attacker" | "defender";
  type: TArmyUnitType;
  hp: number;
  afterBattleHp: number;
  attack: number;
  morale: number;
  speed: number;
  thresholdHpForRetreat: number;
  peopleAmount: number;
};

export type TWarEvent_Battle = {
  type: "TWarEvent_Battle";
  eventId: string;
  provinceId: string;
  attack: string[]; // armyId[]
  defense: string[]; // armyId[]
  battleUnits: Record<string, TWarBattleUnit> // Record<unitId, TWarBattleUnit>
  winner: "attacker" | "defender" | "pending";
};

// TODO: defense mechanisms
export type TWarEvent_FortressAssault = {
  type: "TWarEvent_FortressAssault";
  eventId: string;
  provinceId: string;
  attack: string[]; // armyId[]
  battleUnits: Record<string, TWarBattleUnit> // Record<unitId, TWarBattleUnit>
  winner: "attacker" | "defender" | "pending";
};

export type TWarBattleUnitModifierProperty = |
  "hp" |
  "attack" |
  "morale" |
  "speed";

export const UNIT_PROPERTY_TO_BATTLE_UNIT_PROPERTY: Record<TArmyUnitTypeModifierProperty, TWarBattleUnitModifierProperty> = {
  baseHp: "hp",
  baseAttack: "attack",
  baseMorale: "morale",
  baseSpeed: "speed",
}
