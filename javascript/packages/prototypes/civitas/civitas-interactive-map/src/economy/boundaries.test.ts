import assert from "node:assert/strict";
import test from "node:test";
import { createInitialEconomy } from "./economy-state";
import { deriveEconomy } from "./derive";
import type { EconomyState, RatingTier, ResourceKey } from "./types";

// The two contiguous scales, swept through the WHOLE engine.
//
// `rating.test.ts` and `control.test.ts` check the lookup functions. This file
// checks the wiring: that the tier a score lands in is the tier whose debt
// multiple, rate and term the sheet then uses, and that the band a position
// lands in is the band whose growth, FR multiplier and step limit the sheet then
// uses. Both scales are contiguous ranges, so an off-by-one at a boundary is the
// likeliest bug in the engine and it would be invisible in the middle of a band.
//
// Both edges of all 7 tiers and all 11 bands are swept. Every expectation is the
// spec's own table (section 2.9, section 6.1, section 7.1) plus arithmetic done
// by hand on the standard start.

const TOL = 1e-9;

function close(actual: number, expected: number, message: string, tolerance = TOL): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message + ": expected " + expected + ", got " + actual,
  );
}

const DEPOSITS: Record<ResourceKey, number> = {
  coal: 2,
  oil: 1,
  fibre: 1,
  ferrous: 1,
  nonferrous: 1,
  rubber: 1,
  chemical: 2,
  precious: 1,
};

// The standard start: 5 sectors of 20 000 000 obor at 3,00% permanent growth,
// rating 70, control 50, no emission, 10% military spending, no loans and no
// ledger lines. Its FR generation is 10 000 x 1,00 x 1,00 x 1,06 x 0,90 x 1,05 =
// 10 017,00 points (spec 21.1), and every figure below scales off that.
const STANDARD_FR = 10017.0;

function standardStart(): EconomyState {
  const state = createInitialEconomy();
  state.resources = state.resources.map((resource) => {
    return { ...resource, deposits: DEPOSITS[resource.key] };
  });
  return state;
}

test("both edges of all seven rating tiers reach the right debt terms", () => {
  // Spec 6.1's bands and spec 2.9's per-tier row, at the first and last score of
  // every tier.
  const edges: [number, RatingTier, number, number, number][] = [
    // score, tier, limit multiple, rate, term
    [0, "F", 0.0, 0, 0],
    [9, "F", 0.0, 0, 0],
    [10, "E", 0.5, 30.0, 2],
    [29, "E", 0.5, 30.0, 2],
    [30, "D", 1.0, 23.0, 3],
    [49, "D", 1.0, 23.0, 3],
    [50, "C", 1.5, 17.0, 4],
    [69, "C", 1.5, 17.0, 4],
    [70, "B", 2.25, 12.0, 6],
    [84, "B", 2.25, 12.0, 6],
    [85, "A", 3.0, 8.0, 8],
    [94, "A", 3.0, 8.0, 8],
    [95, "A+", 4.0, 4.0, 10],
    [100, "A+", 4.0, 4.0, 10],
  ];

  for (const [score, tier, multiple, ratePct, termTurns] of edges) {
    const derived = deriveEconomy({ ...standardStart(), ratingScore: score });
    const at = "score " + score;

    assert.deepEqual(derived.errors, [], at + " must be a valid sheet");
    assert.equal(derived.ratingTier, tier, at + " tier");

    // ratingFactor = 1 + 0,01 x (score - 70), and it multiplies frCore, so the
    // whole FR block moves with the rating.
    const factor = 1 + 0.01 * (score - 70);
    close(derived.ratingFactor, factor, at + " ratingFactor");
    close(derived.frGenerated, STANDARD_FR * factor, at + " frGenerated", 1e-6);

    // The rating enters twice: once through frGenerated, once through the tier
    // multiple. A downgrade bites through both.
    close(derived.debtLimit, multiple * STANDARD_FR * factor, at + " debtLimit", 1e-6);
    assert.equal(derived.newLoanRatePct, ratePct, at + " rate");
    assert.equal(derived.newLoanTermTurns, termTurns, at + " term");
    close(derived.reserveCap, 2 * STANDARD_FR * factor, at + " reserveCap", 1e-6);
  }
});

test("a tier boundary is a step: 69 and 70 borrow differently on the same income", () => {
  const doubtful = deriveEconomy({ ...standardStart(), ratingScore: 69 });
  const stable = deriveEconomy({ ...standardStart(), ratingScore: 70 });

  assert.equal(doubtful.ratingTier, "C");
  assert.equal(stable.ratingTier, "B");
  // One rating point apart, and the limit jumps by more than the income does.
  close(doubtful.debtLimit, 1.5 * STANDARD_FR * 0.99, "C limit", 1e-6);
  close(stable.debtLimit, 2.25 * STANDARD_FR, "B limit", 1e-6);
  assert.ok(stable.debtLimit > doubtful.debtLimit * 1.4, "the tier step dominates");
});

