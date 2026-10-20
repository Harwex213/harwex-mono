import assert from "node:assert/strict";
import test from "node:test";
import {
  STATE_KEY,
  STORAGE_BUDGET_BYTES,
  createMemoryStorage,
  type StateStorage,
} from "../../datasource/index";
import { IMAGE_DATA_URL_MAX, LORE_MAX, MAX_COUNTRY_ID, NAME_MAX } from "../../domain/world/schema";
import {
  buildCountryOf,
  type Migration,
  type ProvinceOverride,
} from "../../domain/index";
import {
  createTestApp,
  fakeTimers,
  type FakeTimers,
  type TestApp,
} from "../../test-support";
import type { TStore } from "../../store/index";

type BootOptions = { storage?: StateStorage; timers?: FakeTimers; chain?: readonly Migration[] };

// Each test builds its own app, so no state leaks between tests.
function boot(options: BootOptions): TestApp {
  const app = createTestApp({ storage: options.storage, timers: options.timers });
  app.registry.hydrateWorld({ chain: options.chain });
  return app;
}

function provinceOverrideOf(store: TStore, id: number): ProvinceOverride | null {
  return store.world.provinceOverrides.value.get(id) ?? null;
}

// Lifecycle edges: before hydration, no localStorage, re-hydration over a
// pending write, and the two capacity limits.

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

// A data URL at the cap, so four of them exceed the storage budget.
function hugeImage(): string {
  const head = "data:image/webp;base64,";
  return head + "A".repeat(IMAGE_DATA_URL_MAX - head.length);
}

test("a mutation before initWorldStore is kept in memory and writes nothing", () => {
  // An early panel effect must not crash or overwrite the stored document.
  const storage = fakeStorage();
  const { store, registry, timers } = createTestApp({ storage });

  assert.doesNotThrow(() => {
    registry.setProvinceName(7, "Alnwick");
    registry.addCountry("Early");
    registry.assignProvinces(1, [7]);
  });

  assert.equal(provinceOverrideOf(store, 7)?.name, "Alnwick");
  assert.equal(store.world.countries.value.length, 1);
  assert.equal(buildCountryOf(store.world.countryOfProvince.value, 10)[7], 1);

  // Nothing is scheduled before hydration, so a flush writes nothing.
  assert.equal(timers.armed(), 0);
  assert.doesNotThrow(() => {
    registry.flushWorld();
  });
  timers.run();
  assert.equal(storage.getItem(STATE_KEY), null);
});

test("a boot with no localStorage runs in memory and says so", () => {
  const timers = fakeTimers();

  // Node has no localStorage: the same branch as Safari with cookies blocked.
  const { store, registry } = boot({ timers });

  assert.equal(store.world.warning.value?.kind, "unavailable");
  assert.equal(store.world.persistent.value, false);
  assert.equal(store.world.provinceOverrides.value.size, 0, "the previous session's edits are gone");

  registry.setProvinceName(7, "Alnwick");
  assert.equal(provinceOverrideOf(store, 7)?.name, "Alnwick", "the session still works");
  assert.equal(timers.armed(), 0, "an unwritable store must not arm the debounce");

  assert.doesNotThrow(() => {
    registry.flushWorld();
  });
});

test("a re-init cancels the previous document's pending write", () => {
  // A second `hydrateWorld` on the same app. The pending write holds discarded state.
  const storage = fakeStorage();
  const timers = fakeTimers();
  const { store, registry } = boot({ storage, timers });

  registry.setProvinceName(7, "Alnwick");
  assert.equal(timers.armed(), 1);

  registry.hydrateWorld();
  timers.run();

  assert.equal(storage.getItem(STATE_KEY), null, "the cancelled write must not land");
  assert.equal(
    store.world.provinceOverrides.value.size,
    0,
    "the stored document is what the signals hold",
  );
});

