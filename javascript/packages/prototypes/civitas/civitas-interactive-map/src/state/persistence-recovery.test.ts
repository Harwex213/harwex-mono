import assert from "node:assert/strict";
import test from "node:test";
import {
  CORRUPT_KEY,
  STATE_KEY,
  createMemoryStorage,
  defaultStorage,
  readState,
  utf16Bytes,
  writeState,
} from "./persistence";
import { createEmptyState, normalizeState } from "./schema";
import type { ProvinceOverride } from "./schema";
import type { ReadResult, StateStorage, WriteResult } from "./persistence";

// The recovery paths `persistence.test.ts` names but does not reach: the
// quarantine size guard, a quarantine that itself fails, the repair message cap,
// a serialisation that throws, and the two ways a browser refuses localStorage.

// The guard inside `quarantine`. It is not exported, so the boundary is stated
// here and the two tests below sit either side of it.
const QUARANTINE_MAX_CHARS = 524288;

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

// Invalid JSON of an exact character count.
function brokenPayload(chars: number): string {
  return "{" + "A".repeat(chars - 1);
}

// A document that trips all six repair categories at once, with two-digit counts
// so the joined note runs past the message cap.
function sixCategoryPayload(): unknown {
  const provinceOverrides: { [key: string]: unknown } = {};
  for (let at = 0; at < 12; at += 1) {
    provinceOverrides["bad" + at] = { name: "not a decimal id" };
  }
  for (let at = 0; at < 11; at += 1) {
    provinceOverrides[String(100 + at)] = {
      name: "kept",
      imageDataUrl: "http://example.test/flag.png",
    };
  }

  const countries: unknown[] = [];
  for (let at = 0; at < 13; at += 1) {
    countries.push({ id: 0, name: "reserved id" });
  }
  for (let at = 0; at < 12; at += 1) {
    countries.push({ id: 200 + at, colorHex: "#ab" });
  }
  const claims: number[] = [];
  for (let at = 1; at <= 14; at += 1) {
    claims.push(at);
  }
  countries.push({ id: 300, provinceIds: claims });
  countries.push({ id: 301, provinceIds: claims });

  const economics: { [key: string]: unknown } = {};
  for (let at = 0; at < 11; at += 1) {
    economics[String(900 + at)] = { version: 1, data: {} };
  }

  return { version: 1, provinceOverrides, countries, economics, nextCountryId: 1 };
}

test("defaultStorage falls back to a working memory store where localStorage is absent", () => {
  // Node has no localStorage, which is the same branch a browser takes when the
  // object is missing, and it is what makes the store testable with no options.
  assert.equal(typeof (globalThis as { localStorage?: unknown }).localStorage, "undefined");

  const found = defaultStorage();
  assert.equal(found.available, false);
  found.storage.setItem("k", "v");
  assert.equal(found.storage.getItem("k"), "v");
  found.storage.removeItem("k");
  assert.equal(found.storage.getItem("k"), null);
});

test("a localStorage that throws on the probe write, or on access, falls back to memory", () => {
  const target = globalThis as { localStorage?: unknown };

  // Safari private mode used to hand back the object and then throw on write,
  // so the probe write is what catches it.
  target.localStorage = {
    getItem(): string | null {
      return null;
    },
    setItem(): void {
      throw new Error("the store is full");
    },
    removeItem(): void {
      // Nothing to remove.
    },
  };
  const probed = defaultStorage();
  assert.equal(probed.available, false);
  probed.storage.setItem("k", "v");
  assert.equal(probed.storage.getItem("k"), "v", "the fallback must be a usable storage");

  // Safari with cookies blocked throws on the PROPERTY ACCESS itself, so the
  // access has to sit inside the try as well.
  delete target.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get(): never {
      throw new Error("access is denied");
    },
  });
  const denied = defaultStorage();
  assert.equal(denied.available, false);
  denied.storage.setItem("k", "v");
  assert.equal(denied.storage.getItem("k"), "v");

  delete target.localStorage;
  assert.equal(target.localStorage, undefined, "the global must be left as it was found");
});

test("a corrupt payload at the quarantine limit is copied, one character over is not", () => {
  const atLimit = fakeStorage();
  atLimit.setItem(STATE_KEY, brokenPayload(QUARANTINE_MAX_CHARS));
  const kept = readState(atLimit);

  assert.equal(kept.warning?.kind, "corrupt");
  assert.equal(atLimit.getItem(CORRUPT_KEY)?.length, QUARANTINE_MAX_CHARS);

  // Copying a multi-megabyte payload doubles usage and the very next write then
  // hits quota, so an oversized corpse is dropped rather than saved.
  const overLimit = fakeStorage();
  overLimit.setItem(STATE_KEY, brokenPayload(QUARANTINE_MAX_CHARS + 1));
  const dropped = readState(overLimit);

  assert.equal(dropped.warning?.kind, "corrupt");
  assert.equal(overLimit.getItem(CORRUPT_KEY), null);
  // Corrupt is still writable: the app replaces the garbage on the next edit.
  assert.equal(dropped.writable, true);
  assert.equal(kept.writable, true);
});

