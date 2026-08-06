import assert from "node:assert/strict";
import test from "node:test";
import { STATE_KEY, STORAGE_BUDGET_BYTES, createMemoryStorage } from "./persistence";
import { IMAGE_DATA_URL_MAX, LORE_MAX, MAX_COUNTRY_ID, NAME_MAX } from "./schema";
import {
  addCountry,
  assignProvinces,
  buildCountryAssignment,
  clearProvinceOverride,
  countries,
  countryById,
  countryOfProvince,
  deleteCountry,
  economicsOf,
  flushState,
  initWorldStore,
  installStateFlush,
  nextCountryId,
  patchCountryEconomics,
  provinceOverrideOf,
  provinceOverrides,
  setCountryEconomics,
  setProvinceImage,
  setProvinceName,
  stateBytes,
  statePersistent,
  stateWarning,
  updateCountry,
} from "./world-store";
import type { StateStorage, TimerHandle, Timers } from "./persistence";

// The store's lifecycle edges, which need a module that has never been
// initialised: the window before `initWorldStore` runs, the no-localStorage
// boot, a re-init over a pending write, and the two capacity limits.
//
// The FIRST test must stay first. It is the only chance this process gets to
// observe an uninitialised store.

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

// A data URL of exactly the cap, so four of them push the document past the
// storage budget.
function hugeImage(): string {
  const head = "data:image/webp;base64,";
  return head + "A".repeat(IMAGE_DATA_URL_MAX - head.length);
}

test("a mutation before initWorldStore is kept in memory and writes nothing", () => {
  // A panel that mounts before `App`'s effect runs must not crash and must not
  // reach a storage the store has not been given yet.
  assert.doesNotThrow(() => {
    setProvinceName(7, "Alnwick");
    addCountry("Early");
    assignProvinces(1, [7]);
  });

  assert.equal(provinceOverrideOf(7)?.name, "Alnwick");
  assert.equal(countries.value.length, 1);
  assert.equal(buildCountryAssignment(10)[7], 1);

  // No writer exists yet, so a flush is a no-op rather than a null dereference.
  assert.doesNotThrow(() => {
    flushState();
  });

  // Outside a browser there is nothing to listen on, and the uninstall must
  // still be callable from a `useEffect` cleanup.
  const uninstall = installStateFlush();
  assert.equal(typeof uninstall, "function");
  assert.doesNotThrow(() => {
    uninstall();
  });
});

test("a boot with no localStorage runs in memory and says so", () => {
  const timers = fakeTimers();

  // No storage injected: `defaultStorage` finds no localStorage in Node, which
  // is the same branch Safari takes with cookies blocked.
  initWorldStore({ timers });

  assert.equal(stateWarning.value?.kind, "unavailable");
  assert.equal(statePersistent.value, false);
  assert.equal(provinceOverrides.value.size, 0, "the previous session's edits are gone");

  setProvinceName(7, "Alnwick");
  assert.equal(provinceOverrideOf(7)?.name, "Alnwick", "the session still works");
  assert.equal(timers.armed(), 0, "an unwritable store must not arm the debounce");

  assert.doesNotThrow(() => {
    flushState();
  });
});

test("a re-init cancels the previous document's pending write", () => {
  const first = fakeStorage();
  const firstTimers = fakeTimers();
  initWorldStore({ storage: first, timers: firstTimers });

  setProvinceName(7, "Alnwick");
  assert.equal(firstTimers.armed(), 1);

  const second = fakeStorage();
  initWorldStore({ storage: second, timers: fakeTimers() });
  firstTimers.run();

  assert.equal(first.getItem(STATE_KEY), null, "the cancelled write must not land");
  assert.equal(second.getItem(STATE_KEY), null, "and must not land in the new storage either");
  assert.equal(provinceOverrides.value.size, 0, "the new storage is what the signals hold");
});

test("crossing the storage budget warns, and a later small write clears it", () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  initWorldStore({ storage, timers });

  const image = hugeImage();
  for (const id of [1, 2, 3, 4]) {
    setProvinceImage(id, image);
  }
  timers.run();

  assert.ok(
    stateBytes.value > STORAGE_BUDGET_BYTES,
    "four capped images must exceed the 4 MB budget",
  );
  assert.equal(stateWarning.value?.kind, "budget");
  assert.match(stateWarning.value?.message ?? "", /close to the browser limit/);
  // Nothing is auto-deleted: the store warns and the user decides.
  assert.equal(provinceOverrides.value.size, 4);

  for (const id of [1, 2, 3, 4]) {
    setProvinceImage(id, null);
  }
  timers.run();

  assert.equal(stateWarning.value, null, "a write back under the budget clears the warning");
  assert.ok(stateBytes.value < 1000);
});

