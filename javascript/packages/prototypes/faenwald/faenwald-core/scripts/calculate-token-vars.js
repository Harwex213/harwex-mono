import fs from "node:fs/promises";
import {ARMY_UNIT_TEMPLATES, UNIT_RANK_TO_MODIFIER} from "./constants.js";

const applyModifiers = (token, modifiersMatrix) => {
    for (const modifiers of modifiersMatrix) {
        for (const modifier of modifiers) {
            if (modifier.kind === "percent") {
                const percent = modifier.value / 100;
                token[modifier.type] = token[modifier.type] + token[modifier.type] * percent;
            } else {
                token[modifier.type] = token[modifier.type] + modifier.value;
            }
        }
    }
};

const getToken = (unit) => {
    const unitType = unit.unit.toLowerCase();
    const unitTemplate = ARMY_UNIT_TEMPLATES[unitType];

    const rankModifiers = UNIT_RANK_TO_MODIFIER[unit.rank];

    const percentAmount = unit.amount / 100;

    const hp = unitTemplate.baseHp * percentAmount;
    const attack = unitTemplate.baseAttack * percentAmount;
    const morale = unitTemplate.baseMorale * percentAmount;

    const token = {
        unit: unit.unit,
        kind: unit.kind,
        hp,
        attack,
        morale,
    };

    applyModifiers(token, [rankModifiers, unit.modifiers]);

    token.hp = Math.round(token.hp);
    token.attack = Math.round(token.attack);
    token.morale = Math.round(token.morale);

    return token;
};

const tokenToString = (token) => {
    return `${token.unit} - ${token.kind} - HP: ${token.hp} - DMG: ${token.attack} - MRL: ${token.morale}`;
};

const print = ({ attack, attackTokens, defend, defendTokens }) => {
    let printed = "";

    printed += `${attack}\n`;
    printed += attackTokens.map(tokenToString).join("\n") + "\n\n";
    printed += `${defend}\n`;
    printed += defendTokens.map(tokenToString).join("\n");

    console.log(printed);
};

const main = async () => {
    const data = (await fs.readFile("./calculate-token-vars.json", "utf-8")).toString();

    const {
        attack,
        attackUnits,
        defend,
        defendUnits,
    } = JSON.parse(data);

    const attackTokens = attackUnits.map(getToken);
    const defendTokens = defendUnits.map(getToken);

    print({ attack, attackTokens, defend, defendTokens });
};

void main();
