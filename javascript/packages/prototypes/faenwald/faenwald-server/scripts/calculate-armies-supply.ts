import {
  ARMY_RANK_TO_TRANSLATE,
  ARMY_UNIT_TYPE_TRANSLATE,
  beautifyNumber,
  beautifyPercent,
  calculateArmySanitaryLosses,
  calculateArmySanitaryLossesCost,
  calculateArmySupply,
  type TGameTurn,
  TWarPhase
} from "@hw/faenwald-core";
import { loadWarPhaseHandler } from "@/handlers/war-phases.js";
import { loadGameTurnHandler } from "@/handlers/game-turn.js";

const CURRENT_TURN = 4;
const WAR_PHASE = 2;

type TPrintArmiesSupplyInput = {
  armyToSupply: Record<string, number>;
  provinceToArmiesDesiredSupply: Record<string, number>;
  warPhase: TWarPhase;
  gameTurn: TGameTurn;
  affectedHouses: Set<string>;
}

const printArmiesSupply = ({
  provinceToArmiesDesiredSupply,
  warPhase,
  gameTurn,
  affectedHouses,
}: TPrintArmiesSupplyInput) => {
  for (const armyId in warPhase.armies) {
    const army = warPhase.armies[armyId];
    if (!army) {
      continue;
    }

    let printed = "";
    printed += `${army.name}\n`;

    let menAmount = 0;

    for (const unit of army.units) {
      const houseName = gameTurn.houses[unit.houseId]!.name;
      printed += `- ${unit.amount} - ${ARMY_UNIT_TYPE_TRANSLATE[unit.type]} - ${ARMY_RANK_TO_TRANSLATE[unit.rank]} ранг - ${houseName}\n`;

      menAmount += unit.amount;
    }

    const desiredProvinceSupply = provinceToArmiesDesiredSupply[army.provinceId]!;
    const provinceSupply = gameTurn.provinces[army.provinceId]!.supply;
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

  let printed = "";
  printed += `Я уже спрашивал у некоторых, но попрошу ещё раз. `;
  printed += `Напишите мне пожалуйста по потерям в ЛС (я тегну всех участвующих на юге в войне в 2 фазу):\n`;

  for (const affectedHouse of affectedHouses) {
    const house = gameTurn.houses[affectedHouse]!;
    printed += `@id${house.playerVkId} (${house.name})\n`
  }

  console.log(printed);
};

const main = async () => {
  const gameTurn = await loadGameTurnHandler({ turn: CURRENT_TURN });
  const warPhase = await loadWarPhaseHandler({ turn: CURRENT_TURN, phase: WAR_PHASE });

  const affectedHouses = new Set<string>();
  const armyToSupply: Record<string, number> = {};
  const provinceToArmiesDesiredSupply: Record<string, number> = {};

  for (const armyId in warPhase.armies) {
    const army = warPhase.armies[armyId];
    if (!army) {
      continue;
    }

    armyToSupply[armyId] = calculateArmySupply(army);
    if (!provinceToArmiesDesiredSupply[army.provinceId]) {
      provinceToArmiesDesiredSupply[army.provinceId] = 0;
    }
    provinceToArmiesDesiredSupply[army.provinceId]! += armyToSupply[armyId];

    for (const unit of army.units) {
      affectedHouses.add(unit.houseId);
    }
  }

  printArmiesSupply({ armyToSupply, provinceToArmiesDesiredSupply, warPhase, gameTurn, affectedHouses });
};

void main();
