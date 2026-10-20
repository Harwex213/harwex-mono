import assert from "node:assert/strict";
import test from "node:test";
import {
  LOAD_STEPS,
  loadProgress,
  type LoadStep,
} from "./load-steps";

test("LOAD_STEPS lists every step once, in order, ending at done", () => {
  // `loadProgress` divides by `LOAD_STEPS.length - 1`, so order and length both matter.
  const expected: LoadStep[] = [
    "manifest",
    "province-bitmap",
    "province-index",
    "map-art",
    "done",
  ];

  assert.deepEqual(Array.from(LOAD_STEPS), expected);
  assert.equal(new Set(LOAD_STEPS).size, LOAD_STEPS.length);
  assert.equal(LOAD_STEPS[LOAD_STEPS.length - 1], "done");
});

test("loadProgress starts at 0, grows with each step and reaches 1 at done", () => {
  assert.equal(loadProgress("manifest"), 0);
  assert.equal(loadProgress("done"), 1);

  let previous = -1;
  for (const step of LOAD_STEPS) {
    const progress = loadProgress(step);
    assert.ok(progress > previous, step + " must move progress forward");
    previous = progress;
  }
});
