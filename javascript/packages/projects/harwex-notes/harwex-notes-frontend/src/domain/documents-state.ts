import { isConflictError } from "../api/errors";
import { loadExcalidrawViewport } from "./excalidraw-state";
import { raiseConflict, takeOutsideChangeDuringSave } from "./outside-changes";
import type { TDocument, TExcalidrawScene } from "@hw/harwex-notes-protocol";
import type { TDocumentEntry, TDocumentSaveState, TStore } from "../store/store";
import type { TApiClient } from "../api/api";

// A save runs 600 ms after the last change, and at the latest 3 s after the first unsaved
// change, so a user who types without pausing still reaches the disk (DOC-2).
const SAVE_DEBOUNCE_MS = 600;
const SAVE_MAX_DELAY_MS = 3000;

type TSaveTimers = {
  debounce: ReturnType<typeof setTimeout> | null;
  maxDelay: ReturnType<typeof setTimeout> | null;
};

// Timers are not state the UI renders, so they live beside the store, not in it.
const timersByStore = new WeakMap<TStore, Map<string, TSaveTimers>>();

const readTimers = (store: TStore, nodeId: string): TSaveTimers => {
  let byNodeId = timersByStore.get(store);
  if (byNodeId === undefined) {
    byNodeId = new Map();
    timersByStore.set(store, byNodeId);
  }

  let timers = byNodeId.get(nodeId);
  if (timers === undefined) {
    timers = { debounce: null, maxDelay: null };
    byNodeId.set(nodeId, timers);
  }

  return timers;
};

const cancelScheduledSave = (store: TStore, nodeId: string) => {
  const byNodeId = timersByStore.get(store);
  const timers = byNodeId?.get(nodeId);
  if (timers === undefined) {
    return;
  }

  if (timers.debounce !== null) {
    clearTimeout(timers.debounce);
  }

  if (timers.maxDelay !== null) {
    clearTimeout(timers.maxDelay);
  }

  byNodeId?.delete(nodeId);
};

const setEntry = (store: TStore, nodeId: string, entry: TDocumentEntry) => {
  store.documents.entryById.value = {
    ...store.documents.entryById.peek(),
    [nodeId]: entry,
  };
};

const readReadyEntry = (store: TStore, nodeId: string) => {
  const entry = store.documents.entryById.peek()[nodeId];
  if (entry === undefined || entry.status !== "ready") {
    return null;
  }

  return entry;
};

const setSaveState = (store: TStore, nodeId: string, save: TDocumentSaveState) => {
  const entry = readReadyEntry(store, nodeId);
  if (entry === null) {
    return;
  }

  setEntry(store, nodeId, { ...entry, save });
};

const readErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : "Unknown error";
};

const saveDocument = async (store: TStore, api: TApiClient, nodeId: string) => {
  cancelScheduledSave(store, nodeId);

  const entry = readReadyEntry(store, nodeId);
  if (entry === null || entry.save.state !== "unsaved") {
    return;
  }

  const snapshot = entry.document;
  setSaveState(store, nodeId, { state: "saving" });

  let version: string;

  try {
    ({ version } = await api.fs.updateDocument.mutate(snapshot));
  } catch (error) {
    // The file was deleted on disk while the save was in flight. That state stays.
    if (readReadyEntry(store, nodeId)?.save.state !== "saving") {
      return;
    }

    // The file changed on disk since this document read it (CONF-1).
    if (isConflictError(error)) {
      raiseConflict(store, nodeId);

      return;
    }

    // A failed save keeps the content and stops saving on its own; the next edit tries
    // again (DOC-7, DOC-8).
    setSaveState(store, nodeId, { state: "failed", message: readErrorMessage(error) });

    return;
  }

  const current = readReadyEntry(store, nodeId);
  if (current === null || current.save.state !== "saving") {
    return;
  }

  const isSnapshotCurrent = current.document === snapshot;
  const document = { ...current.document, version };

  // The file changed on disk while the save was in flight, and the change was not this
  // save. The disk now holds someone else's content (CONF-1).
  const outsideVersion = takeOutsideChangeDuringSave(store, nodeId);
  if (outsideVersion !== undefined && outsideVersion !== version) {
    setEntry(store, nodeId, { status: "ready", document, save: { state: "saving" } });
    raiseConflict(store, nodeId);

    return;
  }

  // Edits that arrived while the save was in flight are still unsaved.
  if (isSnapshotCurrent) {
    setEntry(store, nodeId, { status: "ready", document, save: { state: "saved" } });
  } else {
    setEntry(store, nodeId, { status: "ready", document, save: { state: "unsaved" } });
    scheduleSave(store, api, nodeId);
  }
};

const scheduleSave = (store: TStore, api: TApiClient, nodeId: string) => {
  const timers = readTimers(store, nodeId);

  if (timers.debounce !== null) {
    clearTimeout(timers.debounce);
  }

  timers.debounce = setTimeout(() => {
    void saveDocument(store, api, nodeId);
  }, SAVE_DEBOUNCE_MS);

  if (timers.maxDelay === null) {
    timers.maxDelay = setTimeout(() => {
      void saveDocument(store, api, nodeId);
    }, SAVE_MAX_DELAY_MS);
  }
};

