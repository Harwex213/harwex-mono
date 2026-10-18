import { MIGRATIONS, runMigrations } from "./migrations";
import { STATE_VERSION, createEmptyState, isPlainObject, normalizeState, serializeState } from "./schema";
import type { Migration, MigrationDoc } from "./migrations";
import type { CivitasState } from "./schema";

// Reading and writing the one stored document. Every function takes the storage
// as an argument; only `defaultStorage` reaches for a global, and it does so
// inside a `try`.

// The `v1` here is a NAMESPACE and never changes. The schema version lives in
// the document's `version` field and is what the migration chain reads. Bumping
// this key would orphan every user's data, which is the exact thing the
// migration chain exists to prevent.
const STATE_KEY = "civitas.state.v1";
const CORRUPT_KEY = "civitas.state.v1.corrupt";

// 80% of a 5 MB quota. The store warns at this line so the user hears about it
// before an upload fails outright.
const STORAGE_BUDGET_BYTES = 4000000;

// Quarantining a 4 MB payload doubles usage and the very next write then hits
// quota, so a large corrupt payload is dropped rather than copied.
const QUARANTINE_MAX_CHARS = 524288;

const DEBOUNCE_MS = 400;

// A structural subset of the DOM `Storage` interface, so `window.localStorage`
// satisfies it with no adapter and a test fake is three methods.
type StateStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type WarningKind =
  | "corrupt"
  | "unmigratable"
  | "future"
  | "repaired"
  | "quota"
  | "unavailable"
  | "budget";

type StateWarning = {
  kind: WarningKind;
  message: string;
  at: number;
};

type ReadResult = {
  state: CivitasState;
  warning: StateWarning | null;
  // False when a document from a NEWER build was found. The store must not
  // overwrite it.
  writable: boolean;
  bytes: number;
};

type WriteResult =
  | { ok: true; bytes: number }
  | { ok: false; reason: "quota" | "unavailable"; bytes: number; message: string };

type ReadOptions = {
  key?: string;
  now?: () => number;
  chain?: readonly Migration[];
  // Defaults to `STATE_VERSION`. It is a parameter so the migration branch can
  // be exercised while the shipped schema is still at version 1 and no stored
  // document can legally be older than it.
  targetVersion?: number;
};

// Browsers account localStorage in UTF-16 code units, so a 5 MB quota is about
// 2.5 M characters. `new Blob([text]).size` measures UTF-8 and understates a
// base64 payload by up to half.
function utf16Bytes(text: string): number {
  return text.length * 2;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function createMemoryStorage(): StateStorage {
  const entries = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      const found = entries.get(key);
      return found === undefined ? null : found;
    },
    setItem(key: string, value: string): void {
      entries.set(key, value);
    },
    removeItem(key: string): void {
      entries.delete(key);
    },
  };
}

// Safari with cookies blocked throws on the PROPERTY ACCESS, not on `setItem`,
// so the access itself is inside the `try`. Safari private mode used to accept
// the object and throw on write, so a probe write follows. In Node
// `localStorage` is undefined and the same fallback path runs, which is what
// makes the store testable with no options at all.
function defaultStorage(): { storage: StateStorage; available: boolean } {
  try {
    const found = (globalThis as { localStorage?: StateStorage }).localStorage;
    if (!found) {
      return { storage: createMemoryStorage(), available: false };
    }
    const probe = "civitas.state.probe";
    found.setItem(probe, "1");
    found.removeItem(probe);
    return { storage: found, available: true };
  } catch {
    return { storage: createMemoryStorage(), available: false };
  }
}

function warn(kind: WarningKind, message: string, now: () => number): StateWarning {
  return { kind, message, at: now() };
}

// Best effort. A user can recover a damaged payload by hand from the corrupt
// key; failing to save it is not worth a second failure path.
function quarantine(storage: StateStorage, raw: string): void {
  if (raw.length > QUARANTINE_MAX_CHARS) {
    return;
  }
  try {
    storage.setItem(CORRUPT_KEY, raw);
  } catch {
    // Nothing to do. The quarantine copy is a courtesy, not a guarantee.
  }
}

function emptyRead(warning: StateWarning | null, writable: boolean, bytes: number): ReadResult {
  return { state: createEmptyState(), warning, writable, bytes };
}

