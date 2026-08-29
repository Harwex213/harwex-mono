import { TERRAIN_LIST } from "../island/terrain";
import type { TTerrain } from "../island/terrain";

type TResource = "food" | "wood" | "stone" | "gold";

type TResources = Record<TResource, number>;

const RESOURCE_LIST: readonly TResource[] = ["food", "wood", "stone", "gold"];

const RESOURCE_LABELS: Record<TResource, string> = {
  food: "Еда",
  wood: "Дерево",
  stone: "Камень",
  gold: "Золото",
};

const RESOURCE_ICONS: Record<TResource, string> = {
  food: "🌾",
  wood: "🪵",
  stone: "🪨",
  gold: "🪙",
};

/** What one tile of each ground brings in every turn. */
const TERRAIN_YIELD: Record<TTerrain, Partial<TResources>> = {
  plains: { food: 2 },
  meadow: { food: 1, gold: 1 },
  forest: { wood: 2 },
  hills: { stone: 1, gold: 1 },
  mountain: { stone: 2 },
};

/** Trade over a sky bridge: every linked neighbour pays this much gold a turn. */
const LINK_TRADE_GOLD = 2;

const emptyResources = (): TResources => ({ food: 0, wood: 0, stone: 0, gold: 0 });

const addResources = (a: TResources, b: TResources): TResources => ({
  food: a.food + b.food,
  wood: a.wood + b.wood,
  stone: a.stone + b.stone,
  gold: a.gold + b.gold,
});

/** Income for a turn, from the tile counts and the number of linked islands. */
const incomeOf = (counts: Record<TTerrain, number>, linkCount: number): TResources => {
  const income = emptyResources();

  for (const terrain of TERRAIN_LIST) {
    const perTile = TERRAIN_YIELD[terrain];

    for (const resource of RESOURCE_LIST) {
      income[resource] += (perTile[resource] ?? 0) * counts[terrain];
    }
  }

  income.gold += linkCount * LINK_TRADE_GOLD;

  return income;
};

export type { TResource, TResources };
export { LINK_TRADE_GOLD, RESOURCE_ICONS, RESOURCE_LABELS, RESOURCE_LIST, TERRAIN_YIELD, addResources, emptyResources, incomeOf };