const changeDocument = (store: TStore, api: TApiClient, nodeId: string, document: TDocument) => {
  const entry = readReadyEntry(store, nodeId);
  if (entry === null) {
    return;
  }

  // While a save is in flight the state stays "saving"; `saveDocument` notices the newer
  // document afterwards. There is no retry command, so the next edit after a failure is
  // what asks to try again. A conflict and a file deleted on disk keep automatic saving
  // stopped until the user chooses (CONF-4, SYNC-5).
  const isSaveHeld =
    entry.save.state === "saving" || entry.save.state === "conflict" || entry.save.state === "deleted";
  const save: TDocumentSaveState = isSaveHeld ? entry.save : { state: "unsaved" };

  setEntry(store, nodeId, { status: "ready", document, save });

  if (save.state === "unsaved") {
    scheduleSave(store, api, nodeId);
  }
};

const flushDocument = async (store: TStore, api: TApiClient, nodeId: string) => {
  await saveDocument(store, api, nodeId);
};

const loadDocument = async (store: TStore, api: TApiClient, nodeId: string) => {
  cancelScheduledSave(store, nodeId);
  setEntry(store, nodeId, { status: "loading" });

  try {
    // A drawing opens where the user left it, so its viewport has to be known first (EX-8).
    const [document] = await Promise.all([
      api.fs.document.query({ nodeId }),
      loadExcalidrawViewport(store, api, nodeId),
    ]);

    setEntry(store, nodeId, { status: "ready", document, save: { state: "saved" } });
  } catch (error) {
    setEntry(store, nodeId, { status: "error", message: readErrorMessage(error) });
  }
};

const ensureDocument = (store: TStore, api: TApiClient, nodeId: string) => {
  const entry = store.documents.entryById.peek()[nodeId];
  if (entry !== undefined && entry.status !== "error") {
    return;
  }

  void loadDocument(store, api, nodeId);
};

// After a rename or a move inside the app. An image or a page is loaded by the browser from
// a URL that holds its path, so the old URL is gone. A rename that changes the kind needs
// the viewer of the new kind (VIEW-3). Both reload. A document that has unsaved changes
// keeps them: reloading it would drop what the user typed.
const reloadMovedDocuments = (store: TStore, api: TApiClient, nodeIds: Iterable<string>) => {
  const entryById = store.documents.entryById.peek();
  const nodeById = store.derived.nodeById.peek();

  for (const nodeId of nodeIds) {
    const entry = entryById[nodeId];
    const node = nodeById.get(nodeId);
    if (entry === undefined || entry.status !== "ready" || node === undefined) {
      continue;
    }

    const isLoadedByPath = entry.document.kind === "image" || entry.document.kind === "html";
    const isKindChanged = entry.document.kind !== node.kind;

    if ((isLoadedByPath || isKindChanged) && entry.save.state === "saved") {
      void loadDocument(store, api, nodeId);
    }
  }
};

const reloadDocumentAction = (store: TStore, api: TApiClient, nodeId: string) => {
  void loadDocument(store, api, nodeId);
};

const excalidrawDocumentChangedAction = (
  store: TStore,
  api: TApiClient,
  nodeId: string,
  scene: TExcalidrawScene
) => {
  const entry = readReadyEntry(store, nodeId);
  if (entry === null || entry.document.kind !== "excalidraw") {
    return;
  }

  changeDocument(store, api, nodeId, { ...entry.document, scene });
};

const markdownDocumentChangedAction = (
  store: TStore,
  api: TApiClient,
  nodeId: string,
  text: string
) => {
  const entry = readReadyEntry(store, nodeId);
  if (entry === null || entry.document.kind !== "markdown") {
    return;
  }

  if (entry.document.text === text) {
    return;
  }

  changeDocument(store, api, nodeId, { ...entry.document, text });
};

// A plain text file saves the same way as Markdown (TXT-3).
const textDocumentChangedAction = (
  store: TStore,
  api: TApiClient,
  nodeId: string,
  text: string
) => {
  const entry = readReadyEntry(store, nodeId);
  if (entry === null || entry.document.kind !== "text") {
    return;
  }

  if (entry.document.text === text) {
    return;
  }

  changeDocument(store, api, nodeId, { ...entry.document, text });
};

// Cmd+S: every unsaved document goes to disk now instead of waiting for its timer.
const flushDocumentsAction = (store: TStore, api: TApiClient) => {
  const entryById = store.documents.entryById.peek();

  for (const [nodeId, entry] of Object.entries(entryById)) {
    if (entry.status !== "ready" || entry.save.state !== "unsaved") {
      continue;
    }

    void flushDocument(store, api, nodeId);
  }
};

export {
  cancelScheduledSave,
  ensureDocument,
  loadDocument,
  readReadyEntry,
  setEntry,
  excalidrawDocumentChangedAction,
  flushDocument,
  flushDocumentsAction,
  markdownDocumentChangedAction,
  reloadDocumentAction,
  textDocumentChangedAction,
  reloadMovedDocuments,
};
