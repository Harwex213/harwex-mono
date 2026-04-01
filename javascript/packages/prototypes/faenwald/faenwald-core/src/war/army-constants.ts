import { TArmyUnitModifier, TArmyUnitTemplate, TArmyUnitType } from "./army.js";

const ARMY_UNIT_TYPE_TO_SUPPLY: Record<TArmyUnitType, number> = {
  "light-spearman": 1,
  "medium-spearman": 1,
  "heavy-spearman": 1,
  "axeman": 1,
  "swordsman": 1,
  "klevetsman": 1,
  "light-cavalry": 2,
  "medium-cavalry": 2,
  "heavy-cavalry": 3,
  "archer": 1,
  "cavalry-archer": 2,
  "longbowman": 1,
  "crossbowman": 1,
};

const SYSTEM_ARMY_MODIFIERS: TArmyUnitModifier[] = [
  {
    id: "rank-one",
    name: "Ранг I",
    source: "system",
    implications: [
      {
        modifierProperty: "baseHp",
        modifierType: "percent",
        modifierValue: -25,
      },
      {
        modifierProperty: "baseAttack",
        modifierType: "percent",
        modifierValue: -25,
      },
      {
        modifierProperty: "baseMorale",
        modifierType: "percent",
        modifierValue: -25,
      }
    ]
  },
  {
    id: "rank-three",
    name: "Ранг III",
    source: "system",
    implications: [
      {
        modifierProperty: "baseHp",
        modifierType: "percent",
        modifierValue: 25,
      },
      {
        modifierProperty: "baseAttack",
        modifierType: "percent",
        modifierValue: 25,
      },
      {
        modifierProperty: "baseMorale",
        modifierType: "percent",
        modifierValue: 25,
      }
    ]
  },
  {
    id: "rank-four",
    name: "Ранг IV",
    source: "system",
    implications: [
      {
        modifierProperty: "baseHp",
        modifierType: "percent",
        modifierValue: 50,
      },
      {
        modifierProperty: "baseAttack",
        modifierType: "percent",
        modifierValue: 50,
      },
      {
        modifierProperty: "baseMorale",
        modifierType: "percent",
        modifierValue: 50,
      }
    ]
  },
  {
    id: "rank-five",
    name: "Ранг V",
    source: "system",
    implications: [
      {
        modifierProperty: "baseHp",
        modifierType: "percent",
        modifierValue: 75,
      },
      {
        modifierProperty: "baseAttack",
        modifierType: "percent",
        modifierValue: 75,
      },
      {
        modifierProperty: "baseMorale",
        modifierType: "percent",
        modifierValue: 75,
      }
    ]
  }
];

const ARMY_UNIT_TEMPLATES: Record<TArmyUnitType, TArmyUnitTemplate> = {
  "light-spearman": {
    type: "light-spearman",
    baseHp: 80,
    baseAttack: 12,
    baseMorale: 70,
    baseSpeed: 3,
  },
  "medium-spearman": {
    type: "medium-spearman",
    baseHp: 120,
    baseAttack: 15,
    baseMorale: 85,
    baseSpeed: 2,
  },
  "heavy-spearman": {
    type: "heavy-spearman",
    baseHp: 160,
    baseAttack: 18,
    baseMorale: 110,
    baseSpeed: 1,
  },
  "axeman": {
    type: "axeman",
    baseHp: 60,
    baseAttack: 20,
    baseMorale: 70,
    baseSpeed: 3,
  },
  "swordsman": {
    type: "swordsman",
    baseHp: 90,
    baseAttack: 25,
    baseMorale: 85,
    baseSpeed: 2,
  },
  "klevetsman": {
    type: "klevetsman",
    baseHp: 120,
    baseAttack: 30,
    baseMorale: 100,
    baseSpeed: 1,
  },
  "light-cavalry": {
    type: "light-cavalry",
    baseHp: 70,
    baseAttack: 10,
    baseMorale: 80,
    baseSpeed: 5,
  },
  "medium-cavalry": {
    type: "medium-cavalry",
    baseHp: 95,
    baseAttack: 15,
    baseMorale: 90,
    baseSpeed: 4,
  },
  "heavy-cavalry": {
    type: "heavy-cavalry",
    baseHp: 120,
    baseAttack: 25,
    baseMorale: 100,
    baseSpeed: 3,
  },
  "archer": {
    type: "medium-spearman",
    baseHp: 50,
    baseAttack: 6,
    baseMorale: 70,
    baseSpeed: 3,
  },
  "cavalry-archer": {
    type: "medium-spearman",
    baseHp: 80,
    baseAttack: 6,
    baseMorale: 80,
    baseSpeed: 5,
  },
  "longbowman": {
    type: "medium-spearman",
    baseHp: 60,
    baseAttack: 10,
    baseMorale: 80,
    baseSpeed: 3,
  },
  "crossbowman": {
    type: "medium-spearman",
    baseHp: 60,
    baseAttack: 40,
    baseMorale: 80,
    baseSpeed: 3,
  },
}

export { ARMY_UNIT_TYPE_TO_SUPPLY };
