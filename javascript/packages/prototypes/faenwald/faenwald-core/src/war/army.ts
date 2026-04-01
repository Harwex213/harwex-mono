import type { TModifierImplication, TModifierSource } from "../base/modifier.js";

export type TArmyUnitType = |
  "light-spearman" |
  "medium-spearman" |
  "heavy-spearman" |
  "axeman" |
  "swordsman" |
  "klevetsman" |
  "light-cavalry" |
  "medium-cavalry" |
  "heavy-cavalry" |
  "archer" |
  "cavalry-archer" |
  "longbowman" |
  "crossbowman";

export type TArmyUnitTypeModifierProperty = |
  "baseHp" |
  "baseAttack" |
  "baseMorale" |
  "baseSpeed";

export type TArmyUnitModifier = {
  id: string;
  name: string;
  source: TModifierSource;
  implications: TModifierImplication<TArmyUnitTypeModifierProperty>[];
}

export type TArmyUnitKind = |
  "regular" |
  "liege" |
  "vassal";

export type TArmyUnitRank = "1" | "2" | "3" | "4" | "5";

export type TArmyUnit = {
  kind: TArmyUnitKind;
  type: TArmyUnitType;
  amount: number;
  baseHp: number;
  baseAttack: number;
  baseMorale: number;
  baseSpeed: number;
  stripes: number;
  rank: TArmyUnitRank;
  modifiers: TArmyUnitModifier[];
  houseId: string;
};

export type TArmyUnitTemplate = Pick<
  TArmyUnit,
  "type" |
  "baseHp" |
  "baseAttack" |
  "baseMorale" |
  "baseSpeed"
>

export type TArmy = {
  id: string;
  units: TArmyUnit[];
  provinceId: string;
};
