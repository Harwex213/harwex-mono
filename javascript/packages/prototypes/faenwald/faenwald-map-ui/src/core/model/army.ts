type TArmyUnitType = |
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

type TArmyUnitTypeModifierSource = "system" | "custom";

type TArmyUnitTypeModifierProperty = |
  "baseHp" |
  "baseAttack" |
  "baseMorale" |
  "baseSpeed";

type TArmyUnitModifierImplication = {
  modifierProperty: TArmyUnitTypeModifierProperty;
  modifierType: "percent" | "value";
  modifierValue: number;
}

type TArmyUnitModifier = {
  id: number;
  name: string;
  source: TArmyUnitTypeModifierSource;
  implications: TArmyUnitModifierImplication[];
}

type TArmyUnitKind = |
  "regular" |
  "liege" |
  "vassal";

type THouse = {
  id: number;
  name: string;
  leader: string;
  authority: number;
}

type TArmyUnit = {
  id: number;
  kind: TArmyUnitKind;
  type: TArmyUnitType;
  amount: number;
  baseHp: number;
  baseAttack: number;
  baseMorale: number;
  baseSpeed: number;
  stripes: number;
  rank: number;
  modifiers: TArmyUnitModifier[];
  house: THouse;
};

type TArmyUnitTemplate = Pick<
  TArmyUnit,
  "type" |
  "baseHp" |
  "baseAttack" |
  "baseMorale" |
  "baseSpeed"
>

type TArmy = {
  id: number;
  units: TArmyUnit[];
  provinceId: string;
};

export type {
  TArmyUnitType,
  TArmyUnitTypeModifierSource,
  TArmyUnitTypeModifierProperty,
  TArmyUnitModifier,
  TArmyUnitKind,
  THouse,
  TArmyUnit,
  TArmyUnitTemplate,
  TArmy,
};