test("crossing the storage budget warns, and a later small write clears it", () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  const { store, registry } = boot({ storage, timers });

  const image = hugeImage();
  for (const id of [1, 2, 3, 4]) {
    registry.setProvinceImage(id, image);
  }
  timers.run();

  assert.ok(
    store.world.bytes.value > STORAGE_BUDGET_BYTES,
    "four capped images must exceed the 4 MB budget",
  );
  assert.equal(store.world.warning.value?.kind, "budget");
  assert.match(store.world.warning.value?.message ?? "", /close to the browser limit/);
  // Nothing is auto-deleted: the store warns and the user decides.
  assert.equal(store.world.provinceOverrides.value.size, 4);

  for (const id of [1, 2, 3, 4]) {
    registry.setProvinceImage(id, null);
  }
  timers.run();

  assert.equal(store.world.warning.value, null, "a write back under the budget clears the warning");
  assert.ok(store.world.bytes.value < 1000);
});

test("the country limit warns and hands back the last country instead of crashing", () => {
  const storage = fakeStorage();
  storage.setItem(
    STATE_KEY,
    JSON.stringify({
      version: 1,
      provinceOverrides: {},
      countries: [{ id: MAX_COUNTRY_ID, name: "Last" }],
      nextCountryId: MAX_COUNTRY_ID + 1,
    }),
  );
  const { store, registry } = boot({ storage, timers: fakeTimers() });

  assert.equal(store.world.nextCountryId.value, MAX_COUNTRY_ID + 1);

  // A country id indexes a Uint16Array, so 65535 is a hard ceiling.
  const overflow = registry.addCountry("Overflow");

  assert.equal(overflow.id, MAX_COUNTRY_ID);
  assert.equal(overflow.name, "Last");
  assert.equal(store.world.countries.value.length, 1, "the list must not grow past the ceiling");
  assert.equal(store.world.warning.value?.kind, "quota");
  assert.match(store.world.warning.value?.message ?? "", /country limit of 65535/);
});

test("an assignment that changes nothing arms no timer, and an unknown owner unassigns", () => {
  const timers = fakeTimers();
  const { store, registry } = boot({ storage: fakeStorage(), timers });
  const country = registry.addCountry("First");
  timers.run();

  registry.assignProvinces(country.id, []);
  registry.assignProvinces(country.id, [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]);
  assert.equal(timers.armed(), 0, "an empty or all-invalid list is not a mutation");

  registry.assignProvinces(country.id, [7, 12]);
  timers.run();
  registry.assignProvinces(country.id, [12, 7]);
  assert.equal(timers.armed(), 0, "the same set in a different order is not a mutation");

  // An unknown id still strips the province from its owner.
  registry.assignProvinces(MAX_COUNTRY_ID, [7]);

  assert.deepEqual(store.world.countryById.value.get(country.id)?.provinceIds, [12]);
  assert.equal(store.world.countryOfProvince.value.has(7), false);
});

test("deleting or clearing something that is not there writes nothing", () => {
  const timers = fakeTimers();
  const { store, registry } = boot({ storage: fakeStorage(), timers });
  const country = registry.addCountry("First");
  timers.run();

  registry.deleteCountry(country.id + 99);
  registry.clearProvinceOverride(7);
  registry.setProvinceImage(7, "http://example.test/flag.png");

  assert.equal(timers.armed(), 0);
  assert.equal(store.world.countries.value.length, 1);
  assert.equal(store.world.provinceOverrides.value.size, 0);
});

test("updateCountry clamps its text and skips a patch that changes nothing", () => {
  const timers = fakeTimers();
  const { store, registry } = boot({ storage: fakeStorage(), timers });
  const country = registry.addCountry("Testland");
  timers.run();

  registry.updateCountry(country.id, {
    name: "n".repeat(NAME_MAX + 40),
    lore: "l".repeat(LORE_MAX + 40),
  });
  assert.equal(store.world.countryById.value.get(country.id)?.name.length, NAME_MAX);
  assert.equal(store.world.countryById.value.get(country.id)?.lore.length, LORE_MAX);
  timers.run();

  // Text equal after clamping schedules no write.
  registry.updateCountry(country.id, { name: "n".repeat(NAME_MAX) });
  registry.updateCountry(country.id, {});
  assert.equal(timers.armed(), 0);

  registry.updateCountry(country.id, { flagDataUrl: IMAGE });
  assert.equal(store.world.countryById.value.get(country.id)?.flagDataUrl, IMAGE);
  timers.run();

  registry.updateCountry(country.id, { flagDataUrl: null });
  assert.equal(store.world.countryById.value.get(country.id)?.flagDataUrl, null, "a flag can be removed");
  assert.equal(timers.armed(), 1);
});
