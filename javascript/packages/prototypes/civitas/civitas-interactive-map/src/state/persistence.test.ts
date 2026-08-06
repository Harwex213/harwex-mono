import assert from "node:assert/strict";
import test from "node:test";
import { createCountry, createEmptyState } from "./schema";
import {
  CORRUPT_KEY,
  STATE_KEY,
  createMemoryStorage,
  createStateWriter,
  isQuotaExceeded,
  readState,
  utf16Bytes,
  writeState,
} from "./persistence";
import type { Migration, MigrationDoc } from "./migrations";
import type { CivitasState, StateDoc } from "./schema";
import type { StateStorage, TimerHandle, Timers } from "./persistence";

// Reading, writing and the debounce. The storage is injected everywhere, so
// nothing here touches a global and every failure path is reachable.

const IMAGE = "data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=";

// A `StateStorage` whose `setItem` can be made to throw. The base is the
// production memory storage, so the test never re-implements it.
function fakeStorage(onSet?: (key: string, value: string) => void): StateStorage {
  const inner = createMemoryStorage();
  return {
    getItem(key: string): string | null {
      return inner.getItem(key);
    },
    setItem(key: string, value: string): void {
      if (onSet) {
        onSet(key, value);
      }
      inner.setItem(key, value);
    },
    removeItem(key: string): void {
      inner.removeItem(key);
    },
  };
}

// Timers that never touch the clock. `run()` fires every armed callback, and
// `setCalls()` counts arms — a restarting debounce clears and re-arms, which
// `armed()` alone cannot see.
function fakeTimers(): Timers & { run(): void; armed(): number; setCalls(): number } {
  let nextHandle = 1;
  let sets = 0;
  const armed = new Map<number, () => void>();
  return {
    set(fn: () => void, _ms: number): TimerHandle {
      const handle = nextHandle;
      nextHandle += 1;
      sets += 1;
      armed.set(handle, fn);
      return handle as unknown as TimerHandle;
    },
    clear(handle: TimerHandle): void {
      armed.delete(handle as unknown as number);
    },
    run(): void {
      const due = [...armed.entries()];
      armed.clear();
      for (const [, fn] of due) {
        fn();
      }
    },
    armed(): number {
      return armed.size;
    },
    setCalls(): number {
      return sets;
    },
  };
}

function populated(): CivitasState {
  const state = createEmptyState();
  state.provinceOverrides.set(7, { name: "Alnwick", lore: "A border keep.", imageDataUrl: IMAGE });
  const country = createCountry(1, "Testland");
  country.flagDataUrl = IMAGE;
  country.provinceIds = [7, 12];
  state.countries.push(country);
  state.economics.set(1, { version: 1, data: { gdp: 12 } });
  state.nextCountryId = 2;
  return state;
}

function quotaError(): unknown {
  const error = new Error("full") as Error & { name: string; code: number };
  error.name = "QuotaExceededError";
  error.code = 22;
  return error;
}

test("a written state reads back identical, with no warning", () => {
  const storage = fakeStorage();
  const state = populated();

  const written = writeState(storage, state);
  assert.equal(written.ok, true);

  const read = readState(storage);
  assert.equal(read.warning, null);
  assert.equal(read.writable, true);
  assert.deepEqual(read.state, state);
  assert.ok(read.bytes > 0);
});

test("a missing key is a first run, not a warning", () => {
  const read = readState(fakeStorage());

  assert.equal(read.warning, null);
  assert.equal(read.writable, true);
  assert.equal(read.bytes, 0);
  assert.deepEqual(read.state, createEmptyState());
});

test("an unparseable payload is quarantined and the app starts empty", () => {
  const storage = fakeStorage();
  storage.setItem(STATE_KEY, "{not json");

  const read = readState(storage);

  assert.equal(read.warning?.kind, "corrupt");
  assert.deepEqual(read.state, createEmptyState());
  assert.equal(storage.getItem(CORRUPT_KEY), "{not json");
});

test("valid JSON that is not an object takes the corrupt path", () => {
  for (const payload of ["[]", "null", "7", "\"text\""]) {
    const storage = fakeStorage();
    storage.setItem(STATE_KEY, payload);

    const read = readState(storage);
    assert.equal(read.warning?.kind, "corrupt", payload + " must be corrupt");
    assert.equal(storage.getItem(CORRUPT_KEY), payload);
  }
});

test("a missing or non-integer version is corrupt", () => {
  for (const payload of ["{}", "{\"version\":0}", "{\"version\":1.5}", "{\"version\":\"1\"}"]) {
    const storage = fakeStorage();
    storage.setItem(STATE_KEY, payload);

    assert.equal(readState(storage).warning?.kind, "corrupt", payload + " must be corrupt");
  }
});

test("a document from a newer build is never overwritten", () => {
  const storage = fakeStorage();
  const payload = "{\"version\":99,\"countries\":[{\"id\":1,\"name\":\"future\"}]}";
  storage.setItem(STATE_KEY, payload);

  const read = readState(storage);

  assert.equal(read.warning?.kind, "future");
  assert.equal(read.writable, false);
  assert.deepEqual(read.state, createEmptyState());
  // Byte-identical: no quarantine copy, no clear, no rewrite.
  assert.equal(storage.getItem(STATE_KEY), payload);
  assert.equal(storage.getItem(CORRUPT_KEY), null);
});

