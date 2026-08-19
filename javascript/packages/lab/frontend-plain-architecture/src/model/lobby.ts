import type { CategoryFilter, GameCategory, LiveTable, LobbyFilters, SortKey, TableId, TableStatus } from "./types";

// Pure functions over the entities: no signals, no store, no React. The store
// calls them from its computed signals, the UI calls them for labels.

const CATEGORY_LABELS: Record<GameCategory, string> = {
  "roulette": "Roulette",
  "blackjack": "Blackjack",
  "baccarat": "Baccarat",
  "game-show": "Game shows",
};

const CATEGORY_ORDER: readonly CategoryFilter[] = ["all", "roulette", "blackjack", "baccarat", "game-show"];

const STATUS_LABELS: Record<TableStatus, string> = {
  "open": "Open",
  "full": "Full",
  "offline": "Offline",
};

const SORT_LABELS: Record<SortKey, string> = {
  "popularity": "Most popular",
  "min-bet": "Lowest min bet",
  "name": "Name (A–Z)",
};

const MONEY_FORMAT = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const RED_NUMBERS: readonly number[] = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

function categoryLabel(category: CategoryFilter): string {
  if (category === "all") {
    return "All tables";
  }
  return CATEGORY_LABELS[category];
}

function formatMoney(amount: number): string {
  return MONEY_FORMAT.format(amount);
}

function seatsFree(table: LiveTable): number {
  return Math.max(0, table.seats - table.seatsTaken);
}

function isAvailable(table: LiveTable): boolean {
  if (table.status !== "open") {
    return false;
  }
  return seatsFree(table) > 0;
}

function effectiveStatus(table: LiveTable): TableStatus {
  if (table.status === "open" && seatsFree(table) === 0) {
    return "full";
  }
  return table.status;
}

function matchesQuery(table: LiveTable, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") {
    return true;
  }
  if (table.name.toLowerCase().includes(trimmed)) {
    return true;
  }
  return table.dealer.toLowerCase().includes(trimmed);
}

function matchesFilters(table: LiveTable, filters: LobbyFilters, favouriteIds: readonly TableId[]): boolean {
  if (!matchesQuery(table, filters.query)) {
    return false;
  }
  if (filters.category !== "all" && table.category !== filters.category) {
    return false;
  }
  if (filters.providerIds.length > 0 && !filters.providerIds.includes(table.providerId)) {
    return false;
  }
  if (filters.onlyAvailable && !isAvailable(table)) {
    return false;
  }
  if (filters.onlyFavourites && !favouriteIds.includes(table.id)) {
    return false;
  }
  return true;
}

function compareTables(sort: SortKey): (left: LiveTable, right: LiveTable) => number {
  if (sort === "min-bet") {
    return (left, right) => left.minBet - right.minBet || left.name.localeCompare(right.name, "en");
  }
  if (sort === "name") {
    return (left, right) => left.name.localeCompare(right.name, "en");
  }
  return (left, right) => right.popularity - left.popularity || left.name.localeCompare(right.name, "en");
}

function averageMinBet(tables: readonly LiveTable[]): number {
  if (tables.length === 0) {
    return 0;
  }
  const total = tables.reduce((sum, table) => sum + table.minBet, 0);
  return Math.round(total / tables.length);
}

function rouletteColour(result: number): "red" | "black" | "green" {
  if (result === 0) {
    return "green";
  }
  if (RED_NUMBERS.includes(result)) {
    return "red";
  }
  return "black";
}

export {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  SORT_LABELS,
  STATUS_LABELS,
  averageMinBet,
  categoryLabel,
  compareTables,
  effectiveStatus,
  formatMoney,
  isAvailable,
  matchesFilters,
  matchesQuery,
  rouletteColour,
  seatsFree,
};
