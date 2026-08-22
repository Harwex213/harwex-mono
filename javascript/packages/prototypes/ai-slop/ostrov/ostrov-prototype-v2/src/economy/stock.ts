/**
 * The four resources, and where the opening pile of them comes from.
 *
 * Nothing here reads the config: the caller hands in the costs it read, so the
 * same derivation can be checked Node-side against the values file.
 */

type ResourceKind = "wood" | "stone" | "gold" | "food";

/** Declaration order of the panel and of every loop over the four. */
const RESOURCE_KINDS: readonly ResourceKind[] = ["wood", "stone", "gold", "food"];

type Stock = Record<ResourceKind, number>;

/** What one building costs. Food buys units, never walls, so it is not here. */
type Cost = {
  wood: number;
  stone: number;
  gold: number;
};

const ZERO_COST: Cost = { wood: 0, stone: 0, gold: 0 };

type StartOptions = {
  /** Every building's price, in schema order. The order breaks ties. */
  costs: Readonly<Record<string, Cost>>;
  /** Building the opening pile has to cover whatever it costs. */
  castleId: string;
  /** How many of the cheapest other buildings the pile also has to cover. */
  others: number;
  /** Slack over that sum, so the first mistake is not fatal. */
  headroom: number;
  /** Floor under every resource, which is the whole of the food pile. */
  floor: number;
};

function emptyStock(): Stock {
  return { wood: 0, stone: 0, gold: 0, food: 0 };
}

function costOf(source: Partial<Cost>): Cost {
  return { wood: source.wood ?? 0, stone: source.stone ?? 0, gold: source.gold ?? 0 };
}

function totalOf(cost: Cost): number {
  return cost.wood + cost.stone + cost.gold;
}

/**
 * The opening pile: the castle plus the `others` cheapest other buildings, with
 * `headroom` on top and `floor` under every resource.
 *
 * Derived rather than typed out, so a designer who doubles the price of the
 * castle does not also have to remember to hand the player more wood. Ties in
 * the sort break on the schema order of the buildings, so the pile is one number
 * for one config and not one number per run.
 */
function startingStock(options: StartOptions): Stock {
  const ids = Object.keys(options.costs);
  const cheapest = ids
    .filter((id) => id !== options.castleId)
    .map((id, order) => ({ id, order, cost: options.costs[id]! }))
    .sort((left, right) => totalOf(left.cost) - totalOf(right.cost) || left.order - right.order)
    .slice(0, Math.max(0, options.others));
  const funded = [options.costs[options.castleId] ?? ZERO_COST, ...cheapest.map((entry) => entry.cost)];
  const stock = emptyStock();
  for (const kind of RESOURCE_KINDS) {
    if (kind === "food") {
      continue;
    }
    let sum = 0;
    for (const cost of funded) {
      sum += cost[kind];
    }
    stock[kind] = Math.max(options.floor, Math.ceil(sum * options.headroom));
  }
  stock.food = options.floor;
  return stock;
}

/** Whether the pile covers the price. */
function affordable(stock: Stock, cost: Cost): boolean {
  return stock.wood >= cost.wood && stock.stone >= cost.stone && stock.gold >= cost.gold;
}

/** The pile with the price taken out of it. Never called before `affordable`. */
function withoutCost(stock: Stock, cost: Cost): Stock {
  return {
    wood: stock.wood - cost.wood,
    stone: stock.stone - cost.stone,
    gold: stock.gold - cost.gold,
    food: stock.food,
  };
}

/** The first resource the pile is short of, or null when it covers the price. */
function missingOf(stock: Stock, cost: Cost): ResourceKind | null {
  for (const kind of RESOURCE_KINDS) {
    if (kind !== "food" && stock[kind] < cost[kind]) {
      return kind;
    }
  }
  return null;
}

/**
 * A price over any of the four resources. A building is priced in the three
 * materials and never in food, which is what `Cost` says; a unit eats, so it is
 * priced in food as well. Rather than widening `Cost` — and with it the opening
 * pile derivation that reads it — a unit hands its price in as this.
 */
type Price = Partial<Record<ResourceKind, number>>;

function canPay(stock: Stock, price: Price): boolean {
  return missingFor(stock, price) === null;
}

/** The first resource the pile is short of for this price, or null when it covers it. */
function missingFor(stock: Stock, price: Price): ResourceKind | null {
  for (const kind of RESOURCE_KINDS) {
    if (stock[kind] < (price[kind] ?? 0)) {
      return kind;
    }
  }
  return null;
}

/** The pile with the price taken out of it. Never called before `canPay`. */
function afterPay(stock: Stock, price: Price): Stock {
  const next = { ...stock };
  for (const kind of RESOURCE_KINDS) {
    next[kind] = stock[kind] - (price[kind] ?? 0);
  }
  return next;
}

export type { Cost, Price, ResourceKind, StartOptions, Stock };
export {
  RESOURCE_KINDS,
  ZERO_COST,
  afterPay,
  affordable,
  canPay,
  costOf,
  emptyStock,
  missingFor,
  missingOf,
  startingStock,
  totalOf,
  withoutCost,
};
