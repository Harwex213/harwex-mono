import assert from "node:assert/strict";
import test from "node:test";
import {
  debtTermsOf,
  deriveRatingStage,
  emissionRatingPenaltyOf,
  isCleanTurn,
  ratingFactorOf,
  ratingTierOf,
} from "./rating";
import type { RatingInput } from "./types";

function input(overrides: Partial<RatingInput>): RatingInput {
  return {
    ratingScore: 70,
    emissionPct: 0,
    emissionRatingPenalty: 0,
    actionRatingDeltas: [],
    debtRatingPenalty: 0,
    shortfallTotal: 0,
    overallGrowthPct: 1,
    mobilized: false,
    mobilizationJustified: true,
    ...overrides,
  };
}

test("every tier boundary lands in its own band", () => {
  const edges: [number, string][] = [
    [0, "F"], [9, "F"],
    [10, "E"], [29, "E"],
    [30, "D"], [49, "D"],
    [50, "C"], [69, "C"],
    [70, "B"], [84, "B"],
    [85, "A"], [94, "A"],
    [95, "A+"], [100, "A+"],
  ];
  for (const [score, tier] of edges) {
    assert.equal(ratingTierOf(score), tier, "score " + score);
  }
});

test("ratingFactor is 0,30 at 0, exactly 1,00 at the standard start, 1,30 at 100", () => {
  assert.ok(Math.abs(ratingFactorOf(0) - 0.3) < 1e-9);
  assert.equal(ratingFactorOf(70), 1);
  assert.ok(Math.abs(ratingFactorOf(100) - 1.3) < 1e-9);
});

test("the debt terms follow the tier", () => {
  assert.equal(debtTermsOf("B").ratePct, 12);
  assert.equal(debtTermsOf("B").limitMultiple, 2.25);
  assert.equal(debtTermsOf("F").limitMultiple, 0);
});

test("the emission penalty is a whole number of rating points", () => {
  assert.equal(emissionRatingPenaltyOf(0), 0);
  assert.equal(emissionRatingPenaltyOf(4), 2);
  assert.equal(emissionRatingPenaltyOf(10), 4);
  assert.equal(emissionRatingPenaltyOf(50), 20);
});

test("each clean-turn clause fails on its own", () => {
  assert.equal(isCleanTurn(0, 0, 1), true);
  assert.equal(isCleanTurn(0.01, 0, 1), false, "any emission at all forfeits it");
  assert.equal(isCleanTurn(0, 0.01, 1), false, "any missed payment forfeits it");
  assert.equal(isCleanTurn(0, 0, 0), false, "exactly 0 growth fails — strictly positive");
  assert.equal(isCleanTurn(0, 0, -0.5), false);
});

test("a clean turn with nothing else adds exactly +1", () => {
  const stage = deriveRatingStage(input({ ratingScore: 60 }));
  assert.equal(stage.cleanTurn, true);
  assert.equal(stage.recovery, 1);
  assert.equal(stage.ratingNext, 61);
  assert.deepEqual(stage.deltas, [{ reason: "Clean-turn recovery", points: 1 }]);
});

test("recovery and a penalty both apply, and the net is plain addition", () => {
  // A clean turn that also nationalises is -4 + 1 = -3.
  const nationalised = deriveRatingStage(input({
    ratingScore: 70,
    actionRatingDeltas: [{ reason: "Nationalization", points: -4 }],
  }));
  assert.equal(nationalised.cleanTurn, true);
  assert.equal(nationalised.ratingNext, 67);

  // A clean turn under an unjustified mobilization is -5 + 1 = -4.
  const mobilized = deriveRatingStage(input({
    ratingScore: 70,
    mobilized: true,
    mobilizationJustified: false,
  }));
  assert.equal(mobilized.cleanTurn, true);
  assert.equal(mobilized.ratingNext, 66);
});

test("emission and a debt shortfall cannot co-occur with the recovery", () => {
  const emitting = deriveRatingStage(input({
    emissionPct: 5,
    emissionRatingPenalty: 2,
  }));
  assert.equal(emitting.cleanTurn, false);
  assert.equal(emitting.recovery, 0);
  assert.equal(emitting.ratingNext, 68);

  const short = deriveRatingStage(input({ shortfallTotal: 100, debtRatingPenalty: 10 }));
  assert.equal(short.cleanTurn, false);
  assert.equal(short.ratingNext, 60);
});

test("the clamp sees the sum, never the terms", () => {
  // At 100 a clean turn adds nothing.
  assert.equal(deriveRatingStage(input({ ratingScore: 100 })).ratingNext, 100);
  // A recovery cannot lift a score the same turn's penalties drove below 0.
  const wiped = deriveRatingStage(input({
    ratingScore: 2,
    actionRatingDeltas: [{ reason: "Nationalization", points: -4 }],
  }));
  assert.equal(wiped.ratingNext, 0);
  assert.equal(wiped.ratingTierNext, "F");
});

test("a zero-valued delta never becomes a line", () => {
  const stage = deriveRatingStage(input({ overallGrowthPct: 0 }));
  assert.deepEqual(stage.deltas, []);
  assert.equal(stage.ratingNext, 70);
});
