import {
  MIGRATIONS,
  STATE_VERSION,
  createEmptyState,
  isPlainObject,
  normalizeState,
  runMigrations,
  serializeState,
  type CivitasState,
  type Migration,
  type MigrationDoc,
} from "../../domain/index";

// Reads and writes the one stored document.
// Every function takes the storage as an argument. Only `defaultStorage` touches a global.

// `v1` is a namespace and never changes. The schema version lives in the document's
// `version` field. A new key would orphan every user's data.
const STATE_KEY = "civitas.state.v1";
const CORRUPT_KEY = "civitas.state.v1.corrupt";

// 80% of a 5 MB quota, so the user gets a warning before a write fails.
const STORAGE_BUDGET_BYTES = 4000000;

// A larger corrupt payload is dropped, not copied. A copy would double usage and hit the quota.
const QUARANTINE_MAX_CHARS = 524288;

// A subset of DOM `Storage`, so `localStorage` fits with no adapter.
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
  // False when the document comes from a newer build. The store must not overwrite it.
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
  // Defaults to `STATE_VERSION`. A parameter, so tests can exercise migrations while the schema is at v1.
  targetVersion?: number;
};

// Browsers count localStorage in UTF-16 code units. A UTF-8 size understates the usage.
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

// Traps:
// - Safari with cookies blocked throws on the `localStorage` access itself, so the access is inside `try`.
// - Safari private mode throws only on write, so a probe write follows.
// - Node has no `localStorage` and falls back to memory.
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

// Best effort: keeps a damaged payload under the corrupt key for manual recovery.
function quarantine(storage: StateStorage, raw: string): void {
  if (raw.length > QUARANTINE_MAX_CHARS) {
    return;
  }
  try {
    storage.setItem(CORRUPT_KEY, raw);
  } catch {
    // Ignored on purpose.
  }
}

function emptyRead(warning: StateWarning | null, writable: boolean, bytes: number): ReadResult {
  return { state: createEmptyState(), warning, writable, bytes };
}

// Never throws. A failure returns an empty state plus a warning for the UI.
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

  // A first run raises no warning.
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

  // Rejects arrays too: a half-written document can leave `"[]"`.
  if (!isPlainObject(parsed)) {
    quarantine(storage, raw);
    return emptyRead(warn("corrupt", "the saved state was not an object", now), true, bytes);
  }

  const version = parsed.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    quarantine(storage, raw);
    return emptyRead(warn("corrupt", "the saved state carries no usable version", now), true, bytes);
  }

  // An older build opened in a second tab. Run in memory and do not touch the newer data.
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

// Duck-typed: some runtimes lack `DOMException`, and Firefox uses its own name and code.
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

// Never throws, retries or evicts. A reported failure beats silently dropping user data.
// The in-memory state survives either way.
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
    // Probably a cycle that `sanitizeJson` missed. It must not throw into a React render.
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

// One read and one write of the whole document.
// `available` is false when the source fell back to memory.
type StorageSource = {
  available: boolean;
  read(options?: ReadOptions): ReadResult;
  write(state: CivitasState): WriteResult;
};

// With no argument, probes `localStorage`. A passed storage counts as available.
function createStorageSource(storage?: StateStorage): StorageSource {
  const found = storage ? { storage, available: true } : defaultStorage();
  return {
    available: found.available,
    read(options?: ReadOptions): ReadResult {
      return readState(found.storage, options);
    },
    write(state: CivitasState): WriteResult {
      return writeState(found.storage, state);
    },
  };
}

export {
  CORRUPT_KEY,
  STATE_KEY,
  STORAGE_BUDGET_BYTES,
  createMemoryStorage,
  createStorageSource,
  defaultStorage,
  isQuotaExceeded,
  readState,
  utf16Bytes,
  writeState,
  type ReadResult,
  type StateStorage,
  type StateWarning,
  type StorageSource,
  type WarningKind,
  type WriteResult,
};
