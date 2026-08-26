import { ensureDocument } from "./documents-state";
import { toggleFolderAction } from "./fs-state";
import type { TApi } from "../api/types";
import type { TStore } from "../store/store";

const MAX_OPEN_TABS = 5;

const pickNeighbourId = (
  openIds: readonly string[],
  closedId: string
): string | null => {
  const closedIndex = openIds.indexOf(closedId);
  if (closedIndex === -1) {
    return openIds[0] ?? null;
  }

  const next = openIds[closedIndex + 1];
  if (next !== undefined) {
    return next;
  }

  return openIds[closedIndex - 1] ?? null;
};

const openNodeAction = (store: TStore, api: TApi, nodeId: string) => {
  const node = store.derived.nodeById.peek().get(nodeId);
  if (node === undefined) {
    return;
  }

  if (node.kind === "folder") {
    toggleFolderAction(store, api, nodeId);

    return;
  }

  const openIds = store.tabs.openIds.peek();
  if (!openIds.includes(nodeId)) {
    // The strip holds five notes. Opening a sixth one drops the tab that was
    // opened first.
    store.tabs.openIds.value = [...openIds, nodeId].slice(-MAX_OPEN_TABS);
  }

  store.tabs.activeId.value = nodeId;

  ensureDocument(store, api, nodeId);
};

const activateTabAction = (store: TStore, api: TApi, nodeId: string) => {
  if (!store.tabs.openIds.peek().includes(nodeId)) {
    return;
  }

  store.tabs.activeId.value = nodeId;

  ensureDocument(store, api, nodeId);
};

const closeTabAction = (store: TStore, _api: TApi, nodeId: string) => {
  const openIds = store.tabs.openIds.peek();
  if (!openIds.includes(nodeId)) {
    return;
  }

  if (store.tabs.activeId.peek() === nodeId) {
    store.tabs.activeId.value = pickNeighbourId(openIds, nodeId);
  }

  store.tabs.openIds.value = openIds.filter((id) => id !== nodeId);
};

export { activateTabAction, closeTabAction, openNodeAction };
