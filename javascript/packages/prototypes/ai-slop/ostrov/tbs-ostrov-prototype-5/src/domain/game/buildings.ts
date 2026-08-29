import type { TBuildingKind, TResourceKind, TResources } from "./types";
import type { TTerrainKind } from "../world/types";

/**
 * The whole build menu. Every building is tied to one terrain, so the three
 * land types each get their own economy: meadows feed and house the colony,
 * forest supplies wood, mountains supply stone.
 */
type TBuildingDef = {
  kind: TBuildingKind;
  label: string;
  glyph: string;
  terrain: TTerrainKind;
  cost: Partial<TResources>;
  buildTurns: number;
  /** Colonists this building needs before it produces anything. */
  workers: number;
  yields: Partial<TResources>;
  housing: number;
  storage: number;
  description: string;
};

const BUILDING_DEFS: Record<TBuildingKind, TBuildingDef> = {
  farm: {
    kind: "farm",
    label: "Ферма",
    glyph: "🌾",
    terrain: "meadow",
    cost: { wood: 6 },
    buildTurns: 1,
    workers: 1,
    yields: { food: 3 },
    housing: 0,
    storage: 0,
    description: "Хлеб колонии. Быстро строится, кормит троих.",
  },
  house: {
    kind: "house",
    label: "Дом",
    glyph: "🏠",
    terrain: "meadow",
    cost: { wood: 8, stone: 2 },
    buildTurns: 2,
    workers: 0,
    yields: {},
    housing: 3,
    storage: 0,
    description: "Место для трёх колонистов. Без домов население не растёт.",
  },
  warehouse: {
    kind: "warehouse",
    label: "Склад",
    glyph: "📦",
    terrain: "meadow",
    cost: { wood: 12, stone: 4 },
    buildTurns: 2,
    workers: 0,
    yields: {},
    housing: 0,
    storage: 40,
    description: "Поднимает предел хранения каждого ресурса.",
  },
  sawmill: {
    kind: "sawmill",
    label: "Лесопилка",
    glyph: "🪚",
    terrain: "forest",
    cost: { wood: 5 },
    buildTurns: 1,
    workers: 1,
    yields: { wood: 3 },
    housing: 0,
    storage: 0,
    description: "Главный источник дерева.",
  },
  hut: {
    kind: "hut",
    label: "Хижина охотника",
    glyph: "🏹",
    terrain: "forest",
    cost: { wood: 8 },
    buildTurns: 2,
    workers: 1,
    yields: { food: 2, wood: 1 },
    housing: 0,
    storage: 0,
    description: "Немного еды и дерева с одного работника.",
  },
  quarry: {
    kind: "quarry",
    label: "Каменоломня",
    glyph: "⛏️",
    terrain: "mountains",
    cost: { wood: 10 },
    buildTurns: 2,
    workers: 1,
    yields: { stone: 2 },
    housing: 0,
    storage: 0,
    description: "Дешёвый вход в камень.",
  },
  mine: {
    kind: "mine",
    label: "Шахта",
    glyph: "⚒️",
    terrain: "mountains",
    cost: { wood: 16, stone: 6 },
    buildTurns: 3,
    workers: 2,
    yields: { stone: 4 },
    housing: 0,
    storage: 0,
    description: "Много камня, но требует двух работников.",
  },
};

const BUILDING_ORDER: readonly TBuildingKind[] = ["farm", "house", "warehouse", "sawmill", "hut", "quarry", "mine"];

const buildingsForTerrain = (terrain: TTerrainKind): TBuildingDef[] =>
  BUILDING_ORDER.map((kind) => BUILDING_DEFS[kind]).filter((definition) => definition.terrain === terrain);

/** Half the build cost, rounded down, is what tearing a building down gives back. */
const demolitionRefund = (kind: TBuildingKind): Partial<TResources> => {
  const cost = BUILDING_DEFS[kind].cost;
  const refund: Partial<TResources> = {};

  for (const [resource, amount] of Object.entries(cost) as [TResourceKind, number][]) {
    const half = Math.floor(amount / 2);
    if (half > 0) {
      refund[resource] = half;
    }
  }

  return refund;
};

const canAfford = (resources: TResources, cost: Partial<TResources>): boolean =>
  (Object.entries(cost) as [TResourceKind, number][]).every(([resource, amount]) => resources[resource] >= amount);

const describeCost = (cost: Partial<TResources>): [TResourceKind, number][] =>
  Object.entries(cost) as [TResourceKind, number][];

export type { TBuildingDef };
export { BUILDING_DEFS, BUILDING_ORDER, buildingsForTerrain, canAfford, demolitionRefund, describeCost };
