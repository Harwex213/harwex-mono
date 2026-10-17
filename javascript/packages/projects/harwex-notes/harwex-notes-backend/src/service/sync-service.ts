import { createVaultWatcher } from "../data-access/vault-watcher.js";
import { isIgnoredRelativePath } from "../data-access/fs-data-access.js";
import type { TVaultChange } from "@hw/harwex-notes-protocol";
import type { FsDataAccess } from "../data-access/fs-data-access.types.js";
import type { TVaultWatcher, TWatch } from "../data-access/vault-watcher.js";

type TVaultChangeListener = (change: TVaultChange) => void;

// Hands each batch of outside changes to every connected client. A client that connects
// later reads the tree itself, so nothing is kept for it here.
type TVaultChanges = {
  publish: (change: TVaultChange) => void;
  subscribe: (listener: TVaultChangeListener) => () => void;
};

const createVaultChanges = (): TVaultChanges => {
  const listeners = new Set<TVaultChangeListener>();

  const publish = (change: TVaultChange) => {
    for (const listener of listeners) {
      listener(change);
    }
  };

  const subscribe = (listener: TVaultChangeListener) => {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  };

  return { publish, subscribe };
};

type TStartVaultSyncOptions = {
  dataAccess: FsDataAccess;
  vaultPath: string;
  changes: TVaultChanges;
  quietMs?: number;
  watch?: TWatch;
};

// Watches the vault and publishes what changed. The app's own writes come back from the
// watcher too; the data access recognises them by their version and drops them (SYNC-9).
const startVaultSync = (options: TStartVaultSyncOptions): TVaultWatcher => {
  return createVaultWatcher({
    vaultPath: options.vaultPath,
    isIgnored: isIgnoredRelativePath,
    quietMs: options.quietMs,
    watch: options.watch,
    onBatch: async (batch) => {
      const { nodes, changedFiles } = await options.dataAccess.syncWithDisk(batch);

      if (nodes === null && changedFiles.length === 0) {
        return;
      }

      options.changes.publish({ nodes: nodes === null ? null : [...nodes], changedFiles: [...changedFiles] });
    },
  });
};

// The changes as an async stream for one subscriber, until `signal` aborts. Changes that
// arrive while the subscriber is still sending the previous one wait in a queue.
async function* streamVaultChanges(changes: TVaultChanges, signal: AbortSignal | undefined) {
  const queue: TVaultChange[] = [];
  let wake: (() => void) | null = null;

  const unsubscribe = changes.subscribe((change) => {
    queue.push(change);
    wake?.();
  });

  const onAbort = () => {
    wake?.();
  };

  signal?.addEventListener("abort", onAbort);

  try {
    while (signal?.aborted !== true) {
      const change = queue.shift();

      if (change !== undefined) {
        yield change;
        continue;
      }

      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
    }
  } finally {
    unsubscribe();
    signal?.removeEventListener("abort", onAbort);
  }
}

export { createVaultChanges, startVaultSync, streamVaultChanges };
export type { TVaultChanges };
