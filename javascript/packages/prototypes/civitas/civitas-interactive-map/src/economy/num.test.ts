import assert from "node:assert/strict";
import test from "node:test";
import { clamp, finiteOr, isIntegerInRange, isNonNegativeNumber, roundTo, safeDivide, sumOf } from "./num";

test("roundTo is symmetric half-up on the magnitude", () => {
  // Math.round alone breaks ties upward, so -0,125 would become -0,12 while
  // +0,125 became +0,13. Growth and rating deltas are signed, so it would show.
  assert.equal(roundTo(0.125, 2), 0.13);
  assert.equal(roundTo(-0.125, 2), -0.13);
  assert.equal(roundTo(2.5, 0), 3);
  assert.equal(roundTo(-2.5, 0), -3);
  assert.equal(roundTo(1.0049, 2), 1.0);
  assert.equal(roundTo(30417667.74, 0), 30417668);
});

test("roundTo passes a non-finite value through untouched", () => {
  assert.ok(Number.isNaN(roundTo(Number.NaN, 2)));
  assert.equal(roundTo(Number.POSITIVE_INFINITY, 2), Number.POSITIVE_INFINITY);
});

test("clamp bounds both ends", () => {
  assert.equal(clamp(-5, 0, 100), 0);
  assert.equal(clamp(101, 0, 100), 100);
  assert.equal(clamp(50, 0, 100), 50);
});

test("finiteOr replaces NaN and both infinities", () => {
  // sanitizeRecord DROPS such a key rather than nulling it, so the field would
  // vanish from the saved document.
  assert.equal(finiteOr(Number.NaN, 7), 7);
  assert.equal(finiteOr(Number.POSITIVE_INFINITY, 7), 7);
  assert.equal(finiteOr(Number.NEGATIVE_INFINITY, 7), 7);
  assert.equal(finiteOr(0, 7), 0);
});

test("safeDivide yields 0 rather than NaN or Infinity", () => {
  assert.equal(safeDivide(5, 0), 0);
  assert.equal(safeDivide(0, 0), 0);
  assert.equal(safeDivide(Number.NaN, 2), 0);
  assert.equal(safeDivide(10, 4), 2.5);
});

test("the two predicates reject NaN, not merely negatives", () => {
  assert.equal(isNonNegativeNumber(Number.NaN), false);
  assert.equal(isNonNegativeNumber(-0.0001), false);
  assert.equal(isNonNegativeNumber(0), true);
  assert.equal(isNonNegativeNumber("3"), false);

  assert.equal(isIntegerInRange(Number.NaN, 1, 10), false);
  assert.equal(isIntegerInRange(1.5, 1, 10), false);
  assert.equal(isIntegerInRange(0, 1, 10), false);
  assert.equal(isIntegerInRange(10, 1, 10), true);
});

test("sumOf adds an empty list to 0", () => {
  assert.equal(sumOf([]), 0);
  assert.equal(sumOf([1, 2, 3.5]), 6.5);
});
