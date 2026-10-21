import type { TStore } from "./store";

// Read-only questions over the store that more than one place asks.

// Loading a map creates one empty province, so the province count alone is not
// evidence of work. An undo entry, or more provinces than that starter, is.
function hasWork(store: TStore): boolean {
  return store.map.canUndo.value || store.provinces.list.value.length > 1;
}

export { hasWork };
