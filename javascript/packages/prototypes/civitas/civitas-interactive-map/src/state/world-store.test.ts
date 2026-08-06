import assert from "node:assert/strict";
import test from "node:test";
import { STATE_KEY, createMemoryStorage } from "./persistence";
import {
  IMAGE_DATA_URL_MAX,
  countryDisplayName,
  createCountry,
  createEmptyState,
  serializeState,
} from "./schema";
import {
  addCountry,
  assignProvinces,
  buildCountryAssignment,
  clearProvinceOverride,
  countries,
  countryById,
  countryOfProvince,
  deleteCountry,
  economics,
  economicsOf,
  flushState,
  initWorldStore,
  nextCountryId,
  patchCountryEconomics,
  provinceDisplayName,
  provinceOverrideOf,
  provinceOverrides,
  setCountryEconomics,
  setProvinceImage,
  setProvinceLore,
  setProvinceName,
  stateBytes,
  statePersistent,
  stateWarning,
  updateCountry,
} from "./world-store";
import type { StateDoc } from "./schema";
import type { StateStorage, TimerHandle, Timers } from "./persistence";

// The store is a module singleton, so `initWorldStore` with an injected storage
// and injected timers IS the reset between tests. That is what the injection
// seam is for.

const IMAGE = "data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAA=";

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

function fakeTimers(): Timers & { run(): void; armed(): number } {
  let nextHandle = 1;
  const armed = new Map<number, () => void>();
  return {
    set(fn: () => void, _ms: number): TimerHandle {
      const handle = nextHandle;
      nextHandle += 1;
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
  };
}

function storedDoc(storage: StateStorage): StateDoc | null {
  const raw = storage.getItem(STATE_KEY);
  if (raw === null) {
    return null;
  }
  return JSON.parse(raw) as StateDoc;
}

function quotaError(): unknown {
  const error = new Error("full") as Error & { name: string };
  error.name = "QuotaExceededError";
  return error;
}

test("init hydrates every signal from a stored document", () => {
  const storage = fakeStorage();
  const seed = createEmptyState();
  seed.provinceOverrides.set(7, { name: "Alnwick", imageDataUrl: IMAGE });
  const country = createCountry(1, "Testland");
  country.provinceIds = [7, 12];
  seed.countries.push(country);
  seed.economics.set(1, { version: 1, data: { gdp: 12 } });
  seed.nextCountryId = 2;
  storage.setItem(STATE_KEY, JSON.stringify(serializeState(seed)));

  initWorldStore({ storage, timers: fakeTimers() });

  assert.equal(provinceOverrides.value.get(7)?.name, "Alnwick");
  assert.equal(countries.value.length, 1);
  assert.equal(countryById.value.get(1)?.name, "Testland");
  assert.equal(countryOfProvince.value.get(12), 1);
  assert.deepEqual(economicsOf(1), { version: 1, data: { gdp: 12 } });
  assert.equal(nextCountryId.value, 2);
  assert.equal(stateWarning.value, null);
  assert.equal(statePersistent.value, true);
});

test("init against an empty storage leaves empty signals and no warning", () => {
  initWorldStore({ storage: fakeStorage(), timers: fakeTimers() });

  assert.equal(provinceOverrides.value.size, 0);
  assert.equal(countries.value.length, 0);
  assert.equal(economics.value.size, 0);
  assert.equal(stateWarning.value, null);
  assert.equal(stateBytes.value, 0);
});

test("one edited province writes one key, not 1648", () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  initWorldStore({ storage, timers });

  setProvinceName(7, "Alnwick");
  timers.run();

  assert.equal(provinceOverrides.value.size, 1);
  assert.equal(provinceOverrideOf(8), null);
  const doc = storedDoc(storage);
  assert.deepEqual(Object.keys(doc?.provinceOverrides ?? {}), ["7"]);
});

