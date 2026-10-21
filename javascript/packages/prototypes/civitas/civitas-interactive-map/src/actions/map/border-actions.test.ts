import assert from "node:assert/strict";
import test from "node:test";
import {
  createTestApp,
  fakeMapAssets,
  fakeTimers,
  markMapReady,
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
  app.registry.addCountry("A");

  assert.equal(app.store.map.maxProvinceId.value, 0);
});

test("countryAggregates is a cache that invalidates on assignment change", () => {
  const { store, registry } = setup();
  const a = registry.addCountry("A");

  const before = store.labels.aggregates.value;
  assert.equal(store.labels.aggregates.value, before, "no change, no recompute");

  registry.assignProvinces(a.id, [1, 2, 3]);
  const after = store.labels.aggregates.value;
  assert.notEqual(after, before, "the assignment invalidated it");
  assert.equal(after.get(a.id)?.provinceCount, 3);
  // No manifest, so the derived geometry is empty rather than wrong.
  assert.equal(after.get(a.id)?.resolvedCount, 0);
  assert.equal(after.get(a.id)?.bounds, null);
});

test("countryAggregates survives a rename without recomputing the geometry wrongly", () => {
  const { store, registry } = setup();
  const a = registry.addCountry("A");
  registry.assignProvinces(a.id, [4]);

  registry.updateCountry(a.id, { name: "Renamed" });
  assert.equal(store.labels.aggregates.value.get(a.id)?.provinceCount, 1);
});

test("five rapid assignment changes arm exactly ONE border-push timer", () => {
  // Counts `set` calls: `pending()` cannot tell a fixed window from a restarting one.
  const { registry, borderTimers } = setup();
  const a = registry.addCountry("A");

  const stop = registry.startCountryBorderSync();
  // Drain the timer armed at registration, so only the five changes are counted.
  borderTimers.run();
  const baseline = borderTimers.sets;

  for (const id of [10, 11, 12, 13, 14]) {
    registry.assignProvinces(a.id, [id]);
  }

  assert.equal(borderTimers.sets - baseline, 1, "one fixed window, not one timer per change");
  assert.equal(borderTimers.armed(), 1);
  stop();
});

test("flushCountryBorders fires the pending push and disarms the timer", () => {
  const { store, registry, borderTimers, borders } = setup();
  markMapReady(store, fakeMapAssets({ width: 4, height: 1, provinces: [province(1), province(2)] }));
  const a = registry.addCountry("A");

  const stop = registry.startCountryBorderSync();
  borderTimers.run();
  const pushedBefore = borders.pushed.length;
  registry.assignProvinces(a.id, [1]);
  assert.equal(borderTimers.armed(), 1, "a push is waiting");

  registry.flushCountryBorders();
  assert.equal(borderTimers.armed(), 0, "the window is closed, not left to expire");
  assert.equal(borders.pushed.length, pushedBefore + 1, "the push reached the worker");
  const pushed = borders.pushed[borders.pushed.length - 1];
  assert.equal(pushed?.[1], a.id, "province 1 is pushed as A's");

  stop();
});

test("a push is skipped while no map is loaded", () => {
  const { registry, borderTimers, borders } = setup();
  const a = registry.addCountry("A");

  const stop = registry.startCountryBorderSync();
  registry.assignProvinces(a.id, [1]);
  borderTimers.run();

  assert.equal(borders.pushed.length, 0, "no province ids exist to index the assignment by");
  stop();
});

test("stopping the sync stops the effect, so a later change arms nothing", () => {
  const { registry, borderTimers } = setup();
  const a = registry.addCountry("A");

  const stop = registry.startCountryBorderSync();
  borderTimers.run();
  stop();
  const baseline = borderTimers.sets;

  registry.assignProvinces(a.id, [1, 2]);
  assert.equal(borderTimers.sets, baseline, "nothing is scheduled after disposal");
});

test("maxProvinceId stays 0 when the phase says ready but no assets arrived", () => {
  // Trusting the phase alone would throw inside the signal graph.
  const { store } = setup();
  store.map.phase.value = "ready";

  assert.equal(store.map.maxProvinceId.value, 0);
});

test("countryAggregates is empty with no countries and drops a deleted one", () => {
  const { store, registry } = setup();
  assert.equal(store.labels.aggregates.value.size, 0);

  const a = registry.addCountry("A");
  const b = registry.addCountry("B");
  registry.assignProvinces(a.id, [1, 2]);
  assert.equal(store.labels.aggregates.value.size, 2);

  registry.deleteCountry(a.id);
  assert.equal(store.labels.aggregates.value.has(a.id), false, "no aggregate outlives its country");
  assert.equal(store.labels.aggregates.value.get(b.id)?.provinceCount, 0);
});

test("the border scan completing re-arms the push", () => {
  // A push during the scan is dropped. Without `borders.phase` in the effect,
  // a hydrated country never gets its border.
  const { store, registry, borderTimers } = setup();
  const a = registry.addCountry("A");

  const stop = registry.startCountryBorderSync();
  borderTimers.run();
  registry.assignProvinces(a.id, [1, 2, 3]);
  borderTimers.run();
  const baseline = borderTimers.sets;

  store.borders.phase.value = "scanning";
  store.borders.phase.value = "ready";

  assert.ok(borderTimers.sets > baseline, "the scan finishing schedules a fresh push");
  assert.equal(borderTimers.armed(), 1);

  stop();
});

test("flushCountryBorders with nothing pending is a no-op, not a crash", () => {
  const { registry, borders } = setup();

  assert.doesNotThrow(() => {
    registry.flushCountryBorders();
  });
  assert.equal(borders.pushed.length, 0);
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
