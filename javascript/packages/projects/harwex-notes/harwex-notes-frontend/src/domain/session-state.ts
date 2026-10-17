import { effect } from "@preact/signals-react";
import type { TStore } from "../store/store";
import type { TApiClient } from "../api/api";
import type { TFsNode, TJsonValue, TTreeState } from "../api/types";

// Folder clicks come in bursts. One save after the burst is enough, and a reload within
// this window loses at most the last click.
const TREE_STATE_SAVE_DEBOUNCE_MS = 400;

type TSavedSession = {
  tree: TTreeState | null;
  settings: Readonly<Record<string, TJsonValue>>;
};

const readErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : "Unknown error";
};

// Session state is keyed by the vault-relative path ("Projects/notes/todo.md"), because
// node ids change on every backend start.
const readPathById = (nodes: readonly TFsNode[]): ReadonlyMap<string, string> => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const pathById = new Map<string, string>();

  const readPath = (node: TFsNode): string => {
    const known = pathById.get(node.id);
    if (known !== undefined) {
      return known;
    }

    const parent = node.parentId === null ? undefined : nodeById.get(node.parentId);
    const nodePath = parent === undefined ? node.name : `${readPath(parent)}/${node.name}`;

    pathById.set(node.id, nodePath);

    return nodePath;
  };

  for (const node of nodes) {
    readPath(node);
  }

  return pathById;
};

const readNodePath = (nodes: readonly TFsNode[], nodeId: string): string | null => {
  return readPathById(nodes).get(nodeId) ?? null;
};

const readTreeState = (
  nodes: readonly TFsNode[],
  expandedIds: readonly string[],
  selectedId: string | null
): TTreeState => {
  const pathById = readPathById(nodes);
  const expandedPaths = expandedIds
    .map((id) => pathById.get(id))
    .filter((nodePath): nodePath is string => nodePath !== undefined)
    .sort();

  return {
    expandedPaths,
    selectedPath: selectedId === null ? null : pathById.get(selectedId) ?? null,
  };
};

// A failed read leaves the app at its defaults. A reload never shows an error about
// state the user did not ask for (SESS-2).
const fetchSavedSession = async (api: TApiClient): Promise<TSavedSession | null> => {
  try {
    const [tree, settings] = await Promise.all([api.state.tree.query(), api.state.settings.query()]);

    return { tree, settings };
  } catch {
    return null;
  }
};

// Paths that no longer exist are dropped without a message (SESS-2).
const restoreSession = (store: TStore, session: TSavedSession | null) => {
  if (session === null) {
    return;
  }

  store.session.settings.value = session.settings;

  if (session.tree === null) {
    return;
  }

  const nodes = store.fs.nodes.peek();
  const idByPath = new Map([...readPathById(nodes)].map(([id, nodePath]) => [nodePath, id]));
  const folderIds = new Set(nodes.filter((node) => node.kind === "folder").map((node) => node.id));

  store.fs.expandedIds.value = session.tree.expandedPaths
    .map((nodePath) => idByPath.get(nodePath))
    .filter((id): id is string => id !== undefined && folderIds.has(id));

  const selectedPath = session.tree.selectedPath;
  store.fs.selectedId.value = selectedPath === null ? null : idByPath.get(selectedPath) ?? null;
};

// Sends the tree state now when a save is still waiting for its debounce. One per store,
// set by watchTreeState.
const flushTreeStateByStore = new WeakMap<TStore, () => void>();

// Saves the expanded folders and the selected row whenever they change, from any action.
// An effect is the one place that sees every change, so actions do not each have to
// remember to save. It reads `.value` on purpose: that is how it subscribes.
const watchTreeState = (store: TStore, api: TApiClient) => {
  if (flushTreeStateByStore.has(store)) {
    return;
  }

  const readCurrent = (): TTreeState => {
    return readTreeState(store.fs.nodes.value, store.fs.expandedIds.value, store.fs.selectedId.value);
  };

  let savedKey = JSON.stringify(readCurrent());
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingSave: (() => void) | null = null;

  const save = async (state: TTreeState, key: string) => {
    try {
      await api.state.setTree.mutate(state);
      savedKey = key;
    } catch (error) {
      store.session.error.value = readErrorMessage(error);
    }
  };

  effect(() => {
    const state = readCurrent();
    const key = JSON.stringify(state);

    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    pendingSave = null;

    if (key === savedKey) {
      return;
    }

    pendingSave = () => {
      pendingSave = null;
      void save(state, key);
    };

    timer = setTimeout(pendingSave, TREE_STATE_SAVE_DEBOUNCE_MS);
  });

  flushTreeStateByStore.set(store, () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    pendingSave?.();
  });
};

// A reload right after a click would otherwise lose the debounced save.
const flushTreeState = (store: TStore) => {
  flushTreeStateByStore.get(store)?.();
};

// Per-file state (a drawing's viewport, for example), keyed by the file's path. The backend
// moves and drops these rows with the file. Both helpers throw on an api failure; the
// calling action decides how to report it.
const readNodeState = async (
  store: TStore,
  api: TApiClient,
  nodeId: string,
  key: string
): Promise<TJsonValue | null> => {
  const nodePath = readNodePath(store.fs.nodes.peek(), nodeId);
  if (nodePath === null) {
    return null;
  }

  return api.state.getNodeState.query({ path: nodePath, key });
};

// A `null` value removes the row.
const writeNodeState = async (
  store: TStore,
  api: TApiClient,
  nodeId: string,
  key: string,
  value: TJsonValue | null
): Promise<void> => {
  const nodePath = readNodePath(store.fs.nodes.peek(), nodeId);
  if (nodePath === null) {
    return;
  }

  await api.state.setNodeState.mutate({ path: nodePath, key, value });
};

// App-wide settings. The store changes at once; a failed save is reported in
// `session.error` and the value stays for this page's life. A `null` value removes the key.
const setSettingAction = async (
  store: TStore,
  api: TApiClient,
  key: string,
  value: TJsonValue | null
) => {
  const nextSettings = { ...store.session.settings.peek() };

  if (value === null) {
    delete nextSettings[key];
  } else {
    nextSettings[key] = value;
  }

  store.session.settings.value = nextSettings;
  store.session.error.value = null;

  try {
    await api.state.setSetting.mutate({ key, value });
  } catch (error) {
    store.session.error.value = readErrorMessage(error);
  }
};

export {
  fetchSavedSession,
  flushTreeState,
  readNodePath,
  readPathById,
  readNodeState,
  restoreSession,
  setSettingAction,
  watchTreeState,
  writeNodeState,
};
