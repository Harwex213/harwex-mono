import fs from "node:fs";

// Watches the vault for changes made outside the app (SYNC-1). Editors, git and file
// managers change files in bursts: a save is often a temp file, a rename and a chmod, and
// a checkout touches hundreds of paths. Events are collected until the vault has been quiet
// for a moment and handed over as one batch of paths.

// A batch goes out after this much quiet...
const DEFAULT_QUIET_MS = 150;
// ...or at the latest this long after its first event, so a stream of changes that never
// pauses still reaches the app.
const DEFAULT_MAX_WAIT_MS = 1000;
// A watcher that failed (the vault folder was removed or replaced) is opened again after
// this delay, and the first batch after that rescans everything.
const RESTART_DELAY_MS = 2000;

type TWatchHandle = {
  close: () => void;
};

// `relativePath` is null when the platform did not say which path changed.
type TWatch = (
  vaultPath: string,
  onEvent: (relativePath: string | null) => void,
  onError: (error: Error) => void
) => TWatchHandle;

// Null means "something changed, but not known where": the receiver rescans everything.
type TWatchBatch = ReadonlySet<string> | null;

type TVaultWatcherOptions = {
  vaultPath: string;
  // Paths the tree never lists. Their events are dropped before they start a batch.
  isIgnored: (relativePath: string) => boolean;
  // Batches never overlap: the next one waits until this promise settles.
  onBatch: (batch: TWatchBatch) => Promise<void>;
  quietMs?: number;
  maxWaitMs?: number;
  watch?: TWatch;
};

type TVaultWatcher = {
  close: () => void;
  // Resolves when no batch is collected or running. For tests.
  settle: () => Promise<void>;
};

// `recursive: true` works on macOS and Windows, and on Linux since Node 20.
const watchWithNode: TWatch = (vaultPath, onEvent, onError) => {
  const watcher = fs.watch(vaultPath, { recursive: true }, (_eventType, filename) => {
    onEvent(filename === null ? null : filename.toString());
  });

  watcher.on("error", onError);

  return { close: () => watcher.close() };
};

const createVaultWatcher = (options: TVaultWatcherOptions): TVaultWatcher => {
  const quietMs = options.quietMs ?? DEFAULT_QUIET_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const watch = options.watch ?? watchWithNode;

  let pendingPaths = new Set<string>();
  let isPendingUnknown = false;
  let hasPending = false;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let handle: TWatchHandle | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let isClosed = false;
  let idleWaiters: (() => void)[] = [];

  const clearTimers = () => {
    if (quietTimer !== null) {
      clearTimeout(quietTimer);
      quietTimer = null;
    }

    if (maxWaitTimer !== null) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  };

  const notifyIdle = () => {
    if (hasPending || running !== null || quietTimer !== null) {
      return;
    }

    const waiters = idleWaiters;
    idleWaiters = [];

    for (const waiter of waiters) {
      waiter();
    }
  };

  const runBatch = () => {
    clearTimers();

    if (!hasPending || isClosed) {
      notifyIdle();

      return;
    }

    // One batch at a time. The paths that arrive meanwhile wait for the next one.
    if (running !== null) {
      return;
    }

    const batch: TWatchBatch = isPendingUnknown ? null : pendingPaths;
    pendingPaths = new Set();
    isPendingUnknown = false;
    hasPending = false;

    running = options.onBatch(batch)
      .catch((error: unknown) => {
        console.error(`Cannot apply changes from disk: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        running = null;

        if (hasPending) {
          scheduleBatch();
        } else {
          notifyIdle();
        }
      });
  };

  const scheduleBatch = () => {
    if (quietTimer !== null) {
      clearTimeout(quietTimer);
    }

    quietTimer = setTimeout(runBatch, quietMs);

    if (maxWaitTimer === null) {
      maxWaitTimer = setTimeout(runBatch, maxWaitMs);
    }
  };

  const onEvent = (relativePath: string | null) => {
    if (isClosed) {
      return;
    }

    if (relativePath === null) {
      isPendingUnknown = true;
    } else if (relativePath.length === 0 || options.isIgnored(relativePath)) {
      return;
    } else {
      pendingPaths.add(relativePath);
    }

    hasPending = true;
    scheduleBatch();
  };

  const start = () => {
    restartTimer = null;

    if (isClosed) {
      return;
    }

    try {
      handle = watch(options.vaultPath, onEvent, onError);
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  // The watcher may have missed changes while it was down, so the next batch rescans all.
  function onError(error: Error) {
    console.error(`The vault watcher stopped: ${error.message}. Retrying in ${RESTART_DELAY_MS} ms`);

    handle?.close();
    handle = null;

    if (isClosed || restartTimer !== null) {
      return;
    }

    restartTimer = setTimeout(() => {
      start();

      if (handle !== null) {
        onEvent(null);
      }
    }, RESTART_DELAY_MS);
  }

  start();

  const close = () => {
    isClosed = true;
    clearTimers();
    handle?.close();
    handle = null;

    if (restartTimer !== null) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
  };

  const settle = async () => {
    if (!hasPending && running === null && quietTimer === null) {
      return;
    }

    await new Promise<void>((resolve) => {
      idleWaiters.push(resolve);
    });
  };

  return { close, settle };
};

export { createVaultWatcher };
export type { TVaultWatcher, TVaultWatcherOptions, TWatch, TWatchBatch };