test("an older document is migrated and normalised in one read", () => {
  const chain: Migration[] = [
    {
      from: 1,
      to: 2,
      migrate(doc: MigrationDoc): MigrationDoc {
        return { ...doc, version: 2, countries: [{ id: 1, name: "renamed by the migration" }] };
      },
    },
  ];
  const storage = fakeStorage();
  storage.setItem(STATE_KEY, "{\"version\":1,\"countries\":[{\"id\":1,\"name\":\"old\"}]}");

  const read = readState(storage, { chain, targetVersion: 2 });

  assert.equal(read.warning, null);
  assert.equal(read.writable, true);
  assert.equal(read.state.countries[0]?.name, "renamed by the migration");
});

test("a version with no migration is quarantined and reported, not silently lost", () => {
  const storage = fakeStorage();
  const payload = "{\"version\":1,\"countries\":[]}";
  storage.setItem(STATE_KEY, payload);

  const read = readState(storage, { targetVersion: 3 });

  assert.equal(read.warning?.kind, "unmigratable");
  assert.match(read.warning?.message ?? "", /version 1/);
  assert.equal(storage.getItem(CORRUPT_KEY), payload);
});

test("a partly broken payload keeps the good records and reports the repair", () => {
  const storage = fakeStorage();
  storage.setItem(
    STATE_KEY,
    "{\"version\":1,\"provinceOverrides\":{" +
      "\"7\":{\"name\":\"kept\"},\"abc\":{\"name\":\"bad key\"}," +
      "\"8\":\"bad value\",\"9\":{\"name\":\"kept too\"},\"0\":{\"name\":\"reserved\"}}}",
  );

  const read = readState(storage);

  assert.deepEqual([...read.state.provinceOverrides.keys()], [7, 9]);
  assert.equal(read.warning?.kind, "repaired");
  assert.match(read.warning?.message ?? "", /3 malformed province overrides/);
  assert.equal(read.writable, true);
});

test("a storage that throws on read leaves the app running and unwritable", () => {
  const storage: StateStorage = {
    getItem(): string | null {
      throw new Error("access denied");
    },
    setItem(): void {
      // Never reached.
    },
    removeItem(): void {
      // Never reached.
    },
  };

  const read = readState(storage);

  assert.equal(read.warning?.kind, "unavailable");
  assert.equal(read.writable, false);
  assert.deepEqual(read.state, createEmptyState());
});

test("a quota failure is returned, never thrown", () => {
  const storage = fakeStorage((key) => {
    if (key === STATE_KEY) {
      throw quotaError();
    }
  });

  // A throw here fails the test outright, which IS the "never throws" assertion.
  const result = writeState(storage, populated());

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.reason, "quota");
  assert.ok(result.bytes > 0);
});

test("isQuotaExceeded covers every browser's spelling of a full store", () => {
  assert.equal(isQuotaExceeded(quotaError()), true);
  assert.equal(isQuotaExceeded({ name: "NS_ERROR_DOM_QUOTA_REACHED" }), true);
  assert.equal(isQuotaExceeded({ code: 22 }), true);
  assert.equal(isQuotaExceeded({ code: 1014 }), true);

  assert.equal(isQuotaExceeded(new Error("disk on fire")), false);
  assert.equal(isQuotaExceeded(null), false);
  assert.equal(isQuotaExceeded("QuotaExceededError"), false);
});

test("any other write failure is reported as unavailable", () => {
  const storage = fakeStorage(() => {
    throw new Error("the store is gone");
  });

  const result = writeState(storage, createEmptyState());

  assert.equal(result.ok, false);
  assert.equal(result.ok === false ? result.reason : "", "unavailable");
  assert.equal(result.ok === false ? result.message : "", "the store is gone");
});

test("the writer batches a burst into one write and flushes on demand", () => {
  const timers = fakeTimers();
  let writes = 0;
  const writer = createStateWriter({
    write: () => {
      writes += 1;
    },
    timers,
  });

  assert.equal(writer.pending(), false);
  for (let at = 0; at < 5; at += 1) {
    writer.schedule();
  }
  // Fixed window, not a restarting debounce. A restarting one would clear and
  // re-arm on every schedule, which `armed()` cannot see but `setCalls()` can —
  // and a document typed at one keystroke every 300 ms would then never be
  // written at all.
  assert.equal(timers.armed(), 1);
  assert.equal(timers.setCalls(), 1, "the deadline must not be pushed out by a later schedule");
  assert.equal(writer.pending(), true);
  assert.equal(writes, 0);

  timers.run();
  assert.equal(writes, 1);
  assert.equal(writer.pending(), false);

  writer.schedule();
  writer.flush();
  assert.equal(writes, 2);
  assert.equal(timers.armed(), 0);

  // Idempotent: a flush with nothing dirty writes nothing.
  writer.flush();
  assert.equal(writes, 2);

  writer.schedule();
  writer.cancel();
  timers.run();
  assert.equal(writes, 2);
});

test("utf16Bytes counts code units and the memory storage behaves like Storage", () => {
  assert.equal(utf16Bytes(""), 0);
  assert.equal(utf16Bytes("abcd"), 8);

  const storage = createMemoryStorage();
  assert.equal(storage.getItem("missing"), null);
  storage.setItem("k", "v");
  assert.equal(storage.getItem("k"), "v");
  storage.removeItem("k");
  assert.equal(storage.getItem("k"), null);

  // The written payload is the serialised document, not the in-memory state.
  const target = fakeStorage();
  writeState(target, populated());
  const doc = JSON.parse(target.getItem(STATE_KEY) ?? "null") as StateDoc;
  assert.equal(doc.version, 1);
  assert.deepEqual(Object.keys(doc.provinceOverrides), ["7"]);
});