test("clearing a field removes it, and an emptied override leaves the map", () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  initWorldStore({ storage, timers });

  setProvinceName(7, "Alnwick");
  setProvinceLore(7, "A border keep.");
  setProvinceName(7, "");
  assert.deepEqual(provinceOverrideOf(7), { lore: "A border keep." });

  setProvinceLore(7, "");
  assert.equal(provinceOverrideOf(7), null);
  assert.equal(provinceOverrides.value.size, 0);

  setProvinceImage(7, IMAGE);
  assert.deepEqual(provinceOverrideOf(7), { imageDataUrl: IMAGE });
  clearProvinceOverride(7);
  assert.equal(provinceOverrides.value.size, 0);

  timers.run();
  assert.deepEqual(storedDoc(storage)?.provinceOverrides, {});
});

test("an unchanged value writes no signal and arms no timer", () => {
  const timers = fakeTimers();
  initWorldStore({ storage: fakeStorage(), timers });

  setProvinceName(7, "Alnwick");
  timers.run();
  assert.equal(timers.armed(), 0);

  const before = provinceOverrides.value;
  setProvinceName(7, "Alnwick");
  assert.equal(provinceOverrides.value, before, "the container must not be replaced");
  assert.equal(timers.armed(), 0, "a no-op keystroke must not arm the debounce");

  // A rejected image is a no-op too: the caller already validated it.
  setProvinceImage(7, "http://example.test/flag.png");
  assert.equal(provinceOverrides.value, before);
  assert.equal(timers.armed(), 0);

  // Id 0 is NO_PROVINCE, and NaN is not an id at all.
  setProvinceName(0, "reserved");
  setProvinceName(Number.NaN, "not a number");
  assert.equal(provinceOverrides.value, before);
});

test("three mutations arm one timer and produce one document holding all three", () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  initWorldStore({ storage, timers });

  setProvinceName(7, "Alnwick");
  setProvinceLore(7, "A border keep.");
  const country = addCountry("Testland");

  assert.equal(timers.armed(), 1, "a fixed window arms exactly one timer");
  assert.equal(storedDoc(storage), null, "nothing is written before the window closes");

  timers.run();

  const doc = storedDoc(storage);
  assert.deepEqual(doc?.provinceOverrides["7"], { name: "Alnwick", lore: "A border keep." });
  assert.equal(doc?.countries[0]?.name, "Testland");
  assert.equal(country.id, 1);
});

test("flushState writes immediately without waiting for the timer", () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  initWorldStore({ storage, timers });

  setProvinceName(7, "Alnwick");
  flushState();

  assert.equal(timers.armed(), 0);
  assert.deepEqual(Object.keys(storedDoc(storage)?.provinceOverrides ?? {}), ["7"]);
});

test("a quota failure keeps the in-memory state and clears once a write succeeds", () => {
  let full = true;
  const storage = fakeStorage((key) => {
    if (full && key === STATE_KEY) {
      throw quotaError();
    }
  });
  const timers = fakeTimers();
  initWorldStore({ storage, timers });

  setProvinceName(7, "Alnwick");
  assert.doesNotThrow(() => {
    timers.run();
  });

  assert.equal(stateWarning.value?.kind, "quota");
  assert.equal(provinceOverrideOf(7)?.name, "Alnwick", "the edit survives a failed save");
  assert.equal(statePersistent.value, true, "a later delete may free space, so keep retrying");
  assert.equal(storedDoc(storage), null);

  full = false;
  setProvinceLore(7, "A border keep.");
  timers.run();

  assert.equal(stateWarning.value, null);
  assert.ok(stateBytes.value > 0);
  assert.equal(storedDoc(storage)?.provinceOverrides["7"]?.lore, "A border keep.");
});

