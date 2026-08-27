import { cancelScheduledSave, flushDocument } from "./documents-state";
import type { TFsNode, TFsNodeKind } from "@hw/harwex-notes-protocol";
import type { TStore } from "../store/store";
import type { TApiClient } from "../api/api";
import { FILE_EXTENSIONS, readFileKind } from "./fs-file-kinds";

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

  for (const nodeId of removedIds) {
    cancelScheduledSave(store, nodeId);
  }

  store.documents.entryById.value = Object.fromEntries(
    Object.entries(entryById).filter(([nodeId]) => !removedIds.has(nodeId))
  );
};

const readErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : "Unknown error";
};

const loadTreeAction = async (store: TStore, api: TApiClient) => {
  store.fs.isLoading.value = true;
  store.fs.error.value = null;

  try {
    const nodes = await api.fs.tree.query();

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
const toggleFolderAction = (store: TStore, _api: TApiClient, nodeId: string) => {
  const expandedIds = store.fs.expandedIds.peek();
  if (!expandedIds.includes(nodeId)) {
    store.fs.expandedIds.value = [...expandedIds, nodeId];

    return;
  }

  const collapsedIds = collectSubtreeIds(store.fs.nodes.peek(), nodeId);

  store.fs.expandedIds.value = expandedIds.filter((id) => !collapsedIds.has(id));
};

const selectNodeAction = (store: TStore, _api: TApiClient, nodeId: string) => {
  store.fs.selectedId.value = nodeId;
  store.fs.draft.value = null;
};

const startCreateAction = (
  store: TStore,
  _api: TApiClient,
  parentId: string | null,
  kind: TFsNodeKind
) => {
  store.fs.error.value = null;

  expandFolder(store, parentId);

  store.fs.draft.value = { mode: "create", parentId, kind };
};

const startRenameAction = (store: TStore, _api: TApiClient, nodeId: string) => {
  store.fs.error.value = null;
  store.fs.selectedId.value = nodeId;
  store.fs.draft.value = { mode: "rename", nodeId };
};

const cancelDraftAction = (store: TStore, _api: TApiClient) => {
  store.fs.draft.value = null;
  store.fs.error.value = null;
};

// A "file" draft carries no kind, so the extension of the typed name has to name one.
// Anything else was started from a button that already knows what it creates.
const readCreateKind = (draftKind: TFsNodeKind, name: string): TFsNodeKind => {
  if (draftKind !== "file") {
    return draftKind;
  }

  const kind = readFileKind(name);
  if (kind === null) {
    throw new Error(`A file name has to end with ${FILE_EXTENSIONS.join(" or ")}`);
  }

  return kind;
};

const createNode = async (
  store: TStore,
  api: TApiClient,
  parentId: string | null,
  draftKind: TFsNodeKind,
  name: string
) => {
  const kind = readCreateKind(draftKind, name);

  const { nodes, node } = await api.fs.createNode.mutate({ parentId, name, kind });

  store.fs.nodes.value = nodes;
  store.fs.draft.value = null;
  store.fs.selectedId.value = node.id;

  if (node.kind === "folder") {
    expandFolder(store, node.id);
  }
};

// No write is ever in flight while a path changes (MUT-23).
const flushSubtree = async (store: TStore, api: TApiClient, nodeId: string) => {
  const ids = collectSubtreeIds(store.fs.nodes.peek(), nodeId);

  await Promise.all([...ids].map((id) => flushDocument(store, api, id)));
};

const renameNode = async (store: TStore, api: TApiClient, nodeId: string, name: string) => {
  await flushSubtree(store, api, nodeId);
  store.fs.nodes.value = await api.fs.renameNode.mutate({ nodeId, name });
  store.fs.draft.value = null;
};

const submitDraftAction = async (store: TStore, api: TApiClient, name: string) => {
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
  api: TApiClient,
  nodeId: string,
  parentId: string | null
) => {
  if (store.fs.isBusy.peek()) {
    return;
  }

  store.fs.isBusy.value = true;
  store.fs.error.value = null;

  try {
    await flushSubtree(store, api, nodeId);
    store.fs.nodes.value = await api.fs.moveNode.mutate({ nodeId, parentId });

    expandFolder(store, parentId);
  } catch (error) {
    store.fs.error.value = readErrorMessage(error);
  } finally {
    store.fs.isBusy.value = false;
  }
};

const deleteNodeAction = async (store: TStore, api: TApiClient, nodeId: string) => {
  if (store.fs.isBusy.peek()) {
    return;
  }

  const removedIds = collectSubtreeIds(store.fs.nodes.peek(), nodeId);

  store.fs.isBusy.value = true;
  store.fs.error.value = null;

  try {
    store.fs.nodes.value = await api.fs.deleteNode.mutate({ nodeId });
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
