import { batch } from "@preact/signals-react";
import {
  cancelScheduledSave,
  flushDocument,
  loadDocument,
  readReadyEntry,
  setEntry,
} from "./documents-state";
import { refreshContentSearch, rerunContentSearch } from "./content-search-state";
import { dropConflicts, noteOutsideChangeDuringSave, raiseConflict } from "./outside-changes";
import { readPathById } from "./session-state";
import type { TStore } from "../store/store";
import type { TDocumentEntry } from "../store/documents-slice";
import type { TApiClient } from "../api/api";
import type { TDocument, TFsNode } from "../api/types";

// After the change stream ends or fails for good, the next attempt waits this long. While
// the stream is only interrupted, the browser retries by itself (SYNC-7).
const RECONNECT_DELAY_MS = 2000;

type TChangedFile = {
  nodeId: string;
  version: string;
};

type TVaultChange = {
  nodes: readonly TFsNode[] | null;
  changedFiles: readonly TChangedFile[];
};

const readErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : "Unknown error";
};

const invertPathById = (pathById: ReadonlyMap<string, string>): Map<string, string> => {
  return new Map([...pathById].map(([id, nodePath]) => [nodePath, id]));
};

const mapId = (idMap: ReadonlyMap<string, string>, id: string): string => {
  return idMap.get(id) ?? id;
};

const mapRecordKeys = <T>(record: Readonly<Record<string, T>>, idMap: ReadonlyMap<string, string>) => {
  return Object.fromEntries(Object.entries(record).map(([id, value]) => [mapId(idMap, id), value]));
};

// The backend gives every entry a new id when it restarts, unless the path hash it derives
// the id from is taken. A tab, a selection or an expanded folder on such an entry moves to
// the new id of the same path, so a restart of the backend loses nothing.
const rekeyNodes = (store: TStore, idMap: ReadonlyMap<string, string>) => {
  const fsSlice = store.fs;
  const draft = fsSlice.draft.peek();

  fsSlice.expandedIds.value = fsSlice.expandedIds.peek().map((id) => mapId(idMap, id));

  const selectedId = fsSlice.selectedId.peek();
  fsSlice.selectedId.value = selectedId === null ? null : mapId(idMap, selectedId);

  if (draft?.mode === "rename") {
    fsSlice.draft.value = { ...draft, nodeId: mapId(idMap, draft.nodeId) };
  } else if (draft?.mode === "create" && draft.parentId !== null) {
    fsSlice.draft.value = { ...draft, parentId: mapId(idMap, draft.parentId) };
  }

  store.tabs.openIds.value = store.tabs.openIds.peek().map((id) => mapId(idMap, id));

  const activeId = store.tabs.activeId.peek();
  store.tabs.activeId.value = activeId === null ? null : mapId(idMap, activeId);

  const unsavedIds: string[] = [];
  const entryById: Record<string, TDocumentEntry> = {};

  for (const [id, entry] of Object.entries(store.documents.entryById.peek())) {
    const nextId = mapId(idMap, id);

    if (entry.status !== "ready" || nextId === id) {
      entryById[nextId] = entry;
      continue;
    }

    // A save timer or a save in flight still names the old id. The document saves again
    // under the new one.
    cancelScheduledSave(store, id);

    const isPending = entry.save.state === "unsaved" || entry.save.state === "saving";
    entryById[nextId] = {
      ...entry,
      document: { ...entry.document, nodeId: nextId },
      save: isPending ? { state: "unsaved" } : entry.save,
    };

    if (isPending) {
      unsavedIds.push(nextId);
    }
  }

  store.documents.entryById.value = entryById;
  store.documents.excalidrawViewportById.value = mapRecordKeys(store.documents.excalidrawViewportById.peek(), idMap);
  store.documents.conflictIds.value = store.documents.conflictIds.peek().map((id) => mapId(idMap, id));

  store.search.expandedIds.value = store.search.expandedIds.peek().map((id) => mapId(idMap, id));
  store.search.collapsedIds.value = store.search.collapsedIds.peek().map((id) => mapId(idMap, id));

  const preSearchSelectedId = store.search.preSearchSelectedId.peek();
  store.search.preSearchSelectedId.value = preSearchSelectedId === null ? null : mapId(idMap, preSearchSelectedId);

  const content = store.search.content.peek();
  if (content.status !== "idle") {
    const countById = new Map([...content.countById].map(([id, count]) => [mapId(idMap, id), count]));
    store.search.content.value = { ...content, countById };
  }

  return unsavedIds;
};