test("a flag that will not fit stays on screen, and removing it saves and clears the warning", () => {
  // T09's flag path: `updateCountry` then `flushState()`, so the quota outcome
  // is known at the moment of the upload instead of 400 ms later.
  let full = true;
  const storage = fakeStorage((key) => {
    if (full && key === STATE_KEY) {
      throw quotaError();
    }
  });
  const timers = fakeTimers();
  initWorldStore({ storage, timers });

  const country = addCountry("Testland");
  updateCountry(country.id, { flagDataUrl: IMAGE });
  assert.doesNotThrow(() => {
    flushState();
  });

  assert.equal(stateWarning.value?.kind, "quota");
  assert.equal(
    countryById.value.get(country.id)?.flagDataUrl,
    IMAGE,
    "the upload survives a failed save, so the panel can still offer to remove it",
  );
  assert.equal(statePersistent.value, true);
  assert.equal(storedDoc(storage), null);

  // Removing the flag IS the recovery action, so it flushes too and the warning
  // has to clear at that moment.
  full = false;
  updateCountry(country.id, { flagDataUrl: null });
  flushState();

  assert.equal(stateWarning.value, null);
  assert.equal(countryById.value.get(country.id)?.flagDataUrl, null);
  assert.equal(storedDoc(storage)?.countries[0]?.flagDataUrl, null);
});

test("country ids keep counting up across a reload", () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  initWorldStore({ storage, timers });

  assert.equal(addCountry().id, 1);
  assert.equal(addCountry().id, 2);
  assert.equal(addCountry("Third").id, 3);
  timers.run();

  initWorldStore({ storage, timers: fakeTimers() });
  assert.equal(countries.value.length, 3);
  assert.equal(addCountry().id, 4, "a reused id would merge two countries' provinces");
});

test("assigning a province takes it from its previous owner in the same call", () => {
  initWorldStore({ storage: fakeStorage(), timers: fakeTimers() });
  const first = addCountry("First");
  const second = addCountry("Second");

  assignProvinces(first.id, [7, 12, 3]);
  assert.deepEqual(countryById.value.get(first.id)?.provinceIds, [3, 7, 12]);

  assignProvinces(second.id, [12]);
  assert.deepEqual(countryById.value.get(first.id)?.provinceIds, [3, 7]);
  assert.deepEqual(countryById.value.get(second.id)?.provinceIds, [12]);
  assert.equal(countryOfProvince.value.get(12), second.id);
});

test("assigning to null unassigns, and countryOfProvince loses the key", () => {
  initWorldStore({ storage: fakeStorage(), timers: fakeTimers() });
  const country = addCountry("First");
  assignProvinces(country.id, [7, 12]);

  assignProvinces(null, [7]);

  assert.deepEqual(countryById.value.get(country.id)?.provinceIds, [12]);
  assert.equal(countryOfProvince.value.has(7), false);
});

test("deleting a country drops its economics and claims but keeps province lore", () => {
  initWorldStore({ storage: fakeStorage(), timers: fakeTimers() });
  const country = addCountry("Doomed");
  assignProvinces(country.id, [7]);
  setCountryEconomics(country.id, { gdp: 12 });
  setProvinceLore(7, "A border keep.");

  deleteCountry(country.id);

  assert.equal(countries.value.length, 0);
  assert.equal(economicsOf(country.id), null);
  assert.equal(countryOfProvince.value.size, 0);
  assert.equal(provinceOverrideOf(7)?.lore, "A border keep.");
});

test("buildCountryAssignment matches the Uint16Array the border worker takes", () => {
  initWorldStore({ storage: fakeStorage(), timers: fakeTimers() });
  const first = addCountry("First");
  const second = addCountry("Second");
  assignProvinces(first.id, [7, 1650]);
  assignProvinces(second.id, [12]);

  const assignment = buildCountryAssignment(1650);

  assert.ok(assignment instanceof Uint16Array);
  assert.equal(assignment.length, 1651);
  assert.equal(assignment[0], 0, "index 0 is NO_PROVINCE, never a country");
  assert.equal(assignment[7], first.id);
  assert.equal(assignment[1650], first.id);
  assert.equal(assignment[12], second.id);
  // Ids 1318 and 1458 do not exist in the manifest and stay at 0.
  assert.equal(assignment[1318], 0);
  assert.equal(assignment[1458], 0);
});

