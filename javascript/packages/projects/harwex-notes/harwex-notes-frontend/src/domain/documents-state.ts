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

  try {
    await api.fs.updateDocument.mutate(snapshot);
  } catch (error) {
    // A failed save keeps the content and stops saving on its own; the next edit tries
    // again (DOC-7, DOC-8).
    setSaveState(store, nodeId, { state: "failed", message: readErrorMessage(error) });

    return;
  }

  const current = readReadyEntry(store, nodeId);
  if (current === null || current.save.state !== "saving") {
    return;
  }

  // Edits that arrived while the save was in flight are still unsaved.
  if (current.document === snapshot) {
    setSaveState(store, nodeId, { state: "saved" });
  } else {
    setSaveState(store, nodeId, { state: "unsaved" });
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
  // what asks to try again.
  const save: TDocumentSaveState = entry.save.state === "saving" ? entry.save : { state: "unsaved" };

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
    const document = await api.fs.document.query({ nodeId });

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
  excalidrawDocumentChangedAction,
  flushDocument,
  flushDocumentsAction,
  markdownDocumentChangedAction,
  reloadDocumentAction,
};
