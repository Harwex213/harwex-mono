import type { TApi, TFsNode, TFsNodeKind } from "../api/types";
import type { TStore } from "../store/store";

// A folder and everything below it.
const collectSubtreeIds = (nodes: readonly TFsNode[], nodeId: string): ReadonlySet<string> => {
  const ids = new Set([nodeId]);
  let hasGrown = true;

  while (hasGrown) {
    hasGrown = false;

    for (const node of nodes) {
      if (node.parentId === null || ids.has(node.id)) {
        continue;
      }

      if (ids.has(node.parentId)) {
        ids.add(node.id);
        hasGrown = true;
      }
    }
  }

  return ids;
};

const expandFolder = (store: TStore, nodeId: string | null) => {
  if (nodeId === null) {
    return;
  }

  const expandedIds = store.fs.expandedIds.peek();
  if (expandedIds.includes(nodeId)) {
    return;
  }

  store.fs.expandedIds.value = [...expandedIds, nodeId];
};

const dropTabs = (store: TStore, removedIds: ReadonlySet<string>) => {
  const openIds = store.tabs.openIds.peek();
  const nextOpenIds = openIds.filter((id) => !removedIds.has(id));
  if (nextOpenIds.length === openIds.length) {
    return;
  }

  store.tabs.openIds.value = nextOpenIds;

  const activeId = store.tabs.activeId.peek();
  if (activeId === null || !removedIds.has(activeId)) {
    return;
  }

  store.tabs.activeId.value = nextOpenIds[nextOpenIds.length - 1] ?? null;
};

const dropDocuments = (store: TStore, removedIds: ReadonlySet<string>) => {
  const entryById = store.documents.entryById.peek();

  store.documents.entryById.value = Object.fromEntries(
    Object.entries(entryById).filter(([nodeId]) => !removedIds.has(nodeId))
  );
};

const readErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : "Unknown error";
};

const loadTreeAction = async (store: TStore, api: TApi) => {
  store.fs.isLoading.value = true;
  store.fs.error.value = null;

  try {
    const nodes = await api.fetchTree();

    store.fs.nodes.value = nodes;
    store.fs.expandedIds.value = nodes
      .filter((node) => node.kind === "folder" && node.parentId === null)
      .map((node) => node.id);
  } catch (error) {
    store.fs.error.value = readErrorMessage(error);
  } finally {
    store.fs.isLoading.value = false;
  }
};

// Collapsing a folder collapses everything below it, so reopening the folder
// always shows a closed subtree.
const toggleFolderAction = (store: TStore, _api: TApi, nodeId: string) => {
  const expandedIds = store.fs.expandedIds.peek();
  if (!expandedIds.includes(nodeId)) {
    store.fs.expandedIds.value = [...expandedIds, nodeId];

    return;
  }

  const collapsedIds = collectSubtreeIds(store.fs.nodes.peek(), nodeId);

  store.fs.expandedIds.value = expandedIds.filter((id) => !collapsedIds.has(id));
};

const selectNodeAction = (store: TStore, _api: TApi, nodeId: string) => {
  store.fs.selectedId.value = nodeId;
  store.fs.draft.value = null;
};

const startCreateAction = (
  store: TStore,
  _api: TApi,
  parentId: string | null,
  kind: TFsNodeKind
) => {
  store.fs.error.value = null;

  expandFolder(store, parentId);

  store.fs.draft.value = { mode: "create", parentId, kind };
};

const startRenameAction = (store: TStore, _api: TApi, nodeId: string) => {
  store.fs.error.value = null;
  store.fs.selectedId.value = nodeId;
  store.fs.draft.value = { mode: "rename", nodeId };
};

const cancelDraftAction = (store: TStore, _api: TApi) => {
  store.fs.draft.value = null;
  store.fs.error.value = null;
};

const createNode = async (
  store: TStore,
  api: TApi,
  parentId: string | null,
  kind: TFsNodeKind,
  name: string
) => {
  const { nodes, node } = await api.createNode({ parentId, name, kind });

  store.fs.nodes.value = nodes;
  store.fs.draft.value = null;
  store.fs.selectedId.value = node.id;

  if (node.kind === "folder") {
    expandFolder(store, node.id);
  }
};

const renameNode = async (store: TStore, api: TApi, nodeId: string, name: string) => {
  store.fs.nodes.value = await api.renameNode(nodeId, name);
  store.fs.draft.value = null;
};

// The draft row is the only place a name is typed, so both create and rename
// end here.
const submitDraftAction = async (store: TStore, api: TApi, name: string) => {
  const draft = store.fs.draft.peek();
  if (draft === null || store.fs.isBusy.peek()) {
    return;
  }

  if (name.trim().length === 0) {
    store.fs.draft.value = null;

    return;
  }

  store.fs.isBusy.value = true;
  store.fs.error.value = null;

  try {
    if (draft.mode === "create") {
      await createNode(store, api, draft.parentId, draft.kind, name);
    } else {
      await renameNode(store, api, draft.nodeId, name);
    }
  } catch (error) {
    store.fs.error.value = readErrorMessage(error);
  } finally {
    store.fs.isBusy.value = false;
  }
};

const moveNodeAction = async (
  store: TStore,
  api: TApi,
  nodeId: string,
  parentId: string | null
) => {
  if (store.fs.isBusy.peek()) {
    return;
  }

  store.fs.isBusy.value = true;
  store.fs.error.value = null;

  try {
    store.fs.nodes.value = await api.moveNode(nodeId, parentId);

    expandFolder(store, parentId);
  } catch (error) {
    store.fs.error.value = readErrorMessage(error);
  } finally {
    store.fs.isBusy.value = false;
  }
};

const deleteNodeAction = async (store: TStore, api: TApi, nodeId: string) => {
  if (store.fs.isBusy.peek()) {
    return;
  }

  const removedIds = collectSubtreeIds(store.fs.nodes.peek(), nodeId);

  store.fs.isBusy.value = true;
  store.fs.error.value = null;

  try {
    store.fs.nodes.value = await api.deleteNode(nodeId);
    store.fs.expandedIds.value = store.fs.expandedIds
      .peek()
      .filter((id) => !removedIds.has(id));

    const selectedId = store.fs.selectedId.peek();
    if (selectedId !== null && removedIds.has(selectedId)) {
      store.fs.selectedId.value = null;
    }

    dropTabs(store, removedIds);
    dropDocuments(store, removedIds);
  } catch (error) {
    store.fs.error.value = readErrorMessage(error);
  } finally {
    store.fs.isBusy.value = false;
  }
};

export {
  cancelDraftAction,
  deleteNodeAction,
  loadTreeAction,
  moveNodeAction,
  selectNodeAction,
  startCreateAction,
  startRenameAction,
  submitDraftAction,
  toggleFolderAction,
};
