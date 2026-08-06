import assert from "node:assert/strict";
import test from "node:test";
import {
  controlBandIndexOf,
  controlBandNameOf,
  controlFrMultiplierOf,
  controlGrowthPpOf,
  stepLimitPpOf,
} from "./control";

test("every band boundary maps to its own index, on both edges", () => {
  const edges: [number, number][] = [
    [0, 0], [5, 0],
    [6, 1], [20, 1],
    [21, 2], [30, 2],
    [31, 3], [44, 3],
    [45, 4], [49, 4],
    [50, 5],
    [51, 6], [55, 6],
    [56, 7], [69, 7],
    [70, 8], [79, 8],
    [80, 9], [94, 9],
    [95, 10], [100, 10],
  ];
  for (const [position, index] of edges) {
    assert.equal(controlBandIndexOf(position), index, "position " + position);
  }
});

test("the neutral band is exactly neutral", () => {
  const index = controlBandIndexOf(50);
  assert.equal(index, 5);
  assert.equal(controlGrowthPpOf(index), 0);
  assert.equal(controlFrMultiplierOf(index), 1);
  assert.equal(stepLimitPpOf(index), 10);
  assert.equal(controlBandNameOf(index), "Policy of balance");
});

test("an out-of-range or non-finite position is clamped, never thrown on", () => {
  assert.equal(controlBandIndexOf(-40), 0);
  assert.equal(controlBandIndexOf(4000), 10);
  assert.equal(controlBandIndexOf(Number.NaN), 5);
});

test("the scale leans the sourced way in both directions", () => {
  // Toward planning: slower growth, more free funds, a wider step.
  assert.ok(controlGrowthPpOf(0) < 0);
  assert.ok(controlFrMultiplierOf(0) > 1);
  assert.ok(stepLimitPpOf(0) > 10);
  // Toward the market: the mirror image.
  assert.ok(controlGrowthPpOf(10) > 0);
  assert.ok(controlFrMultiplierOf(10) < 1);
  assert.ok(stepLimitPpOf(10) < 10);
});
