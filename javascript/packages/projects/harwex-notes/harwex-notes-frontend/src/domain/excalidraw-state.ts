import { EXCALIDRAW_VIEWPORT_STATE_KEY, excalidrawViewportSchema } from "@hw/harwex-notes-protocol";
import { readNodeState, writeNodeState } from "./session-state";
import type { TExcalidrawViewport } from "@hw/harwex-notes-protocol";
import type { TStore } from "../store/store";
import type { TApiClient } from "../api/api";

// A pan or a zoom is a burst of events. One write after the burst is enough, and a reload
// within this window loses at most the last movement.
const VIEWPORT_SAVE_DEBOUNCE_MS = 500;

type TPendingViewport = {
  timer: ReturnType<typeof setTimeout>;
};

// Timers are not state the UI renders, so they live beside the store, not in it.
const pendingByStore = new WeakMap<TStore, Map<string, TPendingViewport>>();

const readPending = (store: TStore): Map<string, TPendingViewport> => {
  let byNodeId = pendingByStore.get(store);
  if (byNodeId === undefined) {
    byNodeId = new Map();
    pendingByStore.set(store, byNodeId);
  }

  return byNodeId;
};

const readErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : "Unknown error";
};

// Reads the saved viewport of a drawing into the store before the drawing is shown, so
// the viewer can open it where the user left it (EX-8). A drawing seen before keeps the
// viewport it has in memory. A failed or odd read leaves the drawing fitted to its content.
const loadExcalidrawViewport = async (store: TStore, api: TApiClient, nodeId: string) => {
  const node = store.derived.nodeById.peek().get(nodeId);
  if (node === undefined || node.kind !== "excalidraw") {
    return;
  }

  if (store.documents.excalidrawViewportById.peek()[nodeId] !== undefined) {
    return;
  }

  let value: unknown = null;

  try {
    value = await readNodeState(store, api, nodeId, EXCALIDRAW_VIEWPORT_STATE_KEY);
  } catch {
    return;
  }

  const parsed = excalidrawViewportSchema.safeParse(value);
  if (!parsed.success) {
    return;
  }

  store.documents.excalidrawViewportById.value = {
    ...store.documents.excalidrawViewportById.peek(),
    [nodeId]: parsed.data,
  };
};

const saveViewport = async (store: TStore, api: TApiClient, nodeId: string) => {
  const viewport = store.documents.excalidrawViewportById.peek()[nodeId];
  if (viewport === undefined) {
    return;
  }

  try {
    await writeNodeState(store, api, nodeId, EXCALIDRAW_VIEWPORT_STATE_KEY, viewport);
  } catch (error) {
    store.session.error.value = readErrorMessage(error);
  }
};

// Pan and zoom never touch the document, so they never cause a save of the file (EX-6).
// The store takes the viewport at once, so a tab switch reopens the drawing where it was;
// the state database gets it after the burst (EX-8).
const excalidrawViewportChangedAction = (
  store: TStore,
  api: TApiClient,
  nodeId: string,
  viewport: TExcalidrawViewport
) => {
  store.documents.excalidrawViewportById.value = {
    ...store.documents.excalidrawViewportById.peek(),
    [nodeId]: viewport,
  };

  const pending = readPending(store);
  const previous = pending.get(nodeId);
  if (previous !== undefined) {
    clearTimeout(previous.timer);
  }

  const timer = setTimeout(() => {
    pending.delete(nodeId);
    void saveViewport(store, api, nodeId);
  }, VIEWPORT_SAVE_DEBOUNCE_MS);

  pending.set(nodeId, { timer });
};

// A reload right after a pan would otherwise lose the debounced write (EX-8).
const flushPendingViewports = (store: TStore, api: TApiClient) => {
  const pending = readPending(store);

  for (const [nodeId, { timer }] of pending) {
    clearTimeout(timer);
    pending.delete(nodeId);
    void saveViewport(store, api, nodeId);
  }
};

export { excalidrawViewportChangedAction, flushPendingViewports, loadExcalidrawViewport };
