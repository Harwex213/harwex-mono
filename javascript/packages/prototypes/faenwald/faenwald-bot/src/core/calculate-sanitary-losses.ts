import { Parser } from "./parser.js";
import { TArmy, TArmyUnit } from "./types.js";
import { parseUnit } from "./parse-unit.js";
import {
    ARMY_UNIT_KIND_TRANSLATE_SHORT,
    ARMY_UNIT_TEMPLATES,
    ARMY_UNIT_TYPE_TRANSLATE_SHORT,
    beautifyNumber,
    calculateUnitAmountAfterBattle,
    UNIT_RANK_TO_TRANSLATE
} from "./model.js";

const parseArmies = (parser: Parser) => {
    const armies: Record<string, TArmy> = {};

    while (true) {
        parser.skipWhitespace();

        const armyMatch = parser.eat(/^- Армия (\S+)/);
        if (!armyMatch) {
            break;
        }

        const army: TArmy = { name: armyMatch[1], units: [] };

        while (true) {
            parser.skipWhitespace();

            const unitMatch = parser.eat(/^\d+\.\s+(.+)/);
            if (!unitMatch) {
                break;
            }

            const parsedUnit = parseUnit(unitMatch[1]);

            const unitTemplate = ARMY_UNIT_TEMPLATES[parsedUnit.type];

            const unit: TArmyUnit = {
                kind: parsedUnit.kind,
                type: parsedUnit.type,
                rank: parsedUnit.rank,
                amount: parsedUnit.amount,
                maxAmount: parsedUnit.maxAmount,
                modifiers: [],
                hp: unitTemplate.baseHp,
                attack: unitTemplate.baseAttack,
                morale: unitTemplate.baseMorale,
            }

            army.units.push(unit);
        }

        armies[army.name] = army;
    }

    return armies;
};

const print = (armies: Record<string, TArmy>, afterBattle: Record<string, TArmy>) => {
    let printed = "";

    for (const armyName in afterBattle) {
        const armyBattle = afterBattle[armyName];
        const army = armies[armyName];

        printed += `Армия ${army.name}\n`;
        let unitIndex = 1;
        let armyLost = 0;

        for (const unitId in army.units) {
            const battleUnit = armyBattle.units[unitId];
            const unit = army.units[unitId];
            const newAmount = calculateUnitAmountAfterBattle(battleUnit.maxAmount, battleUnit.amount, unit.amount);

            const translateType = ARMY_UNIT_TYPE_TRANSLATE_SHORT;
            const translateKind = ARMY_UNIT_KIND_TRANSLATE_SHORT;

            printed += `${unitIndex++}. ${translateType[unit.type]} (${translateKind[unit.kind]}) ${UNIT_RANK_TO_TRANSLATE[unit.rank]} (${newAmount}/${unit.amount})\n`;

            armyLost += (unit.amount - newAmount);
        }

        printed += `Итого потерь: ${beautifyNumber(armyLost)} мужиков\n\n`;
    }

    return printed;
}

const calculateSanitaryLosses = (input: string): string => {
    const parser = new Parser(input);

    parser.skipWhitespace();
    parser.expect(/^# Армии/, `"# Армии"`);

    const armies = parseArmies(parser);

    parser.skipWhitespace();
    parser.expect(/^# Последствия битв/, `"# Последствия битв"`);

    const battles = parseArmies(parser);

    return print(armies, battles);
};

export { calculateSanitaryLosses };