// Closing a tab activates its right neighbour, or its left one at the end (TAB-6).
const closeTabs = (store: TStore, closedIds: ReadonlySet<string>) => {
  const openIds = store.tabs.openIds.peek();
  const nextOpenIds = openIds.filter((id) => !closedIds.has(id));
  if (nextOpenIds.length === openIds.length) {
    return;
  }

  const activeId = store.tabs.activeId.peek();

  if (activeId !== null && closedIds.has(activeId)) {
    const activeIndex = openIds.indexOf(activeId);
    const right = openIds.slice(activeIndex + 1).find((id) => !closedIds.has(id));
    const left = openIds.slice(0, activeIndex).reverse().find((id) => !closedIds.has(id));

    store.tabs.activeId.value = right ?? left ?? null;
  }

  store.tabs.openIds.value = nextOpenIds;
};

// Entries that vanished from disk. A document with unsaved changes stays open, marked as
// deleted on disk, with automatic saving stopped. Every other tab on them closes (SYNC-5).
const dropRemovedNodes = (store: TStore, removedIds: ReadonlySet<string>, pathById: ReadonlyMap<string, string>) => {
  store.fs.expandedIds.value = store.fs.expandedIds.peek().filter((id) => !removedIds.has(id));

  const selectedId = store.fs.selectedId.peek();
  if (selectedId !== null && removedIds.has(selectedId)) {
    store.fs.selectedId.value = null;
  }

  const draft = store.fs.draft.peek();
  const isDraftGone =
    (draft?.mode === "rename" && removedIds.has(draft.nodeId)) ||
    (draft?.mode === "create" && draft.parentId !== null && removedIds.has(draft.parentId));

  if (isDraftGone) {
    store.fs.draft.value = null;
  }

  store.search.expandedIds.value = store.search.expandedIds.peek().filter((id) => !removedIds.has(id));
  store.search.collapsedIds.value = store.search.collapsedIds.peek().filter((id) => !removedIds.has(id));

  const entryById: Record<string, TDocumentEntry> = {};
  const closedIds = new Set<string>();

  for (const [id, entry] of Object.entries(store.documents.entryById.peek())) {
    if (!removedIds.has(id)) {
      entryById[id] = entry;
      continue;
    }

    cancelScheduledSave(store, id);

    const isDirty = entry.status === "ready" && entry.save.state !== "saved";
    const nodePath = pathById.get(id);

    if (!isDirty || nodePath === undefined || entry.status !== "ready") {
      closedIds.add(id);
      continue;
    }

    if (entry.save.state === "deleted") {
      entryById[id] = entry;
      continue;
    }

    const name = nodePath.slice(nodePath.lastIndexOf("/") + 1);
    entryById[id] = { ...entry, save: { state: "deleted", path: nodePath, name, message: null } };
  }

  for (const id of removedIds) {
    if (entryById[id] === undefined) {
      closedIds.add(id);
    }
  }

  store.documents.entryById.value = entryById;
  dropConflicts(store, removedIds);
  closeTabs(store, closedIds);
};

// Replaces the tree with the one on disk, keeping the expanded folders, the selection and
// the open tabs of every entry that is still there (SYNC-2, TREE-8).
const applyTree = (store: TStore, api: TApiClient, nodes: readonly TFsNode[]) => {
  const previousPathById = readPathById(store.fs.nodes.peek());
  const nextPathById = readPathById(nodes);
  const nextIdByPath = invertPathById(nextPathById);
  const nextKindById = new Map(nodes.map((node) => [node.id, node.kind]));
  const previousKindById = new Map(store.fs.nodes.peek().map((node) => [node.id, node.kind]));

  const idMap = new Map<string, string>();
  const removedIds = new Set<string>();

  for (const [id, nodePath] of previousPathById) {
    if (nextPathById.has(id)) {
      continue;
    }

    const nextId = nextIdByPath.get(nodePath);
    const isSameKind = nextId !== undefined && nextKindById.get(nextId) === previousKindById.get(id);

    if (nextId !== undefined && isSameKind && !previousPathById.has(nextId)) {
      idMap.set(id, nextId);
    } else {
      removedIds.add(id);
    }
  }

  let unsavedIds: string[] = [];

  batch(() => {
    if (idMap.size > 0) {
      unsavedIds = rekeyNodes(store, idMap);
    }

    store.fs.nodes.value = nodes;

    if (removedIds.size > 0) {
      dropRemovedNodes(store, removedIds, previousPathById);
    }
  });

  for (const nodeId of unsavedIds) {
    void flushDocument(store, api, nodeId);
  }
};