test("both edges of all eleven control bands reach the right band effects", () => {
  // Spec 7.1's table, cell for cell, read through deriveEconomy rather than
  // through the lookup functions.
  const edges: [number, number, number, number, number][] = [
    // position, band index, growth pp, FR multiplier, step limit pp
    [0, 0, -2.5, 1.5, 17.5],
    [5, 0, -2.5, 1.5, 17.5],
    [6, 1, -2.0, 1.4, 16.0],
    [20, 1, -2.0, 1.4, 16.0],
    [21, 2, -1.5, 1.3, 14.5],
    [30, 2, -1.5, 1.3, 14.5],
    [31, 3, -1.0, 1.2, 13.0],
    [44, 3, -1.0, 1.2, 13.0],
    [45, 4, -0.5, 1.1, 11.5],
    [49, 4, -0.5, 1.1, 11.5],
    [50, 5, 0.0, 1.0, 10.0],
    [51, 6, 0.5, 0.9, 8.5],
    [55, 6, 0.5, 0.9, 8.5],
    [56, 7, 1.0, 0.8, 7.0],
    [69, 7, 1.0, 0.8, 7.0],
    [70, 8, 1.5, 0.7, 5.5],
    [79, 8, 1.5, 0.7, 5.5],
    [80, 9, 2.0, 0.6, 4.0],
    [94, 9, 2.0, 0.6, 4.0],
    [95, 10, 2.5, 0.5, 2.5],
    [100, 10, 2.5, 0.5, 2.5],
  ];

  for (const [position, index, growthPp, multiplier, stepLimit] of edges) {
    const derived = deriveEconomy({ ...standardStart(), controlPosition: position });
    const at = "position " + position;

    assert.deepEqual(derived.errors, [], at + " must be a valid sheet");
    assert.equal(derived.controlBandIndex, index, at + " band index");
    close(derived.controlGrowthPp, growthPp, at + " growth");
    close(derived.controlFrMultiplier, multiplier, at + " FR multiplier");
    // Emission and military share one step limit; only mobilization parts them.
    close(derived.emissionStepLimitPp, stepLimit, at + " emission step limit");
    close(derived.militaryStepLimitPp, stepLimit, at + " military step limit");

    // The FR multiplier is the ONLY place the control scale touches the budget,
    // so the whole take moves with it and MIC does not move at all.
    close(derived.frGenerated, STANDARD_FR * multiplier, at + " frGenerated", 1e-6);
    close(derived.micGenerated, 233.2, at + " micGenerated carries no control term", 1e-6);
  }
});

test("the neutral band is the anchor all three formulas return at i = 5", () => {
  const derived = deriveEconomy({ ...standardStart(), controlPosition: 50 });

  assert.equal(derived.controlBandIndex, 5);
  assert.equal(derived.controlBandName, "Policy of balance");
  assert.equal(derived.controlGrowthPp, 0);
  assert.equal(derived.controlFrMultiplier, 1);
  assert.equal(derived.emissionStepLimitPp, 10);
  close(derived.frGenerated, STANDARD_FR, "the standard start reads as no adjustment", 1e-9);
});

test("a band boundary is a step: 49 and 50 and 51 differ in all three effects", () => {
  const guided = deriveEconomy({ ...standardStart(), controlPosition: 49 });
  const balanced = deriveEconomy({ ...standardStart(), controlPosition: 50 });
  const regulated = deriveEconomy({ ...standardStart(), controlPosition: 51 });

  assert.deepEqual(
    [guided.controlBandIndex, balanced.controlBandIndex, regulated.controlBandIndex],
    [4, 5, 6],
  );
  // Toward planning: slower growth, more free funds, a wider step. Toward the
  // market: the mirror image. One position apart in each direction.
  assert.ok(guided.controlGrowthPp < balanced.controlGrowthPp);
  assert.ok(balanced.controlGrowthPp < regulated.controlGrowthPp);
  assert.ok(guided.controlFrMultiplier > balanced.controlFrMultiplier);
  assert.ok(balanced.controlFrMultiplier > regulated.controlFrMultiplier);
  assert.ok(guided.emissionStepLimitPp > balanced.emissionStepLimitPp);
  assert.ok(balanced.emissionStepLimitPp > regulated.emissionStepLimitPp);
});

test("the two lockout bands are exactly bands 0 and 10, at both their edges", () => {
  for (const position of [0, 5]) {
    const derived = deriveEconomy({ ...standardStart(), controlPosition: position });
    assert.equal(derived.nationalizationAvailable, false, "position " + position);
    assert.equal(derived.privatizationAvailable, true, "position " + position);
  }
  for (const position of [95, 100]) {
    const derived = deriveEconomy({ ...standardStart(), controlPosition: position });
    assert.equal(derived.nationalizationAvailable, true, "position " + position);
    assert.equal(derived.privatizationAvailable, false, "position " + position);
  }
  // One position outside either lock and both are open again.
  for (const position of [6, 94]) {
    const derived = deriveEconomy({ ...standardStart(), controlPosition: position });
    assert.equal(derived.nationalizationAvailable, true, "position " + position);
    assert.equal(derived.privatizationAvailable, true, "position " + position);
  }
});
