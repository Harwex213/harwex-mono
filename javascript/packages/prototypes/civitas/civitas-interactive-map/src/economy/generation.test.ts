import assert from "node:assert/strict";
import test from "node:test";
import { createInitialEconomy } from "./economy-state";
import { deriveGenerationStage } from "./generation";
import type { EconomyState } from "./types";

function totalOf(state: EconomyState): number {
  return state.sectors.reduce((sum, sector) => {
    return sum + sector.gdpObor;
  }, 0);
}

function standardStart(): EconomyState {
  return createInitialEconomy();
}

test("the standard start generates 10 017,00 FR and 233,20 MIC", () => {
  const state = standardStart();
  const stage = deriveGenerationStage(state, totalOf(state));

  assert.ok(Math.abs(stage.frTaxBase - 10000) < 1e-9);
  assert.ok(Math.abs(stage.frGrowthFactor - 1.06) < 1e-9);
  assert.ok(Math.abs(stage.ratingFactor - 1) < 1e-9);
  assert.ok(Math.abs(stage.controlFrMultiplier - 1) < 1e-9);
  assert.ok(Math.abs(stage.frDefenceDrag - 0.9) < 1e-9);
  assert.ok(Math.abs(stage.frLightBonus - 0.05) < 1e-9);
  assert.ok(Math.abs(stage.frGenerated - 10017) < 1e-9, "frGenerated " + stage.frGenerated);
  assert.ok(Math.abs(stage.micHeavyBonus - 0.1) < 1e-9);
  assert.ok(Math.abs(stage.micGenerated - 233.2) < 1e-9, "micGenerated " + stage.micGenerated);
});

test("mobilization halves FR and doubles MIC, and widens only the military step", () => {
  const plain = standardStart();
  const mobilized = { ...standardStart(), mobilized: true };
  const before = deriveGenerationStage(plain, totalOf(plain));
  const after = deriveGenerationStage(mobilized, totalOf(mobilized));

  assert.ok(Math.abs(after.frGenerated - before.frGenerated * 0.5) < 1e-9);
  assert.ok(Math.abs(after.micGenerated - before.micGenerated * 2) < 1e-9);
  assert.equal(after.emissionStepLimitPp, before.emissionStepLimitPp);
  assert.equal(after.militaryStepLimitPp, before.militaryStepLimitPp + 10);
  assert.equal(after.mobilizationGrowthPp, -2);
});

test("emission enters additively and is untouched by the rating", () => {
  const poor = { ...standardStart(), emissionPct: 10, ratingScore: 0 };
  const rich = { ...standardStart(), emissionPct: 10, ratingScore: 100 };
  const poorStage = deriveGenerationStage(poor, totalOf(poor));
  const richStage = deriveGenerationStage(rich, totalOf(rich));

  // A printing press does not need a creditor.
  assert.equal(poorStage.frEmission, richStage.frEmission);
  assert.ok(Math.abs(poorStage.frEmission - 5000) < 1e-9);
  assert.ok(richStage.frCore > poorStage.frCore);
});

test("the emission block is 0 across the board at 0%", () => {
  const state = standardStart();
  const stage = deriveGenerationStage(state, totalOf(state));

  assert.equal(stage.frEmission, 0);
  assert.equal(stage.inflationPct, 0);
  assert.equal(stage.inflationGrowthPp, 0);
  assert.equal(stage.emissionRatingPenalty, 0);
});

test("at the 50% emission ceiling the penalty outruns the gain", () => {
  const state = { ...standardStart(), emissionPct: 50 };
  const stage = deriveGenerationStage(state, totalOf(state));

  assert.ok(Math.abs(stage.inflationPct - 75) < 1e-9);
  assert.ok(Math.abs(stage.inflationGrowthPp - 7.5) < 1e-9);
  assert.equal(stage.emissionRatingPenalty, 20);
});

test("the defence penalty starts above the free baseline and reaches -5 at 60%", () => {
  const free = { ...standardStart(), militaryPct: 10 };
  const max = { ...standardStart(), militaryPct: 60 };
  assert.equal(deriveGenerationStage(free, totalOf(free)).defenceGrowthPp, 0);
  const top = deriveGenerationStage(max, totalOf(max));
  assert.ok(Math.abs(top.defenceGrowthPp - 5) < 1e-9);
  // Guard G16: the floor is structural and unreachable as the constants stand.
  assert.ok(Math.abs(top.frDefenceDrag - 0.4) < 1e-9);
});

test("frGrowthFactor is clamped against a runaway growth number (guard G15)", () => {
  const wild = standardStart();
  wild.sectors = wild.sectors.map((sector) => {
    return { ...sector, growthPermanentPct: 100 };
  });
  assert.equal(deriveGenerationStage(wild, totalOf(wild)).frGrowthFactor, 1.5);

  const collapsing = standardStart();
  collapsing.sectors = collapsing.sectors.map((sector) => {
    return { ...sector, growthPermanentPct: -100 };
  });
  assert.equal(deriveGenerationStage(collapsing, totalOf(collapsing)).frGrowthFactor, 0.5);
});

test("both privatization drags read the INCOMING counter", () => {
  const armed = { ...standardStart(), privatizationFrDragTurns: 1 };
  const plain = standardStart();
  const before = deriveGenerationStage(plain, totalOf(plain));
  const after = deriveGenerationStage(armed, totalOf(armed));
  assert.ok(Math.abs(after.frCore - before.frCore * 0.95) < 1e-9);

  const micArmed = { ...standardStart(), privatizationMicDragTurns: 1, militaryPct: 10 };
  const micAfter = deriveGenerationStage(micArmed, totalOf(micArmed));
  assert.ok(Math.abs(micAfter.micGenerated - before.micGenerated * 0.95) < 1e-9);
});

test("a country with zero GDP divides by nothing and generates nothing", () => {
  const empty = standardStart();
  empty.sectors = empty.sectors.map((sector) => {
    return { ...sector, gdpObor: 0 };
  });
  const stage = deriveGenerationStage(empty, 0);

  assert.equal(stage.plannedGrowthPct, 0);
  assert.equal(stage.frTaxBase, 0);
  assert.equal(stage.frGenerated, 0);
  assert.equal(stage.micGenerated, 0);
  assert.equal(stage.shareByKey.agriculture, 0);
});
