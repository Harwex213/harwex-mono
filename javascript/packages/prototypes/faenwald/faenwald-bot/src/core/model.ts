import { TArmy, TArmyUnit, TArmyUnitKind, TArmyUnitType } from "./types.js";

export const isValidArmyUnitKind = (examined: string): examined is TArmyUnitKind => {
    return examined === "во" ||
        examined === "ло" ||
        examined === "р" ||
        examined === "н" ||
        examined === "г" ||
        examined === "го" ||
        examined === "гн";
};

export const isValidArmyUnitType = (examined: string): examined is TArmyUnitType => {
    return examined === "во" ||
        examined === "лко" ||
        examined === "ско" ||
        examined === "тко" ||
        examined === "топ" ||
        examined === "меч" ||
        examined === "клев" ||
        examined === "лкав" ||
        examined === "скав" ||
        examined === "ткав" ||
        examined === "луч" ||
        examined === "лук" ||
        examined === "клу" ||
        examined === "лон" ||
        examined === "лонг" ||
        examined === "арб" ||
        examined === "мед" ||
        examined === "инж";
};

export const ARMY_UNIT_TYPE_TO_SUPPLY: Record<string, number> = {
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


export const ARMY_UNIT_KIND_TRANSLATE: Record<TArmyUnitKind, string> = {
    "во": "Вассалы",
    "ло": "Ленники",
    "р": "Регуляры",
    "н": "Наёмники",
    "г": "Гвардия",
    "го": "Гарнизон",
    "гн": "Гарнизон",
};

export const ARMY_UNIT_KIND_TRANSLATE_SHORT: Record<TArmyUnitKind, string> = {
    "во": "ВО",
    "ло": "ЛО",
    "р": "Р",
    "н": "Н",
    "г": "Г",
    "го": "ГО",
    "гн": "ГО",
};


export const ARMY_UNIT_TYPE_TRANSLATE: Record<TArmyUnitType, string> = {
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
    "лук": "Лучник",
    "клу": "Конный лучник",
    "лон": "Длинный лук",
    "лонг": "Длинный лук",
    "арб": "Арбалетчик",
    "мед": "Медики",
    "инж": "Инженеры",
};

export const ARMY_UNIT_TYPE_TRANSLATE_SHORT: Record<TArmyUnitType, string> = {
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
    "лук": "Луч",
    "клу": "КЛу",
    "лон": "Лон",
    "лонг": "Лонг",
    "арб": "Арб",
    "мед": "Мед",
    "инж": "Инж",
};

type TArmyUnitTemplate = {
    type: TArmyUnitType,
    baseHp: number,
    baseAttack: number,
    baseMorale: number,
    baseSpeed: number,
    baseCost: number,
};

export const ARMY_UNIT_TEMPLATES: Record<TArmyUnitType, TArmyUnitTemplate> = {
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

export type TUnitRankTranslated = "I" | "II" | "III" | "IV" | "V" | "VI";

export const isValidUnitRank = (examined: string): examined is TUnitRankTranslated => {
    return examined === "I" ||
        examined === "II" ||
        examined === "III" ||
        examined === "IV" ||
        examined === "V" ||
        examined === "VI";
}

export const UNIT_TRANSLATE_TO_RANK: Record<TUnitRankTranslated, number> = {
    "I": 1,
    "II": 2,
    "III": 3,
    "IV": 4,
    "V": 5,
    "VI": 6,
};

export const UNIT_RANK_TO_TRANSLATE: Record<number, TUnitRankTranslated> = {
    1: "I",
    2: "II",
    3: "III",
    4: "IV",
    5: "V",
    6: "VI",
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

// 10000 -> 10.000
export const beautifyNumber = (value: number) => value.toLocaleString("de-DE");

export const beautifyPercent = (value: number) => `${Math.round(value * 100)}%`;

export const numberToFixed2 = (value: number) => Number(value.toFixed(2));

export const calculateArmySanitaryLosses = (desiredProvinceSupply: number, provinceSupply: number) => {
    const percent = Math.max(0, (desiredProvinceSupply - provinceSupply) / provinceSupply / 20);
    return numberToFixed2(percent);
};

export const calculateArmyUnitSanitaryLossesCost = (armyUnit: TArmyUnit, sanitaryLosses: number) => {
    const armyCost = ARMY_UNIT_TEMPLATES[armyUnit.type].baseCost;
    const cost = (armyUnit.amount / 100) * armyCost * sanitaryLosses;
    return Math.trunc(cost);
};

export const calculateArmySanitaryLossesCost = (army: TArmy, sanitaryLosses: number) => {
    let amount = 0;

    for (const unitsId in army.units) {
        const unit = army.units[unitsId];
        amount += calculateArmyUnitSanitaryLossesCost(unit, sanitaryLosses);
    }

    return amount;
};

export const calculateUnitAmountAfterBattle = (
    maxHp: number,
    afterBattleHp: number,
    unitAmount = 100
) => Math.trunc(unitAmount - (unitAmount * ((1 - (afterBattleHp / maxHp)) / 2)));
