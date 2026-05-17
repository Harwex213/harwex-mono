import { TArmyUnitKind, TArmyUnitType } from "./types.js";
import { isValidArmyUnitKind, isValidArmyUnitType, isValidUnitRank, UNIT_TRANSLATE_TO_RANK } from "./model.js";

type TParsedUnit = {
    kind: TArmyUnitKind;
    type: TArmyUnitType;
    rank: number;
    amount: number;
    maxAmount: number;
};

const parseUnit = (unit: string): TParsedUnit => {
    // СКо (ВО) II (80/120)
    const m = unit.match(/^(\S+)\s+\(([^)]+)\)\s+(\S+)\s+\((\d+)\/(\d+)\)/);

    if (!m) {
        throw new Error(`Не получилось спарсить юнит: "${unit}"`);
    }

    const type = m[1].toLowerCase();
    if (!isValidArmyUnitType(type)) {
        throw new Error(`Неизвестный тип (${type}) юнита: "${unit}"`);
    }

    const kind = m[2].toLowerCase();
    if (!isValidArmyUnitKind(kind)) {
        throw new Error(`Неизвестный вид (${kind}) юнита: "${unit}"`);
    }

    const rankRaw = m[3];
    const isValidRank = isValidUnitRank(rankRaw);
    if (!isValidRank) {
        throw new Error(`Неизвестный ранг (${rankRaw}) юнита: "${unit}"`);
    }

    const rank = UNIT_TRANSLATE_TO_RANK[rankRaw];

    const amount = parseInt(m[4]);
    if (!Number.isFinite(amount)) {
        throw new Error(`Не удалось спарсить число (${m[4]}) юнита: "${unit}"`);
    }

    const maxAmount = parseInt(m[5]);
    if (!Number.isFinite(maxAmount)) {
        throw new Error(`Не удалось спарсить число (${m[4]}) юнита: "${unit}"`);
    }

    return {
        type,
        kind,
        rank,
        amount,
        maxAmount,
    };
};

export type { TParsedUnit };
export { parseUnit };
