import assert from "node:assert/strict";
import test from "node:test";
import { loadMap } from "./map-actions";
import { createTestApp, fakeMapAssets } from "../../test-support";
import type { LoadStep } from "../../datasource/index";

// `loadMap` writes the load progress. The store holds it as a plain signal.

test("loadMap moves progress with each step and ends at 1", async () => {
  const seen: number[] = [];
  const steps: LoadStep[] = ["manifest", "province-bitmap", "province-index", "map-art", "done"];
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

  assert.deepEqual(seen, [0, 0.25, 0.5, 0.75, 1]);
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
