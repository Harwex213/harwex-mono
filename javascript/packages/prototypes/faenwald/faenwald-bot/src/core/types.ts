export type TArmyUnitKind = "во" | "ло" | "р" | "н" | "г" | "го" | "гн";
export type TArmyUnitType = |
    "лко" |
    "ско" |
    "тко" |
    "топ" |
    "меч" |
    "клев" |
    "лкав" |
    "скав" |
    "ткав" |
    "луч" |
    "лук" |
    "клу" |
    "лон" |
    "лонг" |
    "арб" |
    "мед" |
    "инж";

export type TArmy = {
    name: string;
    units: TArmyUnit[];
};

export type TArmyUnit = {
    kind: TArmyUnitKind;
    type: TArmyUnitType;
    rank: number;
    amount: number;
    maxAmount: number;
    modifiers: TArmyUnitModifier[];
    hp: number;
    attack: number;
    morale: number;
};

export type TArmyUnitModifier = {
    property: "hp" | "attack" | "morale";
    type: "percent" | "value";
    value: number;
};
