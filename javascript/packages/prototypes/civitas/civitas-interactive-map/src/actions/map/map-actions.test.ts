import assert from "node:assert/strict";
import test from "node:test";
import { loadMap } from "./map-actions";
import {
  country,
  createTestApp,
  fakeMapAssets,
} from "../../test-support";
import type { LoadStep } from "../../datasource/index";

// `loadMap` writes the load progress. The store holds it as a plain signal.

test("loadMap moves progress with each step and ends at 1", async () => {
  const seen: number[] = [];
  const steps: LoadStep[] = ["manifest", "countries", "province-bitmap", "province-index", "map-art", "done"];
  const { store, sources } = createTestApp({
    async loadMapAssets(onStep) {
      for (const step of steps) {
        onStep?.(step);
        seen.push(store.map.progress.peek());
      }
      return fakeMapAssets({ width: 4, height: 4 });
    },
  });

  assert.equal(store.map.progress.peek(), 0);
  await loadMap(store, sources);

  assert.deepEqual(seen, [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.equal(store.map.phase.peek(), "ready");
  assert.equal(store.map.progress.peek(), 1);
});

test("a failed load resets progress to 0", async () => {
  const { store, sources } = createTestApp({
    async loadMapAssets(onStep) {
      onStep?.("province-index");
      throw new Error("boom");
    },
  });

  await loadMap(store, sources);

  assert.equal(store.map.phase.peek(), "failed");
  assert.equal(store.map.error.peek(), "boom");
  assert.equal(store.map.progress.peek(), 0);
});

test("loadMap writes the loaded countries into the world slice", async () => {
  const aurelia = country(1, [11, 12], { name: "Aurelia" });
  const { store, sources } = createTestApp({
    async loadMapAssets() {
      const assets = fakeMapAssets({ width: 4, height: 4 });
      return { ...assets, countries: { countries: [aurelia], repairs: [] } };
    },
  });

  await loadMap(store, sources);

  assert.deepEqual(store.world.countries.peek(), [aurelia]);
  assert.equal(store.world.countryOfProvince.peek().get(12), 1);
  assert.equal(store.world.notice.peek(), null, "a clean file shows no notice");
});

test("the repairs of the countries file become one dismissible notice", async () => {
  const { store, sources, registry } = createTestApp({
    async loadMapAssets() {
      const assets = fakeMapAssets({ width: 4, height: 4 });
      return {
        ...assets,
        countries: { countries: [], repairs: ["dropped 1 malformed countries", "dropped 2 duplicate province claims"] },
      };
    },
  });

  await loadMap(store, sources);
  assert.equal(
    store.world.notice.peek(),
    "countries.json: dropped 1 malformed countries; dropped 2 duplicate province claims",
  );

  registry.dismissCountriesNotice();
  assert.equal(store.world.notice.peek(), null);
});
