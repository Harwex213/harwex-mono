import { watchContentSearch } from "./content-search-state";
import type { TStore } from "../store/store";
import type { TApiClient } from "../api/api";

const isSearchActive = (store: TStore) => {
  return store.search.term.peek().length > 0;
};

// Clearing brings back the tree as it was before the search. The expanded folders were
// never changed, and the selection returns unless that row has been deleted meanwhile.
const clearSearch = (store: TStore) => {
  if (!isSearchActive(store)) {
    return;
  }

  const preSearchSelectedId = store.search.preSearchSelectedId.peek();
  const isStillThere = store.fs.nodes.peek().some((node) => node.id === preSearchSelectedId);

  store.search.term.value = "";
  store.search.expandedIds.value = [];
  store.search.collapsedIds.value = [];
  store.search.preSearchSelectedId.value = null;
  store.fs.selectedId.value = isStillThere ? preSearchSelectedId : null;
};

// A folder in the filtered tree toggles in the search lists, not in fs.expandedIds.
// Collapsing a folder collapses everything below it, as in the full tree (TREE-4).
const toggleSearchFolder = (
  store: TStore,
  nodeId: string,
  subtreeIds: ReadonlySet<string>
) => {
  const expandedIds = store.search.expandedIds.peek();
  const collapsedIds = store.search.collapsedIds.peek();

  if (!store.derived.treeExpandedIds.peek().includes(nodeId)) {
    store.search.collapsedIds.value = collapsedIds.filter((id) => id !== nodeId);
    store.search.expandedIds.value = [...expandedIds, nodeId];

    return;
  }

  store.search.expandedIds.value = expandedIds.filter((id) => !subtreeIds.has(id));
  store.search.collapsedIds.value = [
    ...collapsedIds.filter((id) => !subtreeIds.has(id)),
    ...subtreeIds,
  ];
};

// Results follow the field as the reader types (SRCH-11). Name matches are derived from
// the tree in store.derived; content matches come from the watcher started here.
const changeSearchAction = (store: TStore, api: TApiClient, term: string) => {
  watchContentSearch(store, api);

  if (term.length === 0) {
    clearSearch(store);

    return;
  }

  if (!isSearchActive(store)) {
    store.search.preSearchSelectedId.value = store.fs.selectedId.peek();
  }

  store.search.term.value = term;
  store.search.expandedIds.value = [];
  store.search.collapsedIds.value = [];
};

const clearSearchAction = (store: TStore, _api: TApiClient) => {
  clearSearch(store);
};

export { changeSearchAction, clearSearch, clearSearchAction, isSearchActive, toggleSearchFolder };
