import { ensureDocument, flushDocument } from "./documents-state";
import { toggleFolderAction } from "./fs-state";
import { forgetClosedDocument } from "./sync-state";
import { isVaultHref, resolveVaultLink } from "./vault-links";
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
  store.tabs.linkError.value = null;

  ensureDocument(store, api, nodeId);
};

// Opens the vault file a link in a document points at, as a tab (EX-9, MD-6). A folder is
// shown in the tree instead. A link with no target opens nothing and says why (MD-7).
const openVaultLinkAction = (store: TStore, api: TApiClient, fromNodeId: string, href: string) => {
  if (!isVaultHref(href)) {
    return;
  }

  const target = resolveVaultLink(store.fs.nodes.peek(), fromNodeId, href);
  if (target.status === "refused") {
    store.tabs.linkError.value = target.message;

    return;
  }

  if (target.node.kind === "folder") {
    store.tabs.linkError.value = null;
    store.fs.selectedId.value = target.node.id;

    if (!store.fs.expandedIds.peek().includes(target.node.id)) {
      toggleFolderAction(store, api, target.node.id);
    }

    return;
  }

  openNodeAction(store, api, target.node.id);
};

const dismissLinkErrorAction = (store: TStore, _api: TApiClient) => {
  store.tabs.linkError.value = null;
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
  forgetClosedDocument(store, nodeId);

  if (store.tabs.activeId.peek() === nodeId) {
    store.tabs.activeId.value = pickNeighbourId(openIds, nodeId);
  }

  store.tabs.openIds.value = openIds.filter((id) => id !== nodeId);
};

export {
  activateTabAction,
  closeTabAction,
  dismissLinkErrorAction,
  openNodeAction,
  openVaultLinkAction,
};