test("economics merges, refuses an unknown country and drops unserialisable values", () => {
  initWorldStore({ storage: fakeStorage(), timers: fakeTimers() });
  const country = addCountry("First");

  setCountryEconomics(country.id, { gdp: 100, inflation: 3 });
  patchCountryEconomics(country.id, { inflation: 4, debt: Number.NaN, sectors: ["farming"] });

  assert.deepEqual(economicsOf(country.id), {
    version: 1,
    data: { gdp: 100, inflation: 4, sectors: ["farming"] },
  });

  patchCountryEconomics(99, { gdp: 1 });
  assert.equal(economicsOf(99), null);
});

test("a future-version document puts the store in read-only mode", () => {
  const storage = fakeStorage();
  const payload = "{\"version\":99,\"countries\":[{\"id\":1,\"name\":\"future\"}]}";
  storage.setItem(STATE_KEY, payload);
  const timers = fakeTimers();

  initWorldStore({ storage, timers });

  assert.equal(stateWarning.value?.kind, "future");
  assert.equal(statePersistent.value, false);

  setProvinceName(7, "Alnwick");
  addCountry("Testland");
  flushState();
  timers.run();

  assert.equal(provinceOverrideOf(7)?.name, "Alnwick", "the session still works in memory");
  assert.equal(storage.getItem(STATE_KEY), payload, "the newer document must be byte-identical");
});

test("updateCountry validates its patch and provinceDisplayName layers the name", () => {
  initWorldStore({ storage: fakeStorage(), timers: fakeTimers() });
  const country = addCountry("Testland");

  updateCountry(country.id, { slogan: "Ever onward", colorHex: "#123456", flagDataUrl: IMAGE });
  assert.equal(countryById.value.get(country.id)?.slogan, "Ever onward");
  assert.equal(countryById.value.get(country.id)?.colorHex, "#123456");
  assert.equal(countryById.value.get(country.id)?.flagDataUrl, IMAGE);

  // A half-typed colour is ignored, not written as a broken value.
  updateCountry(country.id, { colorHex: "#ab" });
  assert.equal(countryById.value.get(country.id)?.colorHex, "#123456");
  // A remote flag URL never enters the document.
  updateCountry(country.id, { flagDataUrl: "http://example.test/flag.png" });
  assert.equal(countryById.value.get(country.id)?.flagDataUrl, IMAGE);
  // An unknown id is ignored.
  updateCountry(99, { name: "ghost" });
  assert.equal(countries.value.length, 1);

  // No map is loaded in Node, so `provinceById` returns null and the last
  // fallback is what answers.
  assert.equal(provinceDisplayName(7), "Province 7");
  setProvinceName(7, "Alnwick");
  assert.equal(provinceDisplayName(7), "Alnwick");
});

test("updateCountry leaves provinceIds at the SAME array, not a copy", () => {
  // `label-store.ts` validates its anchor cache on this array's IDENTITY. A
  // defensive copy here made every keystroke in a country name re-run
  // `resolveLabelAnchor`, up to 1728 `contains` probes. `assignProvinces` is the
  // only writer and always builds a fresh array, so the copy defended nothing.
  initWorldStore({ storage: fakeStorage(), timers: fakeTimers() });
  const country = addCountry("Testland");
  assignProvinces(country.id, [3, 4, 5]);

  const before = countryById.value.get(country.id)?.provinceIds;
  updateCountry(country.id, { name: "Renamed" });
  const after = countryById.value.get(country.id)?.provinceIds;

  assert.equal(after, before, "a rename must not invalidate the label anchor cache");
});

test("every editable field keeps provinceIds at the same array", () => {
  // T08's panel commits name, slogan, lore and the flag one keystroke at a
  // time, so the identity has to hold on every branch of `updateCountry`, not
  // just the one the test above happens to take.
  initWorldStore({ storage: fakeStorage(), timers: fakeTimers() });
  const country = addCountry("Testland");
  assignProvinces(country.id, [3, 4, 5]);
  const before = countryById.value.get(country.id)?.provinceIds;

  updateCountry(country.id, { slogan: "Ever onward" });
  updateCountry(country.id, { lore: "Founded in the long winter." });
  updateCountry(country.id, { flagDataUrl: IMAGE });
  updateCountry(country.id, { colorHex: "#123456" });

  const after = countryById.value.get(country.id)?.provinceIds;
  assert.equal(after, before);
  assert.deepEqual(after, [3, 4, 5], "and the contents are untouched");
});

