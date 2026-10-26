import assert from "node:assert/strict";
import test from "node:test";
import {
  country,
  createTestApp,
  fakeMapAssets,
  fakeTimers,
  markMapReady,
  setCountries,
  type FakeBorders,
  type FakeTimers,
  type TestApp,
} from "../../test-support";
import type { Province } from "../../domain/index";

// The border queue has its own fake timers, so the counts never include a debounced save.

type BorderTestApp = TestApp & { borderTimers: FakeTimers; borders: FakeBorders };

function setup(): BorderTestApp {
  const app = createTestApp();
  const borderTimers = fakeTimers();
  // A second test app builds the border queue on its own timers.
  app.sources.borderQueue = createTestApp({ timers: borderTimers }).sources.borderQueue;
  return { ...app, borderTimers, borders: app.sources.borders as FakeBorders };
}

function province(id: number): Province {
  return {
    id,
    name: "Province " + id,
    kind: "land",
    hex: "#000000",
    rgb: [0, 0, 0],
    pixelCount: 1,
    bounds: { x: id, y: 0, width: 1, height: 1 },
    centroid: { x: id, y: 0 },
  } as Province;
}

test("with no map loaded, nothing reads the manifest eagerly", () => {
  // `maxProvinceId` must read the loaded assets, not a missing manifest.
  const app = setup();
  setCountries(app.store, [country(1, [])]);

  assert.equal(app.store.map.maxProvinceId.value, 0);
});

test("countryAggregates is a cache that invalidates when the countries change", () => {
  const { store } = setup();
  setCountries(store, [country(1, [])]);

  const before = store.labels.aggregates.value;
  assert.equal(store.labels.aggregates.value, before, "no change, no recompute");

  setCountries(store, [country(1, [1, 2, 3])]);
  const after = store.labels.aggregates.value;
  assert.notEqual(after, before, "the new countries invalidated it");
  assert.equal(after.get(1)?.provinceCount, 3);
  // No manifest, so the derived geometry is empty rather than wrong.
  assert.equal(after.get(1)?.resolvedCount, 0);
  assert.equal(after.get(1)?.bounds, null);
});

test("five rapid country changes arm exactly ONE border-push timer", () => {
  // Counts `set` calls: `pending()` cannot tell a fixed window from a restarting one.
  const { store, registry, borderTimers } = setup();

  const stop = registry.startCountryBorderSync();
  // Drain the timer armed at registration, so only the five changes are counted.
  borderTimers.run();
  const baseline = borderTimers.sets;

  for (const id of [10, 11, 12, 13, 14]) {
    setCountries(store, [country(1, [id])]);
  }

  assert.equal(borderTimers.sets - baseline, 1, "one fixed window, not one timer per change");
  assert.equal(borderTimers.armed(), 1);
  stop();
});

test("the push reaches the worker with each province mapped to its country", () => {
  const { store, registry, borderTimers, borders } = setup();
  markMapReady(store, fakeMapAssets({ width: 4, height: 1, provinces: [province(1), province(2)] }));

  const stop = registry.startCountryBorderSync();
  borderTimers.run();
  const pushedBefore = borders.pushed.length;
  setCountries(store, [country(3, [1])]);
  assert.equal(borderTimers.armed(), 1, "a push is waiting");

  borderTimers.run();
  assert.equal(borders.pushed.length, pushedBefore + 1, "the push reached the worker");
  const pushed = borders.pushed[borders.pushed.length - 1];
  assert.equal(pushed?.[1], 3, "province 1 is pushed as country 3's");

  stop();
});

test("a push is skipped while no map is loaded", () => {
  const { store, registry, borderTimers, borders } = setup();

  const stop = registry.startCountryBorderSync();
  setCountries(store, [country(1, [1])]);
  borderTimers.run();

  assert.equal(borders.pushed.length, 0, "no province ids exist to index the countries by");
  stop();
});

test("stopping the sync stops the effect, so a later change arms nothing", () => {
  const { store, registry, borderTimers } = setup();

  const stop = registry.startCountryBorderSync();
  borderTimers.run();
  stop();
  const baseline = borderTimers.sets;

  setCountries(store, [country(1, [1, 2])]);
  assert.equal(borderTimers.sets, baseline, "nothing is scheduled after disposal");
});

test("maxProvinceId stays 0 when the phase says ready but no assets arrived", () => {
  // Trusting the phase alone would throw inside the signal graph.
  const { store } = setup();
  store.map.phase.value = "ready";

  assert.equal(store.map.maxProvinceId.value, 0);
});

test("countryAggregates is empty with no countries and has one entry per country", () => {
  const { store } = setup();
  assert.equal(store.labels.aggregates.value.size, 0);

  setCountries(store, [country(1, [1, 2]), country(2, [])]);
  assert.equal(store.labels.aggregates.value.size, 2);
  assert.equal(store.labels.aggregates.value.get(2)?.provinceCount, 0);
});

test("the border scan completing re-arms the push", () => {
  // A push during the scan is dropped. Without `borders.phase` in the effect,
  // a loaded country never gets its border.
  const { store, registry, borderTimers } = setup();

  const stop = registry.startCountryBorderSync();
  borderTimers.run();
  setCountries(store, [country(1, [1, 2, 3])]);
  borderTimers.run();
  const baseline = borderTimers.sets;

  store.borders.phase.value = "scanning";
  store.borders.phase.value = "ready";

  assert.ok(borderTimers.sets > baseline, "the scan finishing schedules a fresh push");
  assert.equal(borderTimers.armed(), 1);

  stop();
});

test("disposeBorders clears every border field in the store", () => {
  const { store, registry, borders } = setup();
  store.borders.phase.value = "ready";

  registry.disposeBorders();

  assert.equal(store.borders.phase.value, "idle");
  assert.equal(store.borders.provinceTiles.value, null);
  assert.equal(store.borders.countryTiles.value, null);
  assert.equal(borders.started(), false, "the worker is gone");
});
