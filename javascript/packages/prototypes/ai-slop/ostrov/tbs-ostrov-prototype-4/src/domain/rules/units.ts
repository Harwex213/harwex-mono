import type { TArmyKind } from "../world/types";

/**
 * Three silhouettes, three jobs: something that runs, something that holds a
 * line, something that breaks one. Costs are in gold; the city pays up front.
 */

type TUnitBlueprint = {
  kind: TArmyKind;
  name: string;
  cost: number;
  upkeep: number;
  hp: number;
  attack: number;
  movement: number;
  sight: number;
  hint: string;
};

const UNIT_ORDER: readonly TArmyKind[] = ["scout", "spearman", "knight"];

const UNITS: Record<TArmyKind, TUnitBlueprint> = {
  scout: {
    kind: "scout",
    name: "Разведчик",
    cost: 20,
    upkeep: 1,
    hp: 8,
    attack: 3,
    movement: 4,
    sight: 3,
    hint: "Быстрый и зоркий. В бою почти бесполезен.",
  },
  spearman: {
    kind: "spearman",
    name: "Копейщики",
    cost: 35,
    upkeep: 2,
    hp: 18,
    attack: 6,
    movement: 2,
    sight: 2,
    hint: "Держит холм или лес. Медленный.",
  },
  knight: {
    kind: "knight",
    name: "Рыцари",
    cost: 60,
    upkeep: 3,
    hp: 24,
    attack: 10,
    movement: 3,
    sight: 2,
    hint: "Дорогой таран. Ломает лагерь и всё, что рядом.",
  },
};

export type { TUnitBlueprint };
export { UNITS, UNIT_ORDER };