test("a quarantine that itself fails never escapes into the read", () => {
  const storage = fakeStorage((key) => {
    if (key === CORRUPT_KEY) {
      throw new Error("the store is full");
    }
  });
  storage.setItem(STATE_KEY, "{not json");

  let result: ReadResult | null = null;
  assert.doesNotThrow(() => {
    result = readState(storage);
  });

  assert.equal((result as ReadResult | null)?.warning?.kind, "corrupt");
  assert.equal((result as ReadResult | null)?.state.countries.length, 0);
  assert.equal(storage.getItem(CORRUPT_KEY), null);
});

test("every repair category is reported, and the joined note is capped for the banner", () => {
  const payload = sixCategoryPayload();
  const repairs = normalizeState(payload).repairs;

  assert.equal(repairs.length, 6, "one aggregated note per category, never one per record");
  assert.match(repairs.join("; "), /dropped 12 malformed province overrides/);
  assert.match(repairs.join("; "), /dropped 11 invalid province images/);
  assert.match(repairs.join("; "), /dropped 13 malformed countries/);
  assert.match(repairs.join("; "), /reset 12 country colours/);
  assert.match(repairs.join("; "), /dropped 14 duplicate province claims/);
  assert.match(repairs.join("; "), /dropped 11 orphan economics slots/);
  assert.ok(repairs.join("; ").length > 200, "the cap below is only meaningful past 200 chars");

  const storage = fakeStorage();
  storage.setItem(STATE_KEY, JSON.stringify(payload));
  const result = readState(storage);

  assert.equal(result.warning?.kind, "repaired");
  assert.ok(result.warning?.message.startsWith("the saved state was repaired on load: "));
  assert.ok(result.warning?.message.endsWith("..."), "an over-long note must be cut, not shown whole");
  assert.ok((result.warning?.message.length ?? 0) < 250);
  // Repairing exists to keep going and write the repaired document back.
  assert.equal(result.writable, true);
  assert.equal(result.state.countries.length, 14);
  assert.equal(storage.getItem(CORRUPT_KEY), null, "a repairable document is not corrupt");
});

test("readState honours an injected clock and a custom key, and quarantines to the fixed one", () => {
  const storage = fakeStorage();
  storage.setItem("civitas.state.other", "{not json");

  const result = readState(storage, { key: "civitas.state.other", now: () => 1234 });

  assert.equal(result.warning?.kind, "corrupt");
  assert.equal(result.warning?.at, 1234);
  assert.equal(result.bytes, utf16Bytes("{not json"));
  // The quarantine key is fixed, so a hand-written recovery always looks in one
  // place.
  assert.equal(storage.getItem(CORRUPT_KEY), "{not json");
  // The default key was never touched, so a default read is still a first run.
  assert.equal(readState(storage).warning, null);
});

test("the reported byte count includes the key's own characters", () => {
  const short = fakeStorage();
  const long = fakeStorage();

  const shortResult = writeState(short, createEmptyState(), { key: "k" });
  const longResult = writeState(long, createEmptyState(), { key: "kkkkk" });

  const text = short.getItem("k") ?? "";
  assert.equal(long.getItem("kkkkk"), text, "the document text is the same either way");
  assert.equal(shortResult.bytes, utf16Bytes(text) + utf16Bytes("k"));
  assert.equal(longResult.bytes - shortResult.bytes, 8, "four more key characters is eight bytes");
});

test("a serialisation that throws is reported, not raised into the caller", () => {
  const storage = fakeStorage();
  const state = createEmptyState();
  const hostile = {} as ProvinceOverride;
  Object.defineProperty(hostile, "name", {
    enumerable: true,
    get(): string {
      throw new Error("the override exploded");
    },
  });
  state.provinceOverrides.set(7, hostile);

  let result: WriteResult | null = null;
  assert.doesNotThrow(() => {
    result = writeState(storage, state);
  });

  const written = result as WriteResult | null;
  assert.equal(written?.ok, false);
  assert.equal(written?.ok === false ? written.reason : "", "unavailable");
  assert.equal(written?.ok === false ? written.message : "", "the override exploded");
  assert.equal(written?.ok === false ? written.bytes : -1, 0);
  assert.equal(storage.getItem(STATE_KEY), null, "a failed write leaves the key untouched");
});
