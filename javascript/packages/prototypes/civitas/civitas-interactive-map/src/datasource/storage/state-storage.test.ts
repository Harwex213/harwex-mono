import assert from "node:assert/strict";
import test from "node:test";
import {
  createCountry,
  createEmptyState,
  type CivitasState,
  type StateDoc,
} from "../../domain/world/schema";
import {
  CORRUPT_KEY,
  STATE_KEY,
  createMemoryStorage,
  isQuotaExceeded,
  readState,
  utf16Bytes,
  writeState,
  type StateStorage,
} from "./state-storage";
import type { Migration, MigrationDoc } from "../../domain/world/migrations";

// The storage is injected, so no test touches a global.

const IMAGE = "data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=";

// The production memory storage with a hook that can make `setItem` throw.
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

function populated(): CivitasState {
  const state = createEmptyState();
  state.provinceOverrides.set(7, { name: "Alnwick", lore: "A border keep.", imageDataUrl: IMAGE });
  const country = createCountry(1, "Testland");
  country.flagDataUrl = IMAGE;
  country.provinceIds = [7, 12];
  state.countries.push(country);
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

  // A throw fails the test. That is the "never throws" assertion.
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
