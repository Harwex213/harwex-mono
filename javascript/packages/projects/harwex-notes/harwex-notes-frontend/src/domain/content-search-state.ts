import { effect, signal } from "@preact/signals-react";
import {
  MAX_CONTENT_SEARCH_NODE_IDS,
  MIN_CONTENT_SEARCH_TERM_LENGTH,
} from "@hw/harwex-notes-protocol";
import type { TStore } from "../store/store";
import type { TApiClient } from "../api/api";

// Names filter at once as the user types. Content waits for a short pause, so a fast
// typist does not start a vault-wide search for every letter (SRCH-11).
const CONTENT_SEARCH_DEBOUNCE_MS = 250;

const readErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : "Unknown error";
};

// Asks the backend slice by slice and publishes the counts after each slice, so results
// appear while the search runs (SRCH-16). A newer term aborts this run; an aborted run
// never writes to the store, so only the newest term's results apply.
const runContentSearch = async (
  store: TStore,
  api: TApiClient,
  term: string,
  fileIds: readonly string[],
  signal: AbortSignal
) => {
  const previous = store.search.content.peek();
  const fileIdSet = new Set(fileIds);

  // A re-run for the same term (the tree changed) starts from what it already found, so
  // rows do not vanish and come back while the files are read again.
  let countById: ReadonlyMap<string, number> = new Map(
    previous.status !== "idle" && previous.term === term
      ? [...previous.countById].filter(([nodeId]) => fileIdSet.has(nodeId))
      : []
  );

  store.search.content.value = { status: "running", term, countById };

  try {
    for (let start = 0; start < fileIds.length; start += MAX_CONTENT_SEARCH_NODE_IDS) {
      const nodeIds = fileIds.slice(start, start + MAX_CONTENT_SEARCH_NODE_IDS);
      const { matches } = await api.fs.search.query({ term, nodeIds }, { signal });

      if (signal.aborted) {
        return;
      }

      const next = new Map(countById);

      for (const nodeId of nodeIds) {
        next.delete(nodeId);
      }

      for (const match of matches) {
        next.set(match.nodeId, match.count);
      }

      countById = next;
      store.search.content.value = { status: "running", term, countById };
    }

    store.search.content.value = { status: "done", term, countById };
  } catch (error) {
    if (signal.aborted) {
      return;
    }

    store.search.content.value = { status: "error", term, countById, message: readErrorMessage(error) };
  }
};

const watchedStores = new WeakSet<TStore>();

// Starts the content search of the current term again from scratch. One per store, set by
// watchContentSearch.
const rerunByStore = new WeakMap<TStore, () => void>();

// Runs the content search whenever the term or the set of files changes, from any action.
// A file created or deleted while a filter is active joins or leaves the results
// (SRCH-15). It reads `.value` on purpose: that is how the effect subscribes.
const watchContentSearch = (store: TStore, api: TApiClient) => {
  if (watchedStores.has(store)) {
    return;
  }

  watchedStores.add(store);

  let searchedKey = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  // Bumped when files changed on disk in a way the running search may have missed.
  const rerunCount = signal(0);

  rerunByStore.set(store, () => {
    rerunCount.value += 1;
  });

  effect(() => {
    const term = store.search.term.value;
    const nodes = store.fs.nodes.value;
    const rerun = rerunCount.value;

    // A term of one character filters on names only (SRCH-10).
    const isContentTerm = term.length >= MIN_CONTENT_SEARCH_TERM_LENGTH;
    const fileIds = isContentTerm
      ? nodes.filter((node) => node.kind !== "folder").map((node) => node.id)
      : [];
    const key = isContentTerm ? `${rerun}\n${term}\n${fileIds.join("\n")}` : "";

    if (key === searchedKey) {
      return;
    }

    searchedKey = key;

    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    controller?.abort();
    controller = null;

    if (!isContentTerm) {
      store.search.content.value = { status: "idle" };

      return;
    }

    timer = setTimeout(() => {
      timer = null;
      controller = new AbortController();
      void runContentSearch(store, api, term, fileIds, controller.signal);
    }, CONTENT_SEARCH_DEBOUNCE_MS);
  });
};

// Files whose content changed on disk outside the app. A filter stays live: a file edited
// so that it now matches joins the results, one that no longer matches leaves (SRCH-15).
// Only those files are read again. A search still running starts over instead, because
// it may already have read some of them.
const refreshContentSearch = (store: TStore, api: TApiClient, nodeIds: readonly string[]) => {
  const content = store.search.content.peek();
  if (content.status === "idle" || nodeIds.length === 0) {
    return;
  }

  if (content.status === "running") {
    rerunByStore.get(store)?.();

    return;
  }

  const fileIds = new Set(store.fs.nodes.peek().filter((node) => node.kind !== "folder").map((node) => node.id));
  const changedIds = [...new Set(nodeIds)].filter((nodeId) => fileIds.has(nodeId));
  const term = content.term;

  const refresh = async () => {
    for (let start = 0; start < changedIds.length; start += MAX_CONTENT_SEARCH_NODE_IDS) {
      const slice = changedIds.slice(start, start + MAX_CONTENT_SEARCH_NODE_IDS);
      const { matches } = await api.fs.search.query({ term, nodeIds: slice });

      // The term changed or a new run started meanwhile. That run reads the files itself.
      const current = store.search.content.peek();
      if (current.status === "idle" || current.status === "running" || current.term !== term) {
        return;
      }

      const countById = new Map(current.countById);

      for (const nodeId of slice) {
        countById.delete(nodeId);
      }

      for (const match of matches) {
        countById.set(match.nodeId, match.count);
      }

      store.search.content.value = { ...current, countById };
    }
  };

  // A failed refresh leaves the earlier counts. The next search reads the files again.
  refresh().catch(() => undefined);
};

// Everything may have changed while the app had no contact with the vault (SYNC-8).
const rerunContentSearch = (store: TStore) => {
  if (store.search.content.peek().status !== "idle") {
    rerunByStore.get(store)?.();
  }
};

export { refreshContentSearch, rerunContentSearch, watchContentSearch };