// The disk holds a newer version of an open file. A file without unsaved changes shows it
// in place (SYNC-3); one with unsaved changes raises a conflict and never reloads silently
// (SYNC-4). A document that is not open is dropped and reads the disk when it opens again.
const applyDiskVersion = (store: TStore, api: TApiClient, nodeId: string, version: string, fresh: TDocument | null) => {
  const entry = store.documents.entryById.peek()[nodeId];
  if (entry === undefined || entry.status === "loading") {
    return;
  }

  const isOpen = store.tabs.openIds.peek().includes(nodeId);

  if (entry.status === "error") {
    if (isOpen) {
      void loadDocument(store, api, nodeId);
    } else {
      dropEntry(store, nodeId);
    }

    return;
  }

  // The document already holds this version: the change was its own save (SYNC-9).
  if (entry.document.version === version) {
    return;
  }

  switch (entry.save.state) {
    case "saved": {
      if (!isOpen) {
        dropEntry(store, nodeId);
      } else if (fresh !== null) {
        setEntry(store, nodeId, { status: "ready", document: fresh, save: { state: "saved" } });
      } else {
        void reloadInPlace(store, api, nodeId);
      }

      return;
    }
    case "unsaved":
    case "failed": {
      cancelScheduledSave(store, nodeId);
      raiseConflict(store, nodeId);

      return;
    }
    case "saving": {
      noteOutsideChangeDuringSave(store, nodeId, version);

      return;
    }
    default: {
      return;
    }
  }
};

const dropEntry = (store: TStore, nodeId: string) => {
  const entryById = { ...store.documents.entryById.peek() };
  delete entryById[nodeId];
  store.documents.entryById.value = entryById;
};

// Reads the file again without showing the loading state, so the viewer keeps its place
// and only its content changes (SYNC-3). An image or a page gets a new URL and redraws.
const reloadInPlace = async (store: TStore, api: TApiClient, nodeId: string) => {
  let document: TDocument;

  try {
    document = await api.fs.document.query({ nodeId });
  } catch (error) {
    if (readReadyEntry(store, nodeId)?.save.state === "saved") {
      setEntry(store, nodeId, { status: "error", message: readErrorMessage(error) });
    }

    return;
  }

  const current = readReadyEntry(store, nodeId);
  if (current === null) {
    return;
  }

  // The user typed while the file was read. The disk changed under unsaved changes.
  if (current.save.state === "unsaved" || current.save.state === "failed") {
    cancelScheduledSave(store, nodeId);
    raiseConflict(store, nodeId);

    return;
  }

  if (current.save.state === "saved") {
    setEntry(store, nodeId, { status: "ready", document, save: { state: "saved" } });
  }
};

// An image is not a document, so nothing above reloads it. Its new version goes into the
// URL a Markdown file draws it from (MD-5, SYNC-3).
const noteImageVersions = (store: TStore, files: readonly TChangedFile[]) => {
  const nodeById = store.derived.nodeById.peek();
  const imageFiles = files.filter((file) => nodeById.get(file.nodeId)?.kind === "image");
  if (imageFiles.length === 0) {
    return;
  }

  const versionById = new Map(store.sync.imageVersionById.peek());

  for (const file of imageFiles) {
    versionById.set(file.nodeId, file.version);
  }

  store.sync.imageVersionById.value = versionById;
};

const applyVaultChange = (store: TStore, api: TApiClient, change: TVaultChange) => {
  if (change.nodes !== null) {
    applyTree(store, api, change.nodes);
  }

  noteImageVersions(store, change.changedFiles);

  for (const file of change.changedFiles) {
    applyDiskVersion(store, api, file.nodeId, file.version, null);
  }

  refreshContentSearch(store, api, change.changedFiles.map((file) => file.nodeId));
};

