import { ARMY_UNIT_TYPE_TO_SUPPLY } from "../../model/war/army-constants.js";
import { numberToFixed2 } from "../../utils.js";
import type { TArmy, TArmyUnit } from "../../model/war/army.js";

export const calculateArmySupply = (army: TArmy) => {
  let sum = 0;

  for (const unit of army.units) {
    const supply = ARMY_UNIT_TYPE_TO_SUPPLY[unit.type] * (unit.amount / 100);

    sum += supply;
  }

  return sum;
};

export const calculateArmySanitaryLosses = (desiredProvinceSupply: number, provinceSupply: number) => {
  const percent = Math.max(0, (desiredProvinceSupply - provinceSupply) / provinceSupply / 20);
  return numberToFixed2(percent);
};

export const calculateArmyUnitSanitaryLossesCost = (armyUnit: TArmyUnit, sanitaryLosses: number) => {
  const cost = (armyUnit.amount / 100) * armyUnit.baseCost * sanitaryLosses;
  return Math.trunc(cost);
};

export const calculateArmySanitaryLossesCost = (armyUnit: TArmy, sanitaryLosses: number) => {
  const amount = armyUnit.units.reduce((sum, unit) => sum + calculateArmyUnitSanitaryLossesCost(unit, sanitaryLosses), 0);

  return amount;
};
