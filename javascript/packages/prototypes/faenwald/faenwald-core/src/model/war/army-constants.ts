import type { TArmyUnitModifier, TArmyUnitRank, TArmyUnitTemplate, TArmyUnitType } from "./army.js";

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

const ARMY_UNIT_TYPE_TRANSLATE: Record<TArmyUnitType, string> = {
  "light-spearman": "Легкий копейщик",
  "medium-spearman": "Средний копейщик",
  "heavy-spearman": "Тяжелый копейщик",
  "axeman": "Топорщик",
  "swordsman": "Мечник",
  "klevetsman": "Клевеносец",
  "light-cavalry": "Лёгкая кавалерия",
  "medium-cavalry": "Средняя кавалерия",
  "heavy-cavalry": "Тяжелая кавалерия",
  "archer": "Лучник",
  "cavalry-archer": "Конный лучник",
  "longbowman": "Длинный лук",
  "crossbowman": "Арбалетчик",
};

const ARMY_RANK_TO_MODIFIER: Record<TArmyUnitRank, TArmyUnitModifier> = {
  "1": {
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
  "2": {
    id: "rank-two",
    name: "Ранг II",
    source: "system",
    implications: [
      {
        modifierProperty: "baseHp",
        modifierType: "value",
        modifierValue: 0,
      },
      {
        modifierProperty: "baseAttack",
        modifierType: "value",
        modifierValue: 0,
      },
      {
        modifierProperty: "baseMorale",
        modifierType: "value",
        modifierValue: 0,
      }
    ]
  },
  "3": {
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
  "4": {
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
  "5": {
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
}

const ARMY_RANK_TO_TRANSLATE: Record<TArmyUnitRank, string> = {
  "1": "I",
  "2": "II",
  "3": "III",
  "4": "IV",
  "5": "V",
};

const ARMY_UNIT_TEMPLATES: Record<TArmyUnitType, TArmyUnitTemplate> = {
  "light-spearman": {
    type: "light-spearman",
    baseHp: 80,
    baseAttack: 12,
    baseMorale: 70,
    baseSpeed: 3,
    baseCost: 20_000,
  },
  "medium-spearman": {
    type: "medium-spearman",
    baseHp: 120,
    baseAttack: 15,
    baseMorale: 85,
    baseSpeed: 2,
    baseCost: 50_000,
  },
  "heavy-spearman": {
    type: "heavy-spearman",
    baseHp: 160,
    baseAttack: 18,
    baseMorale: 110,
    baseSpeed: 1,
    baseCost: 90_000,
  },
  "axeman": {
    type: "axeman",
    baseHp: 60,
    baseAttack: 20,
    baseMorale: 70,
    baseSpeed: 3,
    baseCost: 20_000,
  },
  "swordsman": {
    type: "swordsman",
    baseHp: 90,
    baseAttack: 25,
    baseMorale: 85,
    baseSpeed: 2,
    baseCost: 50_000,
  },
  "klevetsman": {
    type: "klevetsman",
    baseHp: 120,
    baseAttack: 30,
    baseMorale: 100,
    baseSpeed: 1,
    baseCost: 90_000,
  },
  "light-cavalry": {
    type: "light-cavalry",
    baseHp: 70,
    baseAttack: 10,
    baseMorale: 80,
    baseSpeed: 5,
    baseCost: 50_000,
  },
  "medium-cavalry": {
    type: "medium-cavalry",
    baseHp: 95,
    baseAttack: 15,
    baseMorale: 90,
    baseSpeed: 4,
    baseCost: 100_000,
  },
  "heavy-cavalry": {
    type: "heavy-cavalry",
    baseHp: 120,
    baseAttack: 25,
    baseMorale: 100,
    baseSpeed: 3,
    baseCost: 220_000,
  },
  "archer": {
    type: "medium-spearman",
    baseHp: 50,
    baseAttack: 6,
    baseMorale: 70,
    baseSpeed: 3,
    baseCost: 25_000,
  },
  "cavalry-archer": {
    type: "medium-spearman",
    baseHp: 80,
    baseAttack: 6,
    baseMorale: 80,
    baseSpeed: 5,
    baseCost: 80_000,
  },
  "longbowman": {
    type: "medium-spearman",
    baseHp: 60,
    baseAttack: 10,
    baseMorale: 80,
    baseSpeed: 3,
    baseCost: 25_000,
  },
  "crossbowman": {
    type: "medium-spearman",
    baseHp: 60,
    baseAttack: 40,
    baseMorale: 80,
    baseSpeed: 3,
    baseCost: 75_000,
  },
}

export {
  ARMY_UNIT_TYPE_TO_SUPPLY,
  ARMY_UNIT_TYPE_TRANSLATE,
  ARMY_RANK_TO_TRANSLATE,
  ARMY_UNIT_TEMPLATES,
  ARMY_RANK_TO_MODIFIER
};