// After contact with the backend is (re)established, the app re-reads the whole tree and
// every loaded file, because changes made meanwhile were never reported (SYNC-8).
const resyncVault = async (store: TStore, api: TApiClient, isReconnect: boolean) => {
  let nodes: readonly TFsNode[];

  try {
    nodes = await api.fs.tree.query();
  } catch {
    // The stream reports the lost contact; the next connection syncs again.
    return;
  }

  applyTree(store, api, nodes);
  rerunContentSearch(store);

  // Any image may have changed while contact was lost. Each one gets a new URL, so a
  // Markdown file draws it from disk again.
  if (isReconnect) {
    const reconnectVersion = `reconnect-${Date.now().toString(36)}`;
    const imageFiles = nodes
      .filter((node) => node.kind === "image")
      .map((node) => ({ nodeId: node.id, version: reconnectVersion }));

    noteImageVersions(store, imageFiles);
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const entries = Object.entries(store.documents.entryById.peek());

  await Promise.all(entries.map(async ([nodeId, entry]) => {
    if (entry.status !== "ready" || !nodeIds.has(nodeId)) {
      return;
    }

    if (entry.save.state === "conflict" || entry.save.state === "deleted") {
      return;
    }

    try {
      const fresh = await api.fs.document.query({ nodeId });
      if (fresh.version !== undefined) {
        applyDiskVersion(store, api, nodeId, fresh.version, fresh);
      }
    } catch {
      // A file that cannot be read now shows its reason when it is opened again.
    }
  }));
};

const watchedStores = new WeakSet<TStore>();

// Listens for changes made to the vault outside the app for the life of the page
// (SYNC-1). Each (re)connection starts with a full re-check (SYNC-8).
const watchVault = (store: TStore, api: TApiClient) => {
  if (watchedStores.has(store)) {
    return;
  }

  watchedStores.add(store);

  const subscribe = () => {
    let isEnded = false;
    let subscription: { unsubscribe: () => void } | null = null;

    const reconnectLater = () => {
      if (isEnded) {
        return;
      }

      isEnded = true;
      store.sync.status.value = "offline";
      subscription?.unsubscribe();
      setTimeout(subscribe, RECONNECT_DELAY_MS);
    };

    subscription = api.fs.changes.subscribe(undefined, {
      onStarted: () => {
        const isReconnect = store.sync.status.peek() !== "connecting";
        store.sync.status.value = "online";
        void resyncVault(store, api, isReconnect);
      },
      onData: (change) => {
        applyVaultChange(store, api, change);
      },
      onConnectionStateChange: (state) => {
        if (state.state === "connecting" && state.error !== null) {
          store.sync.status.value = "offline";
        }
      },
      onError: reconnectLater,
      onComplete: reconnectLater,
    });
  };

  subscribe();
};

// Overwrite the file: the document is written over whatever the disk holds now (CONF-2).
const overwriteConflictAction = (store: TStore, api: TApiClient, nodeId: string) => {
  const entry = readReadyEntry(store, nodeId);
  if (entry === null || entry.save.state !== "conflict") {
    return;
  }

  dropConflicts(store, new Set([nodeId]));

  // A save without a version is never refused as stale.
  setEntry(store, nodeId, {
    status: "ready",
    document: { ...entry.document, version: undefined },
    save: { state: "unsaved" },
  });

  void flushDocument(store, api, nodeId);
};

// Discard my changes: the document is thrown away and read from disk again (CONF-2).
const discardConflictAction = (store: TStore, api: TApiClient, nodeId: string) => {
  const entry = readReadyEntry(store, nodeId);
  if (entry === null || entry.save.state !== "conflict") {
    return;
  }

  dropConflicts(store, new Set([nodeId]));
  void loadDocument(store, api, nodeId);
};

// Writes a document that was deleted on disk back to its old path and recreates the file
// (SYNC-5). A failure keeps the tab marked as deleted and says why.
const restoreDocumentAction = async (store: TStore, api: TApiClient, nodeId: string) => {
  const entry = readReadyEntry(store, nodeId);
  if (entry === null || entry.save.state !== "deleted") {
    return;
  }

  const deleted = entry.save;
  setEntry(store, nodeId, { ...entry, save: { state: "saving" } });

  try {
    const result = await api.fs.restoreDocument.mutate({
      path: deleted.path,
      document: { ...entry.document, version: undefined },
    });

    applyTree(store, api, result.nodes);

    const current = readReadyEntry(store, nodeId);
    if (current === null) {
      return;
    }

    const isUnchanged = current.document === entry.document;
    const document = { ...current.document, version: result.version };

    setEntry(store, nodeId, { status: "ready", document, save: { state: isUnchanged ? "saved" : "unsaved" } });

    if (!isUnchanged) {
      void flushDocument(store, api, nodeId);
    }
  } catch (error) {
    const current = readReadyEntry(store, nodeId) ?? entry;
    setEntry(store, nodeId, { ...current, save: { ...deleted, message: readErrorMessage(error) } });
  }
};

// A tab whose changes the user agreed to lose (TAB-9): its conflict ends with it, a
// document whose file is gone has nothing left to show, and a failed save is given up.
const forgetClosedDocument = (store: TStore, nodeId: string) => {
  const entry = readReadyEntry(store, nodeId);
  if (entry === null) {
    return;
  }

  if (entry.save.state === "conflict" || entry.save.state === "deleted" || entry.save.state === "failed") {
    dropConflicts(store, new Set([nodeId]));
    dropEntry(store, nodeId);
  }
};

export {
  discardConflictAction,
  forgetClosedDocument,
  overwriteConflictAction,
  restoreDocumentAction,
  watchVault,
};
