import { ensureDocument, flushDocument } from "./documents-state";
import { toggleFolderAction } from "./fs-state";
import type { TStore } from "../store/store";
import type { TApiClient } from "../api/api";

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

const openNodeAction = (store: TStore, api: TApiClient, nodeId: string) => {
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
    store.tabs.openIds.value = [...openIds, nodeId].slice(-MAX_OPEN_TABS);
  }

  store.tabs.activeId.value = nodeId;

  ensureDocument(store, api, nodeId);
};

const activateTabAction = (store: TStore, api: TApiClient, nodeId: string) => {
  if (!store.tabs.openIds.peek().includes(nodeId)) {
    return;
  }

  const previousId = store.tabs.activeId.peek();
  if (previousId !== null && previousId !== nodeId) {
    void flushDocument(store, api, previousId);
  }

  store.tabs.activeId.value = nodeId;

  ensureDocument(store, api, nodeId);
};

const closeTabAction = (store: TStore, api: TApiClient, nodeId: string) => {
  const openIds = store.tabs.openIds.peek();
  if (!openIds.includes(nodeId)) {
    return;
  }

  void flushDocument(store, api, nodeId);

  if (store.tabs.activeId.peek() === nodeId) {
    store.tabs.activeId.value = pickNeighbourId(openIds, nodeId);
  }

  store.tabs.openIds.value = openIds.filter((id) => id !== nodeId);
};

export { activateTabAction, closeTabAction, openNodeAction };
