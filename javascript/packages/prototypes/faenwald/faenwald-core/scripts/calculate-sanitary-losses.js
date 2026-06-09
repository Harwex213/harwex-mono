import fs from "node:fs/promises";

const MODE = "FULL"; // "FULL"; "SHORT";

const ARMY_UNIT_TYPE_TO_SUPPLY = {
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
    "лук": 1,
    "клу": 2,
    "лон": 1,
    "лонг": 1,
    "арб": 1,
    "мед": 0,
    "инж": 0,
};

const ARMY_UNIT_KIND_TRANSLATE = {
    "во": "Вассалы",
    "ло": "Ленники",
    "р": "Регуляры",
    "н": "Наёмники",
    "г": "Гвардия",
    "го": "Гарнизон",
};

const ARMY_UNIT_KIND_TRANSLATE_SHORT = {
    "во": "ВО",
    "ло": "ЛО",
    "р": "Р",
    "н": "Н",
    "г": "Г",
    "го": "ГО",
};

const ARMY_UNIT_TYPE_TRANSLATE = {
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

const ARMY_UNIT_TYPE_TRANSLATE_SHORT = {
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

const ARMY_UNIT_TEMPLATES = {
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
        type: "луч",
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

export const beautifyPercent = (value) => `${Math.round(value * 100)}%`;

// 10000 -> 10.000
export const beautifyNumber = (value) => value.toLocaleString("de-DE");

export const numberToFixed2 = (value) => Number(value.toFixed(2));

export const calculateArmySupply = (army) => {
    let sum = 0;

    for (const unitId in army.units) {
        const unit = army.units[unitId];
        const supply = ARMY_UNIT_TYPE_TO_SUPPLY[unit.type] * (unit.amount / 100);

        sum += supply;
    }

    return numberToFixed2(sum);
};

export const calculateArmySanitaryLosses = (desiredProvinceSupply, provinceSupply) => {
    const percent = Math.max(0, (desiredProvinceSupply - provinceSupply) / provinceSupply / 20);
    return numberToFixed2(percent);
};

export const calculateArmyUnitSanitaryLossesCost = (armyUnit, sanitaryLosses) => {
    const armyCost = ARMY_UNIT_TEMPLATES[armyUnit.type].baseCost;
    const cost = (armyUnit.amount / 100) * armyCost * sanitaryLosses;
    return Math.trunc(cost);
};

export const calculateArmySanitaryLossesCost = (army, sanitaryLosses) => {
    let amount = 0;

    for (const unitsId in army.units) {
        const unit = army.units[unitsId];
        amount += calculateArmyUnitSanitaryLossesCost(unit, sanitaryLosses);
    }

    return amount;
};

export const calculateUnitAmountAfterBattle = (
    maxHp,
    afterBattleHp,
    unitAmount = 100
) => Math.trunc(unitAmount - (unitAmount * ((1 - (afterBattleHp / maxHp)) / 2)));

const getProvinces = (provincesRaw) => {
    const provinces = {};

    for (const province of provincesRaw.match(/- Провинция "([^"]+)"\r?\nСнабжение ([\d.]*)/gm)) {
        const match = province.match(/- Провинция "([^"]+)"\r?\nСнабжение ([\d.]*)/m);
        const provinceName = match[1];
        const provinceSupply = Number(match[2]);
        provinces[provinceName] = provinceSupply;
    }

    return provinces;
};

const getArmies = (armiesRaw) => {
    const armies = {};

    for (const armyRaw of armiesRaw.match(/- Армия [^"]+"[^"]+"/gm)) {
        const match = armyRaw.match(/- Армия ([^\n]+)\r?\n((?:\d+. \S* \(\S*\) \S* \(\d*\/\d*\)\r?\n)+)Провинция: "([^"]+)"/m);

        const armyName = match[1].trim();
        const unitsRaw = match[2].trim();
        const armyProvince = match[3].trim();

        const units = {};

        let unitId = 0;

        for (const unitRaw of unitsRaw.match(/(\d+. \S* \(\S*\) \S* \(\d*\/\d*\)\r?\n?)/gm)) {
            const unitMatch = unitRaw.trim().match(/\d+. (\S+) \((\S+)\) (\S+) \((\d+)\/\d*\)/);

            const unitType = unitMatch[1].trim().toLowerCase();
            const unitKind = unitMatch[2].trim().toLowerCase();
            const unitRank = unitMatch[3].trim();
            const unitAmount = Number(unitMatch[4]);
            const id = `${armyName}-${unitId++}`;

            units[id] = {
                id,
                type: unitType,
                kind: unitKind,
                rank: unitRank,
                amount: unitAmount,
            };
        }

        const army = {
            name: armyName,
            province: armyProvince,
            units,
        };

        armies[armyName] = army;
    }

    return armies;
};

const getBattles = (battlesRaw) => {
    if (battlesRaw === "") {
        return {};
    }

    const battles = {};

    for (const armyRaw of battlesRaw.match(/- Армия [^-]+/gm)) {
        const match = armyRaw.trim().match(/- Армия ([^\n]+)\n((?:\d+. \S* \(\S*\) \S* \(\d*\/\d*\)\r?\n?)+)/m);

        const armyName = match[1].trim();
        const unitsRaw = match[2].trim();

        const units = {};

        let unitId = 0;

        for (const unitRaw of unitsRaw.match(/(\d+. \S* \(\S*\) \S* \(\d*\/\d*\)\r?\n?)/gm)) {
            const unitMatch = unitRaw.trim().match(/\d+. (\S+) \((\S+)\) (\S+) \((\d+)\/(\d+)\)/);

            const unitType = unitMatch[1].trim().toLowerCase();
            const unitKind = unitMatch[2].trim().toLowerCase();
            const unitRank = unitMatch[3];
            const unitHpAfter = Number(unitMatch[4]);
            const unitHpBefore = Number(unitMatch[5]);
            const id = `${armyName}-${unitId++}`;

            units[id] = {
                id,
                type: unitType,
                kind: unitKind,
                rank: unitRank,
                hpAfter: unitHpAfter,
                hpBefore: unitHpBefore,
            };
        }

        const army = {
            name: armyName,
            units,
        };

        battles[armyName] = army;
    }

    return battles;
};

const printArmiesLossesAfterBattle = (armies, battles) => {
    let printed = "";

    for (const armyName in battles) {
        const armyBattle = battles[armyName];
        const army = armies[armyName];

        printed += `Армия ${army.name}\n`;
        let unitIndex = 1;
        let armyLost = 0;

        for (const unitId in army.units) {
            const battleUnit = armyBattle.units[unitId];
            const unit = army.units[unitId];
            const newAmount = calculateUnitAmountAfterBattle(battleUnit.hpBefore, battleUnit.hpAfter, unit.amount);

            const translateType = MODE === "SHORT" ? ARMY_UNIT_TYPE_TRANSLATE_SHORT : ARMY_UNIT_TYPE_TRANSLATE;
            const translateKind = MODE === "SHORT" ? ARMY_UNIT_KIND_TRANSLATE_SHORT : ARMY_UNIT_KIND_TRANSLATE;

            printed += `${unitIndex++}. ${translateType[unit.type]} (${translateKind[unit.kind]}) ${unit.rank} (${newAmount}/${unit.amount})\n`;

            armyLost += (unit.amount - newAmount);
        }

        printed += `Итого потерь: ${beautifyNumber(armyLost)} мужиков\n\n`;
    }

    console.log(printed);
};

const printArmiesSanitaryLosses = (armies, provinces, provinceToArmiesDesiredSupply) => {
    for (const armyId in armies) {
        const army = armies[armyId];

        let printed = "";
        printed += `Армия ${army.name}\n`;

        let unitIndex = 1;
        let menAmount = 0;

        for (const unitId in army.units) {
            const unit = army.units[unitId];

            const translateType = MODE === "SHORT" ? ARMY_UNIT_TYPE_TRANSLATE_SHORT : ARMY_UNIT_TYPE_TRANSLATE;
            const translateKind = MODE === "SHORT" ? ARMY_UNIT_KIND_TRANSLATE_SHORT : ARMY_UNIT_KIND_TRANSLATE;

            printed += `${unitIndex++}. ${translateType[unit.type]} (${translateKind[unit.kind]}) ${unit.rank} (${unit.amount}/100)\n`;

            menAmount += unit.amount;
        }

        const desiredProvinceSupply = provinceToArmiesDesiredSupply[army.province];
        const provinceSupply = provinces[army.province];
        const sanitaryLosses = calculateArmySanitaryLosses(desiredProvinceSupply, provinceSupply);

        printed += `Итого человек: ${menAmount}\n`;
        printed += `Требуемое снабжение с учётом всех армий в провинции: ${desiredProvinceSupply}\n`;
        printed += `Снабжение провинции: ${provinceSupply}\n`;
        printed += `Санитарные потери: ${beautifyPercent(sanitaryLosses)}`;
        if (sanitaryLosses > 0) {
            printed += `. Стоимость восполнения — ${beautifyNumber(calculateArmySanitaryLossesCost(army, sanitaryLosses))}\n`;
        } else {
            printed += "\n";
        }

        console.log(printed);
    }
};

const main = async () => {
    const data = (await fs.readFile("./input.txt", "utf-8")).toString();

    const match = data.match(/# Провинции\r?\n([\S\s]*)\n# Армии\r?\n([\S\s]*)# Последствия битв\r?\n?([\S\s]*)/m);

    const provincesRaw = match[1].trim();
    const armiesRaw = match[2].trim();
    const battlesRaw = match[3].trim();

    const provinces = getProvinces(provincesRaw);
    const armies = getArmies(armiesRaw);
    const battles = getBattles(battlesRaw);

    printArmiesLossesAfterBattle(armies, battles);

    const armyToSupply = {};
    const provinceToArmiesDesiredSupply = {};

    for (const armyId in armies) {
        const army = armies[armyId];

        armyToSupply[armyId] = calculateArmySupply(army);
        if (!provinceToArmiesDesiredSupply[army.province]) {
            provinceToArmiesDesiredSupply[army.province] = 0;
        }
        provinceToArmiesDesiredSupply[army.province] = numberToFixed2(provinceToArmiesDesiredSupply[army.province] + armyToSupply[armyId]);
    }

    printArmiesSanitaryLosses(armies, provinces, provinceToArmiesDesiredSupply);
};

void main();