test("a patch that changes nothing does not replace the countries array", () => {
  // Committing a field the user did not actually change must not invalidate
  // `countryById`, `countryOfProvince`, `countryTintWords`, `countryAggregates`
  // and the label layout for nothing. The 200 ms field debounce assumes it.
  initWorldStore({ storage: fakeStorage(), timers: fakeTimers() });
  const country = addCountry("Testland");
  const before = countries.value;

  updateCountry(country.id, { name: "Testland" });
  assert.equal(countries.value, before, "the same name is a no-op");

  updateCountry(country.id, { colorHex: "#nothex" });
  assert.equal(countries.value, before, "and so is a patch that fails validation");

  updateCountry(country.id, { name: "Changed" });
  assert.notEqual(countries.value, before, "a real change still lands");
});

test("an over-cap flag is dropped without a word, and the store read-back is what catches it", () => {
  // T09 DESIGN 8.3. `updateCountry` returns nothing and raises no warning when a
  // data URL fails `isImageDataUrl`, so the panel compares what it committed
  // against what the store now holds. This is that comparison, at the store.
  const timers = fakeTimers();
  initWorldStore({ storage: fakeStorage(), timers });
  const country = addCountry("Testland");
  updateCountry(country.id, { flagDataUrl: IMAGE });
  timers.run();

  const head = "data:image/webp;base64,";
  const overCap = head + "A".repeat(IMAGE_DATA_URL_MAX - head.length + 1);
  assert.equal(overCap.length, IMAGE_DATA_URL_MAX + 1);

  updateCountry(country.id, { flagDataUrl: overCap });

  // The exact expression `CountryOverviewPanel.onFlag` runs after every commit.
  const stored = countryById.peek().get(country.id)?.flagDataUrl ?? null;
  assert.equal(stored, IMAGE, "the previous flag is untouched");
  assert.equal(stored !== overCap, true, "so the panel knows the upload never landed");
  assert.equal(timers.armed(), 0, "and a refused patch schedules no write");

  // A legal URL reads back equal, so the same check does not cry wolf.
  const other = "data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAAfQ//73v/+BiOh/AAB=";
  updateCountry(country.id, { flagDataUrl: other });
  assert.equal(countryById.peek().get(country.id)?.flagDataUrl, other);
});

test("an emptied country name is kept as empty on disk and reads back as the fallback", () => {
  // T09 DESIGN 8.10. The store deliberately keeps "" — rewriting it into the
  // document would be a silent edit of the user's data — and every surface shows
  // `countryDisplayName` instead. The test that matters is that a reload agrees
  // with what the panel, the plaque and the map label were already showing.
  const storage = fakeStorage();
  const timers = fakeTimers();
  initWorldStore({ storage, timers });
  const country = addCountry("Testland");

  updateCountry(country.id, { name: "" });
  timers.run();

  assert.equal(countryById.value.get(country.id)?.name, "");
  assert.equal(storedDoc(storage)?.countries[0]?.name, "");

  initWorldStore({ storage, timers });
  assert.equal(countryById.value.get(country.id)?.name, "Country 1");
  assert.equal(countryById.value.get(country.id)?.name, countryDisplayName(country.id, ""));

  // A name of pure whitespace is stored verbatim for the same reason, and it
  // still displays as the fallback.
  updateCountry(country.id, { name: "   " });
  timers.run();
  initWorldStore({ storage, timers });

  assert.equal(countryById.value.get(country.id)?.name, "   ", "no silent edit on reload");
  assert.equal(countryDisplayName(country.id, "   "), "Country 1");
});
