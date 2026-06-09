export const ARMY_UNIT_TYPE_TO_SUPPLY = {
    "лко": 1,
    "ско": 1,
    "тко": 1,
    "топ": 1,
    "меч": 1,
    "клев": 1,
    "лкав": 2,
    "скав": 2,
    "ткав": 3,
    "луч": 1,
    "клу": 2,
    "лон": 1,
    "лонг": 1,
    "арб": 1,
    "мед": 0,
    "инж": 0,
};

export const ARMY_UNIT_KIND_TRANSLATE = {
    "во": "Вассалы",
    "ло": "Ленники",
    "р": "Регуляры",
    "н": "Наёмники",
    "г": "Гвардия",
    "го": "Гарнизон",
};

export const ARMY_UNIT_KIND_TRANSLATE_SHORT = {
    "во": "ВО",
    "ло": "ЛО",
    "р": "Р",
    "н": "Н",
    "г": "Г",
    "го": "ГО",
};

export const ARMY_UNIT_TYPE_TRANSLATE = {
    "лко": "Легкий копейщик",
    "ско": "Средний копейщик",
    "тко": "Тяжелый копейщик",
    "топ": "Топорщик",
    "меч": "Мечник",
    "клев": "Клевеносец",
    "лкав": "Лёгкая кавалерия",
    "скав": "Средняя кавалерия",
    "ткав": "Тяжелая кавалерия",
    "луч": "Лучник",
    "клу": "Конный лучник",
    "лон": "Длинный лук",
    "лонг": "Длинный лук",
    "арб": "Арбалетчик",
    "мед": "Медики",
    "инж": "Инженеры",
};

export const ARMY_UNIT_TYPE_TRANSLATE_SHORT = {
    "лко": "ЛКо",
    "ско": "СКо",
    "тко": "ТКо",
    "топ": "Топ",
    "меч": "Меч",
    "клев": "Клев",
    "лкав": "ЛКав",
    "скав": "СКав",
    "ткав": "ТКав",
    "луч": "Луч",
    "клу": "КЛу",
    "лон": "Лон",
    "лонг": "Лонг",
    "арб": "Арб",
    "мед": "Мед",
    "инж": "Инж",
};

export const ARMY_UNIT_TEMPLATES = {
    "лко": {
        type: "лко",
        baseHp: 80,
        baseAttack: 12,
        baseMorale: 70,
        baseSpeed: 3,
        baseCost: 20_000,
    },
    "ско": {
        type: "ско",
        baseHp: 120,
        baseAttack: 15,
        baseMorale: 85,
        baseSpeed: 2,
        baseCost: 50_000,
    },
    "тко": {
        type: "тко",
        baseHp: 160,
        baseAttack: 18,
        baseMorale: 110,
        baseSpeed: 1,
        baseCost: 90_000,
    },
    "топ": {
        type: "топ",
        baseHp: 60,
        baseAttack: 20,
        baseMorale: 70,
        baseSpeed: 3,
        baseCost: 20_000,
    },
    "меч": {
        type: "меч",
        baseHp: 90,
        baseAttack: 25,
        baseMorale: 85,
        baseSpeed: 2,
        baseCost: 50_000,
    },
    "клев": {
        type: "клев",
        baseHp: 120,
        baseAttack: 30,
        baseMorale: 100,
        baseSpeed: 1,
        baseCost: 90_000,
    },
    "лкав": {
        type: "лкав",
        baseHp: 70,
        baseAttack: 10,
        baseMorale: 80,
        baseSpeed: 5,
        baseCost: 50_000,
    },
    "скав": {
        type: "скав",
        baseHp: 95,
        baseAttack: 15,
        baseMorale: 90,
        baseSpeed: 4,
        baseCost: 100_000,
    },
    "ткав": {
        type: "ткав",
        baseHp: 120,
        baseAttack: 25,
        baseMorale: 100,
        baseSpeed: 3,
        baseCost: 220_000,
    },
    "луч": {
        type: "луч",
        baseHp: 50,
        baseAttack: 6,
        baseMorale: 70,
        baseSpeed: 3,
        baseCost: 25_000,
    },
    "лук": {
        type: "лук",
        baseHp: 50,
        baseAttack: 6,
        baseMorale: 70,
        baseSpeed: 3,
        baseCost: 25_000,
    },
    "клу": {
        type: "клу",
        baseHp: 80,
        baseAttack: 6,
        baseMorale: 80,
        baseSpeed: 5,
        baseCost: 80_000,
    },
    "лон": {
        type: "лон",
        baseHp: 60,
        baseAttack: 10,
        baseMorale: 80,
        baseSpeed: 3,
        baseCost: 25_000,
    },
    "лонг": {
        type: "лонг",
        baseHp: 60,
        baseAttack: 10,
        baseMorale: 80,
        baseSpeed: 3,
        baseCost: 25_000,
    },
    "арб": {
        type: "арб",
        baseHp: 60,
        baseAttack: 40,
        baseMorale: 80,
        baseSpeed: 3,
        baseCost: 75_000,
    },
    "мед": {
        type: "мед",
        baseHp: 0,
        baseAttack: 0,
        baseMorale: 0,
        baseSpeed: 0,
        baseCost: 30_000,
    },
    "инж": {
        type: "инж",
        baseHp: 0,
        baseAttack: 0,
        baseMorale: 0,
        baseSpeed: 0,
        baseCost: 40_000,
    },
};

export const UNIT_RANK_TO_MODIFIER = {
    1: [
        {
            type: "hp",
            kind: "percent",
            value: -25
        },
        {
            type: "attack",
            kind: "percent",
            value: -25
        },
        {
            type: "morale",
            kind: "percent",
            value: -25
        }
    ],
    2: [],
    3: [
        {
            type: "hp",
            kind: "percent",
            value: 25
        },
        {
            type: "attack",
            kind: "percent",
            value: 25
        },
        {
            type: "morale",
            kind: "percent",
            value: 25
        }
    ],
    4: [
        {
            type: "hp",
            kind: "percent",
            value: 50
        },
        {
            type: "attack",
            kind: "percent",
            value: 50
        },
        {
            type: "morale",
            kind: "percent",
            value: 50
        }
    ],
    5: [
        {
            type: "hp",
            kind: "percent",
            value: 75
        },
        {
            type: "attack",
            kind: "percent",
            value: 75
        },
        {
            type: "morale",
            kind: "percent",
            value: 75
        }
    ],
    6: [
        {
            type: "hp",
            kind: "percent",
            value: 100
        },
        {
            type: "attack",
            kind: "percent",
            value: 100
        },
        {
            type: "morale",
            kind: "percent",
            value: 100
        }
    ],
};
