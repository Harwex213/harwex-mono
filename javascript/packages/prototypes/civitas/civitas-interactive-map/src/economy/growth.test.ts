import assert from "node:assert/strict";
import test from "node:test";
import { createSector } from "./economy-state";
import { deriveGrowthStage, modifierPpOf } from "./growth";
import type { GrowthInput, Sector, SectorKey } from "./types";

const ZERO_BY_KEY: Record<SectorKey, number> = {
  agriculture: 0,
  lightIndustry: 0,
  heavyIndustry: 0,
  commercial: 0,
  extraction: 0,
  other1: 0,
  other2: 0,
};

function input(overrides: Partial<GrowthInput>): GrowthInput {
  const sectors: Sector[] = [
    { ...createSector("agriculture"), gdpObor: 20000000, growthPermanentPct: 3 },
  ];
  return {
    sectors,
    shareByKey: { ...ZERO_BY_KEY, agriculture: 1 },
    penaltyByKey: { ...ZERO_BY_KEY },
    gdpTotalObor: 20000000,
    controlGrowthPp: 0,
    mobilizationGrowthPp: 0,
    concessionGrowthPp: 0,
    timedModifierPp: 0,
    autoInvestGrowthPp: 0,
    reservePenaltyPp: 0,
    inflationGrowthPp: 0,
    defenceGrowthPp: 0,
    ...overrides,
  };
}

test("the modifier sum adds five terms and subtracts three", () => {
  const value = modifierPpOf(input({
    controlGrowthPp: -1,
    mobilizationGrowthPp: -2,
    concessionGrowthPp: 1.5,
    timedModifierPp: 0.525,
    autoInvestGrowthPp: 0.5702466962,
    reservePenaltyPp: 0.1981132075,
    inflationGrowthPp: 0.6,
    defenceGrowthPp: 0.2,
  }));
  assert.ok(Math.abs(value - -1.4028665113) < 1e-9, "got " + value);
});

test("a full shortage zeroes growth and never drives it negative (guard G9)", () => {
  const stage = deriveGrowthStage(input({
    penaltyByKey: { ...ZERO_BY_KEY, agriculture: 1 },
  }));
  const sector = stage.sectors[0];
  assert.ok(sector);
  assert.equal(sector.preShortagePct, 3);
  assert.equal(sector.finalPct, 0);
  assert.equal(stage.overallGrowthPct, 0);
  assert.ok(stage.warnings.some((warning) => {
    return warning.startsWith("V18");
  }));
});

test("a shortage cannot deepen a contraction", () => {
  const sectors: Sector[] = [
    { ...createSector("agriculture"), gdpObor: 20000000, growthPermanentPct: -4 },
  ];
  const stage = deriveGrowthStage(input({
    sectors,
    penaltyByKey: { ...ZERO_BY_KEY, agriculture: 1 },
  }));
  // Already shrinking, so the shortage factor is not applied at all.
  assert.equal(stage.sectors[0]?.finalPct, -4);
  assert.equal(
    stage.warnings.some((warning) => {
      return warning.startsWith("V18");
    }),
    false,
    "V18 is about a zeroed sector, not a shrinking one",
  );
});

test("a partial shortage scales the growth, it does not subtract from it", () => {
  const stage = deriveGrowthStage(input({
    penaltyByKey: { ...ZERO_BY_KEY, agriculture: 0.25 },
  }));
  assert.ok(Math.abs((stage.sectors[0]?.finalPct ?? 0) - 2.25) < 1e-9);
});

test("finalPct is floored at -100 so a volume can reach 0 but never pass it", () => {
  const sectors: Sector[] = [
    { ...createSector("agriculture"), gdpObor: 20000000, growthPermanentPct: -500 },
  ];
  const stage = deriveGrowthStage(input({ sectors }));
  assert.equal(stage.sectors[0]?.finalPct, -100);
});

test("the overall rate is GDP-weighted, not a plain mean", () => {
  const sectors: Sector[] = [
    { ...createSector("agriculture"), gdpObor: 20000000, growthPermanentPct: 1.45 },
    { ...createSector("commercial"), gdpObor: 80000000, growthPermanentPct: 0 },
  ];
  const stage = deriveGrowthStage(input({ sectors, gdpTotalObor: 100000000 }));
  // Spec 5.4's own arithmetic: 20M x 1,45% / 100M = 0,29%. A plain mean gives
  // 0,725%.
  assert.ok(Math.abs(stage.overallGrowthPct - 0.29) < 1e-9, "got " + stage.overallGrowthPct);
});

test("a zero-GDP country grows at 0 rather than NaN", () => {
  const sectors: Sector[] = [
    { ...createSector("agriculture"), gdpObor: 0, growthPermanentPct: 3 },
  ];
  const stage = deriveGrowthStage(input({ sectors, gdpTotalObor: 0 }));
  assert.equal(stage.overallGrowthPct, 0);
});

test("the temporary column adds to the permanent one", () => {
  const sectors: Sector[] = [
    {
      ...createSector("heavyIndustry"),
      gdpObor: 20000000,
      growthPermanentPct: 4,
      growthTemporaryPct: -1,
    },
  ];
  const stage = deriveGrowthStage(input({ sectors }));
  assert.equal(stage.sectors[0]?.basePct, 3);
});
