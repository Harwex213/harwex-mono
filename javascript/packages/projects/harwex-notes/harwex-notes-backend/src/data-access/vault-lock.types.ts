// Guards a critical section. The in-memory implementation only orders callers inside
// this process; the native one also holds an OS file lock, so a second process editing
// the same vault waits its turn.
type TVaultLock = {
  runExclusive: <T>(task: () => Promise<T>) => Promise<T>;
};

export type { TVaultLock };
