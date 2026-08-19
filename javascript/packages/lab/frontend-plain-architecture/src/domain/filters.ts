import type { CategoryFilter, ProviderId, SortKey } from "../model/types";
import type { Store } from "../store/types";

// Layer 4: domain. Every function here has the same shape:
//
//   (store, input) => void
//
// It reads the store, decides, and writes signals back. No React, no fetch, no
// closures over component state. A test can call it directly, and the UI can
// only reach it through the registry.

function setQuery(store: Store, query: string): void {
  store.query.value = query;
}

function setCategory(store: Store, category: CategoryFilter): void {
  store.category.value = category;
}

function toggleProvider(store: Store, providerId: ProviderId): void {
  const selected = store.selectedProviderIds.value;
  if (selected.includes(providerId)) {
    store.selectedProviderIds.value = selected.filter((id) => id !== providerId);
    return;
  }
  store.selectedProviderIds.value = [...selected, providerId];
}

function setSort(store: Store, sort: SortKey): void {
  store.sort.value = sort;
}

function toggleOnlyAvailable(store: Store): void {
  store.onlyAvailable.value = !store.onlyAvailable.value;
}

function toggleOnlyFavourites(store: Store): void {
  store.onlyFavourites.value = !store.onlyFavourites.value;
}

function resetFilters(store: Store): void {
  store.query.value = "";
  store.category.value = "all";
  store.selectedProviderIds.value = [];
  store.sort.value = "popularity";
  store.onlyAvailable.value = false;
  store.onlyFavourites.value = false;
}

export {
  resetFilters,
  setCategory,
  setQuery,
  setSort,
  toggleOnlyAvailable,
  toggleOnlyFavourites,
  toggleProvider,
};
