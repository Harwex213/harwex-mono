// The clock for deferred work. It is a datasource so that a test can pass fake timers.

// `@types/node` can win the `setTimeout` overload, so the handle is not a `number`.
type TimerHandle = ReturnType<typeof setTimeout>;

type Timers = {
  set(fn: () => void, ms: number): TimerHandle;
  clear(handle: TimerHandle): void;
};

type Debouncer = {
  // The newest task wins. An older task scheduled in the same window never runs.
  schedule(task: () => void): void;
  flush(): void;
  cancel(): void;
  pending(): boolean;
};

const defaultTimers: Timers = {
  set(fn: () => void, ms: number): TimerHandle {
    return setTimeout(fn, ms);
  },
  clear(handle: TimerHandle): void {
    clearTimeout(handle);
  },
};

// Fixed-window trailing debounce, not a restarting one.
// A restarting debounce never fires during steady typing, and a crash then loses all of it.
// A fixed window caps the latency at `delayMs`.
function createDebouncer(options: { delayMs: number; timers?: Timers }): Debouncer {
  const timers = options.timers ?? defaultTimers;

  let handle: TimerHandle | null = null;
  let task: (() => void) | null = null;

  function run(): void {
    const due = task;
    task = null;
    if (due !== null) {
      due();
    }
  }

  function fire(): void {
    handle = null;
    run();
  }

  return {
    schedule(next: () => void): void {
      task = next;
      if (handle !== null) {
        return;
      }
      handle = timers.set(fire, options.delayMs);
    },
    flush(): void {
      if (handle !== null) {
        timers.clear(handle);
        handle = null;
      }
      run();
    },
    cancel(): void {
      if (handle !== null) {
        timers.clear(handle);
        handle = null;
      }
      task = null;
    },
    pending(): boolean {
      return handle !== null;
    },
  };
}

export { createDebouncer, type Debouncer, type TimerHandle, type Timers };