test("the country limit warns and hands back the last country instead of crashing", () => {
  const storage = fakeStorage();
  storage.setItem(
    STATE_KEY,
    JSON.stringify({
      version: 1,
      provinceOverrides: {},
      countries: [{ id: MAX_COUNTRY_ID, name: "Last" }],
      economics: {},
      nextCountryId: MAX_COUNTRY_ID + 1,
    }),
  );
  initWorldStore({ storage, timers: fakeTimers() });

  assert.equal(nextCountryId.value, MAX_COUNTRY_ID + 1);

  // A country id indexes a Uint16Array, so 65535 is a hard ceiling. Reaching it
  // is not worth a crash.
  const overflow = addCountry("Overflow");

  assert.equal(overflow.id, MAX_COUNTRY_ID);
  assert.equal(overflow.name, "Last");
  assert.equal(countries.value.length, 1, "the list must not grow past the ceiling");
  assert.equal(stateWarning.value?.kind, "quota");
  assert.match(stateWarning.value?.message ?? "", /country limit of 65535/);
});

test("an assignment that changes nothing arms no timer, and an unknown owner unassigns", () => {
  const timers = fakeTimers();
  initWorldStore({ storage: fakeStorage(), timers });
  const country = addCountry("First");
  timers.run();

  assignProvinces(country.id, []);
  assignProvinces(country.id, [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]);
  assert.equal(timers.armed(), 0, "an empty or all-invalid list is not a mutation");

  assignProvinces(country.id, [7, 12]);
  timers.run();
  assignProvinces(country.id, [12, 7]);
  assert.equal(timers.armed(), 0, "the same set in a different order is not a mutation");

  // An id that names no country still strips the province from its owner, so
  // the one-owner invariant never leaves a province in two places.
  assignProvinces(MAX_COUNTRY_ID, [7]);

  assert.deepEqual(countryById.value.get(country.id)?.provinceIds, [12]);
  assert.equal(countryOfProvince.value.has(7), false);
});

test("deleting or clearing something that is not there writes nothing", () => {
  const timers = fakeTimers();
  initWorldStore({ storage: fakeStorage(), timers });
  const country = addCountry("First");
  timers.run();

  deleteCountry(country.id + 99);
  clearProvinceOverride(7);
  setProvinceImage(7, "http://example.test/flag.png");

  assert.equal(timers.armed(), 0);
  assert.equal(countries.value.length, 1);
  assert.equal(provinceOverrides.value.size, 0);
});

test("an economics slot keeps its own version across a rewrite", () => {
  const storage = fakeStorage();
  storage.setItem(
    STATE_KEY,
    JSON.stringify({
      version: 1,
      provinceOverrides: {},
      countries: [{ id: 1, name: "Testland" }],
      economics: { "1": { version: 3, data: { gdp: 1 } } },
      nextCountryId: 2,
    }),
  );
  initWorldStore({ storage, timers: fakeTimers() });

  assert.equal(economicsOf(1)?.version, 3);

  // The slot version is T11's data version. Rewriting the data must not reset
  // it to 1, or a future economics migration would run twice or not at all.
  setCountryEconomics(1, { gdp: 2 });
  assert.deepEqual(economicsOf(1), { version: 3, data: { gdp: 2 } });

  patchCountryEconomics(1, { inflation: 4 });
  assert.deepEqual(economicsOf(1), { version: 3, data: { gdp: 2, inflation: 4 } });

  setCountryEconomics(99, { gdp: 1 });
  assert.equal(economicsOf(99), null, "an orphan slot is refused at the door");
});

test("updateCountry clamps its text and skips a patch that changes nothing", () => {
  const timers = fakeTimers();
  initWorldStore({ storage: fakeStorage(), timers });
  const country = addCountry("Testland");
  timers.run();

  updateCountry(country.id, {
    name: "n".repeat(NAME_MAX + 40),
    lore: "l".repeat(LORE_MAX + 40),
  });
  assert.equal(countryById.value.get(country.id)?.name.length, NAME_MAX);
  assert.equal(countryById.value.get(country.id)?.lore.length, LORE_MAX);
  timers.run();

  // The same text after clamping is the same value, so no write is scheduled.
  updateCountry(country.id, { name: "n".repeat(NAME_MAX) });
  updateCountry(country.id, {});
  assert.equal(timers.armed(), 0);

  updateCountry(country.id, { flagDataUrl: IMAGE });
  assert.equal(countryById.value.get(country.id)?.flagDataUrl, IMAGE);
  timers.run();

  updateCountry(country.id, { flagDataUrl: null });
  assert.equal(countryById.value.get(country.id)?.flagDataUrl, null, "a flag can be removed");
  assert.equal(timers.armed(), 1);
});
