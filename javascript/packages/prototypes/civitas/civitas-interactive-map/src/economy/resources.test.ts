import assert from "node:assert/strict";
import test from "node:test";
import { createResourceState, createSector } from "./economy-state";
import { deriveResourceStage, needUnitsOf, sectorPenaltiesOf } from "./resources";
import { RESOURCE_KEYS } from "./constants";
import type { ResourceKey, ResourceState, Sector } from "./types";

function sectorsAt(volumes: Partial<Record<string, number>>): Sector[] {
  return Object.entries(volumes).map(([key, gdpObor]) => {
    return { ...createSector(key as Sector["key"]), gdpObor: gdpObor ?? 0 };
  });
}

function resourcesWith(
  overrides: Partial<Record<ResourceKey, Partial<ResourceState>>>,
): ResourceState[] {
  return RESOURCE_KEYS.map((key) => {
    return { ...createResourceState(key), ...(overrides[key] ?? {}) };
  });
}

test("needUnits is the ceiling of the SUMMED quotient, not the sum of ceilings", () => {
  // Two sectors of 500 001 obor each: the summed quotient ceils to 2, the sum of
  // ceilings would give 2 as well, so use a case where they differ.
  const gdp = {
    agriculture: 0,
    lightIndustry: 400000,
    heavyIndustry: 400000,
    commercial: 0,
    extraction: 400000,
    other1: 0,
    other2: 0,
  };
  // coal depends on heavy, light and extraction: 1 200 000 obor -> 2 units.
  assert.equal(needUnitsOf("coal", gdp), 2);
  // The sum of ceilings would be 3.
});

test("a resource no sector needs divides by nothing (guard G2)", () => {
  const stage = deriveResourceStage(sectorsAt({}), resourcesWith({}));
  for (const row of stage.resources) {
    assert.equal(row.needUnits, 0, row.key);
    assert.equal(row.coverage, 1, row.key + " coverage");
    assert.equal(row.shortage, 0, row.key + " shortage");
  }
});

test("a blockade cuts imports and leaves domestic extraction alone", () => {
  const stage = deriveResourceStage(
    sectorsAt({ heavyIndustry: 20000000 }),
    resourcesWith({ oil: { deposits: 1, importsRequested: 40, blockadePct: 50 } }),
  );
  const oil = stage.resources.find((row) => {
    return row.key === "oil";
  });
  assert.ok(oil);
  assert.equal(oil.extractionUnits, 50);
  assert.equal(oil.importUnits, 20);
  assert.equal(oil.onHandUnits, 70);
});

test("an extraction bonus scales the yield", () => {
  const stage = deriveResourceStage(
    sectorsAt({ heavyIndustry: 1000000 }),
    resourcesWith({ oil: { deposits: 2, extractionBonusPct: 25 } }),
  );
  const oil = stage.resources.find((row) => {
    return row.key === "oil";
  });
  assert.equal(oil?.extractionUnits, 125);
});

test("exports are clipped to what the country holds, and V19 fires", () => {
  const stage = deriveResourceStage(
    sectorsAt({ heavyIndustry: 20000000 }),
    resourcesWith({ oil: { deposits: 1, exports: 500 } }),
  );
  const oil = stage.resources.find((row) => {
    return row.key === "oil";
  });
  assert.ok(oil);
  assert.equal(oil.exportsAppliedUnits, 50);
  // The clip is what makes supply non-negative by construction — no max(0, ...).
  assert.equal(oil.supplyUnits, 0);
  assert.ok(stage.warnings.some((warning) => {
    return warning.startsWith("V19") && warning.includes("oil");
  }));
});

test("a surplus carries to next turn and buys nothing this one (guard G22)", () => {
  const stage = deriveResourceStage(
    sectorsAt({ heavyIndustry: 10000000 }),
    resourcesWith({ oil: { deposits: 2 } }),
  );
  const oil = stage.resources.find((row) => {
    return row.key === "oil";
  });
  assert.ok(oil);
  assert.equal(oil.needUnits, 10);
  assert.equal(oil.coverage, 1, "coverage is capped at 1");
  assert.equal(oil.freeUnits, 90);
  assert.equal(oil.stockNextUnits, 90);
});

test("a sector with no dependency has penalty 0 even under a total shortage", () => {
  const penalties = sectorPenaltiesOf({
    coal: 1, oil: 1, fibre: 1, ferrous: 1,
    nonferrous: 1, rubber: 1, chemical: 1, precious: 1,
  });
  assert.equal(penalties.other1, 0);
  assert.equal(penalties.other2, 0);
  // Everything else takes exactly 1 — the normalisation is what bounds it.
  assert.equal(penalties.agriculture, 1);
  assert.equal(penalties.heavyIndustry, 1);
  assert.equal(penalties.extraction, 1);
});

test("the sourced weighting inverts across sectors, which spec 13.4 names", () => {
  // A total coal gap: extraction depends on coal alone, so it takes 100%;
  // heavy industry has six dependencies, so it takes 1/3 over 3,666667.
  const coalGap = sectorPenaltiesOf({
    coal: 1, oil: 0, fibre: 0, ferrous: 0,
    nonferrous: 0, rubber: 0, chemical: 0, precious: 0,
  });
  assert.equal(coalGap.extraction, 1);
  assert.ok(Math.abs(coalGap.heavyIndustry - 0.0909090909) < 1e-9);

  // A total oil gap: one dependent, so weight 1, and heavy takes 27,3%.
  const oilGap = sectorPenaltiesOf({
    coal: 0, oil: 1, fibre: 0, ferrous: 0,
    nonferrous: 0, rubber: 0, chemical: 0, precious: 0,
  });
  assert.ok(Math.abs(oilGap.heavyIndustry - 0.2727272727) < 1e-9);
});

test("a negative or non-finite input never produces NaN", () => {
  const stage = deriveResourceStage(
    sectorsAt({ heavyIndustry: 20000000 }),
    resourcesWith({
      oil: {
        deposits: Number.NaN,
        importsRequested: Number.POSITIVE_INFINITY,
        stockUnits: -50,
      },
    }),
  );
  for (const row of stage.resources) {
    for (const value of Object.values(row)) {
      if (typeof value === "number") {
        assert.ok(Number.isFinite(value), row.key + " produced a non-finite value");
      }
    }
  }
});