// Never throws. Every failure returns an empty state plus a warning the UI can
// render.
function readState(storage: StateStorage, options: ReadOptions = {}): ReadResult {
  const key = options.key ?? STATE_KEY;
  const now = options.now ?? Date.now;
  const chain = options.chain ?? MIGRATIONS;
  const targetVersion = options.targetVersion ?? STATE_VERSION;

  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch (error) {
    return emptyRead(
      warn("unavailable", "browser storage is unreadable: " + messageOf(error), now),
      false,
      0,
    );
  }

  // A first run is not a problem and must not raise a banner.
  if (raw === null) {
    return emptyRead(null, true, 0);
  }

  const bytes = utf16Bytes(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    quarantine(storage, raw);
    return emptyRead(
      warn("corrupt", "the saved state could not be parsed (" + messageOf(error) + ")", now),
      true,
      bytes,
    );
  }

  // `Array.isArray` matters: an array is `typeof "object"`, and `"[]"` is what a
  // half-written document leaves behind.
  if (!isPlainObject(parsed)) {
    quarantine(storage, raw);
    return emptyRead(warn("corrupt", "the saved state was not an object", now), true, bytes);
  }

  const version = parsed.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    quarantine(storage, raw);
    return emptyRead(warn("corrupt", "the saved state carries no usable version", now), true, bytes);
  }

  // The user opened an older build in a second tab. Wiping their data would be
  // the worst possible response, so run in memory and touch nothing.
  if (version > targetVersion) {
    return emptyRead(
      warn(
        "future",
        "the saved state was written by a newer version (" +
          version +
          "); running without saving so it is not overwritten",
        now,
      ),
      false,
      bytes,
    );
  }

  let doc = parsed as MigrationDoc;
  if (version < targetVersion) {
    try {
      doc = runMigrations(doc, version, targetVersion, chain).doc;
    } catch (error) {
      quarantine(storage, raw);
      return emptyRead(
        warn(
          "unmigratable",
          "the saved state at version " + version + " could not be upgraded: " + messageOf(error),
          now,
        ),
        true,
        bytes,
      );
    }
  }

  const normalized = normalizeState(doc);
  if (normalized.repairs.length === 0) {
    return { state: normalized.state, warning: null, writable: true, bytes };
  }

  const joined = normalized.repairs.join("; ");
  return {
    state: normalized.state,
    warning: warn(
      "repaired",
      "the saved state was repaired on load: " +
        (joined.length > 200 ? joined.slice(0, 200) + "..." : joined),
      now,
    ),
    writable: true,
    bytes,
  };
}

// Duck-typed on purpose. `DOMException` is absent in some runtimes, and Firefox
// reports its own name and code.
function isQuotaExceeded(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { name?: unknown; code?: unknown };
  if (candidate.name === "QuotaExceededError") {
    return true;
  }
  if (candidate.name === "NS_ERROR_DOM_QUOTA_REACHED") {
    return true;
  }
  if (candidate.code === 22 || candidate.code === 1014) {
    return true;
  }
  return false;
}

// Never throws, never retries, and never evicts. Silently dropping the image the
// user just uploaded is worse than telling them the save failed, and the
// in-memory state survives either way.
function writeState(
  storage: StateStorage,
  state: CivitasState,
  options: { key?: string } = {},
): WriteResult {
  const key = options.key ?? STATE_KEY;

  let text = "";
  try {
    text = JSON.stringify(serializeState(state));
  } catch (error) {
    // A value slipped past `sanitizeJson` — a cycle, most likely. It must not
    // escape into a React render.
    return { ok: false, reason: "unavailable", bytes: 0, message: messageOf(error) };
  }

  const bytes = utf16Bytes(text) + utf16Bytes(key);

  try {
    storage.setItem(key, text);
  } catch (error) {
    if (isQuotaExceeded(error)) {
      return { ok: false, reason: "quota", bytes, message: messageOf(error) };
    }
    return { ok: false, reason: "unavailable", bytes, message: messageOf(error) };
  }

  return { ok: true, bytes };
}

// `@types/node` is in the program (tsconfig sets no `types` array) and can win
// the `setTimeout` overload, so the handle is not a `number`.
type TimerHandle = ReturnType<typeof setTimeout>;

type Timers = {
  set(fn: () => void, ms: number): TimerHandle;
  clear(handle: TimerHandle): void;
};

type StateWriter = {
  schedule(): void;
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

// A FIXED-WINDOW trailing debounce, not a restarting one. A restarting debounce
// starves: lore typed at one keystroke every 300 ms postpones the write for as
// long as the user keeps typing, and a crash then loses the lot. A fixed window
// bounds write latency at `delayMs` whatever the user does.
function createStateWriter(options: {
  write: () => void;
  delayMs?: number;
  timers?: Timers;
}): StateWriter {
  const delayMs = options.delayMs ?? DEBOUNCE_MS;
  const timers = options.timers ?? defaultTimers;

  let handle: TimerHandle | null = null;
  let dirty = false;

  function fire(): void {
    handle = null;
    if (!dirty) {
      return;
    }
    dirty = false;
    options.write();
  }

  return {
    schedule(): void {
      dirty = true;
      if (handle !== null) {
        return;
      }
      handle = timers.set(fire, delayMs);
    },
    flush(): void {
      if (handle !== null) {
        timers.clear(handle);
        handle = null;
      }
      if (!dirty) {
        return;
      }
      dirty = false;
      options.write();
    },
    cancel(): void {
      if (handle !== null) {
        timers.clear(handle);
        handle = null;
      }
      dirty = false;
    },
    pending(): boolean {
      return handle !== null;
    },
  };
}

export {
  CORRUPT_KEY,
  DEBOUNCE_MS,
  STATE_KEY,
  STORAGE_BUDGET_BYTES,
  createMemoryStorage,
  createStateWriter,
  defaultStorage,
  isQuotaExceeded,
  readState,
  utf16Bytes,
  writeState,
  type ReadResult,
  type StateStorage,
  type StateWarning,
  type StateWriter,
  type TimerHandle,
  type Timers,
  type WarningKind,
  type WriteResult,
};
