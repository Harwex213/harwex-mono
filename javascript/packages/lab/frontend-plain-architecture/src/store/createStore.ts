import { computed, signal } from "@preact/signals-react";
import { averageMinBet, compareTables, isAvailable, matchesFilters, seatsFree } from "../model/lobby";
import type { CategoryFilter, LiveTable, Notice, Provider, ProviderId, SortKey, TableId } from "../model/types";
import type { Store, StoreSeed } from "./types";

// One factory, one store instance. The app entry builds one; every screenshot
// test builds its own. Because no signal is created at module scope, two stores
// never share state.

function createStore(seed: StoreSeed): Store {
  const providers = signal<readonly Provider[]>(seed.providers);
  const tables = signal<readonly LiveTable[]>(seed.tables);

  const query = signal<string>("");
  const category = signal<CategoryFilter>("all");
  const selectedProviderIds = signal<readonly ProviderId[]>([]);
  const sort = signal<SortKey>("popularity");
  const onlyAvailable = signal<boolean>(false);
  const onlyFavourites = signal<boolean>(false);

  const balance = signal<number>(seed.balance);
  const favouriteIds = signal<readonly TableId[]>([]);
  const selectedTableId = signal<TableId | null>(null);
  const joinedTableId = signal<TableId | null>(null);
  const recentlyPlayedIds = signal<readonly TableId[]>([]);
  const notice = signal<Notice | null>(null);

  const filters = computed(() => ({
    query: query.value,
    category: category.value,
    providerIds: selectedProviderIds.value,
    onlyAvailable: onlyAvailable.value,
    onlyFavourites: onlyFavourites.value,
    sort: sort.value,
  }));

  const visibleTables = computed(() => {
    const matching = tables.value.filter((table) => matchesFilters(table, filters.value, favouriteIds.value));
    return [...matching].sort(compareTables(filters.value.sort));
  });

  const byId = computed(() => new Map(tables.value.map((table) => [table.id, table])));

  const selectedTable = computed(() => {
    const id = selectedTableId.value;
    if (id === null) {
      return null;
    }
    return byId.value.get(id) ?? null;
  });

  const joinedTable = computed(() => {
    const id = joinedTableId.value;
    if (id === null) {
      return null;
    }
    return byId.value.get(id) ?? null;
  });

  const recentlyPlayed = computed(() => {
    const found: LiveTable[] = [];
    for (const id of recentlyPlayedIds.value) {
      const table = byId.value.get(id);
      if (table) {
        found.push(table);
      }
    }
    return found;
  });

  const stats = computed(() => {
    const all = tables.value;
    const available = all.filter(isAvailable);
    return {
      total: all.length,
      available: available.length,
      seatsFree: all.reduce((sum, table) => sum + (table.status === "offline" ? 0 : seatsFree(table)), 0),
      averageMinBet: averageMinBet(all),
    };
  });

  const providerFacets = computed(() => {
    return providers.value.map((provider) => {
      const owned = tables.value.filter((table) => table.providerId === provider.id);
      return {
        provider,
        total: owned.length,
        available: owned.filter(isAvailable).length,
      };
    });
  });

  const providerById = computed(() => new Map(providers.value.map((provider) => [provider.id, provider])));

  // Counts for the category tabs. They ignore the category filter itself and
  // honour every other filter, so switching tabs never shows a count that turns
  // out to be zero.
  const categoryCounts = computed(() => {
    const counts = new Map<CategoryFilter, number>();
    const withoutCategory = { ...filters.value, category: "all" as const };
    const matching = tables.value.filter((table) => matchesFilters(table, withoutCategory, favouriteIds.value));
    counts.set("all", matching.length);
    for (const table of matching) {
      counts.set(table.category, (counts.get(table.category) ?? 0) + 1);
    }
    return counts;
  });

  const hasActiveFilters = computed(() => {
    const active = filters.value;
    if (active.query.trim() !== "") {
      return true;
    }
    if (active.category !== "all") {
      return true;
    }
    if (active.providerIds.length > 0) {
      return true;
    }
    return active.onlyAvailable || active.onlyFavourites;
  });

  return {
    providers,
    tables,
    query,
    category,
    selectedProviderIds,
    sort,
    onlyAvailable,
    onlyFavourites,
    balance,
    favouriteIds,
    selectedTableId,
    joinedTableId,
    recentlyPlayedIds,
    notice,
    filters,
    visibleTables,
    selectedTable,
    joinedTable,
    recentlyPlayed,
    stats,
    providerFacets,
    providerById,
    categoryCounts,
    hasActiveFilters,
  };
}

export { createStore };
