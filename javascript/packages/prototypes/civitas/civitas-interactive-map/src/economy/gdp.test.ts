import assert from "node:assert/strict";
import test from "node:test";
import { deriveGdpStage } from "./gdp";
import type { ConcessionStage, SectorDerived, SectorKey } from "./types";

function sector(key: SectorKey, gdpObor: number, finalPct: number): SectorDerived {
  return {
    key,
    gdpObor,
    share: 0,
    basePct: 0,
    shortagePenalty: 0,
    preShortagePct: finalPct,
    finalPct,
    gdpNextObor: 0,
  };
}

const NO_CONCESSION: ConcessionStage = {
  granted: false,
  sectorKey: null,
  concessionGrowthPp: 0,
};

test("the total is the sum of the rounded parts, never rounded on its own", () => {
  const sectors = [
    sector("agriculture", 24000000, 2.0738320055),
    sector("lightIndustry", 18000000, 1.8046146629),
    sector("heavyIndustry", 30000000, 1.3922257944),
  ];
  const stage = deriveGdpStage(sectors, NO_CONCESSION, 72000000, 0);

  assert.equal(stage.sectors[0]?.gdpNextObor, 24497720);
  assert.equal(stage.sectors[1]?.gdpNextObor, 18324831);
  assert.equal(stage.sectors[2]?.gdpNextObor, 30417668);
  assert.equal(stage.gdpNextTotalObor, 24497720 + 18324831 + 30417668);
  assert.equal(stage.gdpChangeObor, stage.gdpNextTotalObor - 72000000);
});

test("a volume is floored at 0 and never goes negative (guard G7)", () => {
  const stage = deriveGdpStage(
    [sector("agriculture", 20000000, -100)],
    NO_CONCESSION,
    20000000,
    0,
  );
  assert.equal(stage.sectors[0]?.gdpNextObor, 0);
});

test("a concession costs total GDP / province count, wherever it is booked", () => {
  // Spec 15.3's own example: 20 provinces, 100 000 000 GDP, a 5 000 000 loss.
  const sectors = [
    sector("agriculture", 20000000, 0),
    sector("commercial", 80000000, 0),
  ];
  const onSmall = deriveGdpStage(
    sectors,
    { granted: true, sectorKey: "agriculture", concessionGrowthPp: 1.5 },
    100000000,
    20,
  );
  const onLarge = deriveGdpStage(
    sectors,
    { granted: true, sectorKey: "commercial", concessionGrowthPp: 1.5 },
    100000000,
    20,
  );

  assert.equal(onSmall.concessionCostObor, 5000000);
  assert.equal(onLarge.concessionCostObor, 5000000, "the cost does not depend on the sector");
  assert.equal(onSmall.sectors[0]?.gdpNextObor, 15000000);
  assert.equal(onSmall.sectors[1]?.gdpNextObor, 80000000);
  assert.equal(onLarge.sectors[0]?.gdpNextObor, 20000000);
  assert.equal(onLarge.sectors[1]?.gdpNextObor, 75000000);
  assert.equal(onSmall.gdpNextTotalObor, 95000000);
});

test("the cost is clamped to the chosen sector's grown volume, and V20 fires", () => {
  const stage = deriveGdpStage(
    [sector("agriculture", 1000000, 0), sector("commercial", 99000000, 0)],
    { granted: true, sectorKey: "agriculture", concessionGrowthPp: 1.5 },
    100000000,
    2,
  );
  // The full cost is 50 000 000 against a 1 000 000 sector.
  assert.equal(stage.concessionCostObor, 1000000);
  assert.equal(stage.sectors[0]?.gdpNextObor, 0);
  assert.ok(stage.warnings.some((warning) => {
    return warning.startsWith("V20");
  }));
});

test("a country with no provinces pays nothing (guard G6)", () => {
  const stage = deriveGdpStage(
    [sector("agriculture", 20000000, 0)],
    { granted: true, sectorKey: "agriculture", concessionGrowthPp: 1.5 },
    20000000,
    0,
  );
  assert.equal(stage.concessionCostObor, 0);
  assert.equal(stage.sectors[0]?.gdpNextObor, 20000000);
  assert.deepEqual(stage.warnings, []);
});

test("a grant naming a sector that is not there costs nothing", () => {
  const stage = deriveGdpStage(
    [sector("agriculture", 20000000, 0)],
    { granted: true, sectorKey: "other2", concessionGrowthPp: 1.5 },
    20000000,
    10,
  );
  assert.equal(stage.concessionCostObor, 0);
});
