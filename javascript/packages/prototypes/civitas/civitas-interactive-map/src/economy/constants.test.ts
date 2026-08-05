import assert from "node:assert/strict";
import test from "node:test";
import {
  CONCESSION_REGIONS,
  CONTROL_BANDS,
  DEBT_TERMS,
  ECONOMY_CONSTANTS,
  RATING_TIERS,
  RESOURCE_DEPENDENTS,
  RESOURCE_KEYS,
  RESOURCE_WEIGHTS,
  SECTOR_DEPENDENCIES,
} from "./constants";
import {
  controlFrMultiplierOf,
  controlGrowthPpOf,
  stepLimitPpOf,
} from "./control";
import type { ResourceKey, SectorKey } from "./types";

// The constants are the retuning surface. If one of them drifts, every number in
// the engine moves with it and no other test would name the cause, so each is
// pinned against spec section 2 here.

test("every scalar equals its spec section 2 value", () => {
  const expected: [string, number | boolean][] = [
    ["ARLINGS_PER_OBOR", 500],
    ["ARLINGS_PER_FR_POINT", 1000000],
    ["OBOR_PER_FR_POINT", 2000],
    ["OBOR_PER_MIC_POINT", 50000],
    ["OBOR_PER_RESOURCE_UNIT", 1000000],
    ["OTHER_SECTOR_MAX", 2],
    ["DEFAULT_PERMANENT_GROWTH_PCT", 3.0],
    ["START_GDP_OBOR", 100000000],
    ["START_SECTOR_GDP_OBOR", 20000000],
    ["SECTOR_GROWTH_FLOOR_PCT", -100.0],
    ["START_RATING", 70],
    ["RATING_FR_PIVOT", 70],
    ["RATING_FR_SLOPE", 0.01],
    ["RATING_RECOVERY_PER_TURN", 1],
    ["RATING_MIN", 0],
    ["RATING_MAX", 100],
    ["CONTROL_NEUTRAL_BAND_INDEX", 5],
    ["START_CONTROL", 50],
    ["CONTROL_GROWTH_STEP_PP", 0.5],
    ["CONTROL_FR_STEP", 0.1],
    ["STEP_LIMIT_NEUTRAL_PP", 10.0],
    ["CONTROL_STEP_SLOPE_PP", 1.5],
    ["NAT_LOCK_BAND_INDEX", 0],
    ["PRIV_LOCK_BAND_INDEX", 10],
    ["FR_TAX_RATE", 0.2],
    ["FR_GROWTH_COEFF", 0.02],
    ["FR_GROWTH_FACTOR_MIN", 0.5],
    ["FR_GROWTH_FACTOR_MAX", 1.5],
    ["FR_LIGHT_BONUS_COEFF", 0.25],
    ["MILITARY_FR_DRAG", 1.0],
    ["MILITARY_FR_DRAG_FLOOR", 0.1],
    ["FR_REGIME_MULT_MOBILIZED", 0.5],
    ["EMISSION_FR_RATE", 1.0],
    ["MIC_HEAVY_BONUS_COEFF", 0.5],
    ["MIC_REGIME_MULT_MOBILIZED", 2.0],
    ["EMISSION_PCT_MIN", 0.0],
    ["EMISSION_PCT_MAX", 50.0],
    ["EMISSION_INFLATION_COEFF", 1.5],
    ["INFLATION_GROWTH_COEFF", 0.1],
    ["EMISSION_RATING_COEFF", 0.4],
    ["MILITARY_PCT_MIN", 0.0],
    ["MILITARY_PCT_MAX", 60.0],
    ["MILITARY_FREE_PCT", 10.0],
    ["DEFENCE_GROWTH_COEFF", 0.1],
    ["RESERVE_CAP_MULTIPLE", 2.0],
    ["INVEST_GROWTH_COEFF", 2.0],
    ["RESERVE_PENALTY_MULTIPLE", 1.5],
    ["MIC_UPKEEP_FR_PER_POINT", 2.0],
    ["DEBT_SHORTFALL_RATING_MAX", 10],
    ["DEBT_AUTO_SERVICE", true],
    ["MOB_STEP_BONUS_PP", 10.0],
    ["MOB_FR_MULT", 0.5],
    ["MOB_MIC_MULT", 2.0],
    ["MOB_GROWTH_PP", -2.0],
    ["MOB_UNJUSTIFIED_RATING_PER_TURN", -5],
    ["NAT_GROWTH_PP", -0.75],
    ["NAT_RATING", -4],
    ["NAT_INCOME_MAX_PCT", 26.25],
    ["PRIV_GROWTH_MAX_PP", 0.75],
    ["PRIV_FAIL_GROWTH_PP", -0.25],
    ["PRIV_FAIL_RATING", -2],
    ["ACTION_COOLDOWN_TURNS", 2],
    ["ROLL_MIN", 1],
    ["ROLL_MAX", 10],
    ["PRIV_SUCCESS_MIN_ROLL", 6],
    ["ACTION_EFFECT_TURNS", 2],
    ["NAT_CONTROL_SHIFT", -3],
    ["PRIV_CONTROL_SHIFT", 3],
    ["PRIV_DRAG_PCT", 5.0],
    ["PRIV_DRAG_TURNS", 3],
    ["CONCESSION_GROWTH_PP", 1.5],
    ["DEPOSIT_YIELD_UNITS", 50],
    ["TURN_HISTORY_MAX", 12],
    ["PCT_STORE_DECIMALS", 4],
    ["PCT_DISPLAY_DECIMALS", 2],
    ["POINT_DECIMALS", 2],
    ["ECONOMY_SCHEMA_VERSION", 1],
  ];
  const table = ECONOMY_CONSTANTS as unknown as Record<string, number | boolean>;
  for (const [name, value] of expected) {
    assert.equal(table[name], value, name);
  }
});

test("the seven rating tiers are contiguous and cover 0..100", () => {
  assert.deepEqual(
    RATING_TIERS.map((row) => {
      return [row.tier, row.min, row.max];
    }),
    [
      ["A+", 95, 100],
      ["A", 85, 94],
      ["B", 70, 84],
      ["C", 50, 69],
      ["D", 30, 49],
      ["E", 10, 29],
      ["F", 0, 9],
    ],
  );
  for (let index = 1; index < RATING_TIERS.length; index += 1) {
    const higher = RATING_TIERS[index - 1];
    const lower = RATING_TIERS[index];
    assert.ok(higher && lower);
    assert.equal(lower.max + 1, higher.min, "no gap between the tiers");
  }
});

test("the eleven control rows equal spec 7.1 cell for cell", () => {
  const expected: [number, number, number, number, string][] = [
    // index, growth pp, FR multiplier, step limit pp, name
    [0, -2.5, 1.5, 17.5, "Total control"],
    [1, -2.0, 1.4, 16.0, "Command economy"],
    [2, -1.5, 1.3, 14.5, "Heavy dirigisme"],
    [3, -1.0, 1.2, 13.0, "Dirigisme"],
    [4, -0.5, 1.1, 11.5, "Guided market"],
    [5, 0.0, 1.0, 10.0, "Policy of balance"],
    [6, 0.5, 0.9, 8.5, "Regulated market"],
    [7, 1.0, 0.8, 7.0, "Social market"],
    [8, 1.5, 0.7, 5.5, "Free market"],
    [9, 2.0, 0.6, 4.0, "Laissez-faire"],
    [10, 2.5, 0.5, 2.5, "Minarchism"],
  ];
  assert.equal(CONTROL_BANDS.length, 11);
  for (const [index, growth, multiplier, step, name] of expected) {
    assert.ok(Math.abs(controlGrowthPpOf(index) - growth) < 1e-9, "growth at " + index);
    assert.ok(Math.abs(controlFrMultiplierOf(index) - multiplier) < 1e-9, "FR at " + index);
    assert.ok(Math.abs(stepLimitPpOf(index) - step) < 1e-9, "step at " + index);
    assert.equal(CONTROL_BANDS[index]?.name, name);
  }
});

test("the control bands are contiguous and cover 0..100", () => {
  assert.equal(CONTROL_BANDS[0]?.min, 0);
  assert.equal(CONTROL_BANDS[10]?.max, 100);
  for (let index = 1; index < CONTROL_BANDS.length; index += 1) {
    const previous = CONTROL_BANDS[index - 1];
    const current = CONTROL_BANDS[index];
    assert.ok(previous && current);
    assert.equal(previous.max + 1, current.min, "no gap before band " + index);
  }
  // Band 50 is a single value, and it is the neutral one.
  assert.equal(CONTROL_BANDS[5]?.min, 50);
  assert.equal(CONTROL_BANDS[5]?.max, 50);
});

test("the seven debt rows equal spec 2.9, monotone in both columns", () => {
  assert.deepEqual(DEBT_TERMS["A+"], { limitMultiple: 4.0, ratePct: 4.0, termTurns: 10 });
  assert.deepEqual(DEBT_TERMS.A, { limitMultiple: 3.0, ratePct: 8.0, termTurns: 8 });
  // Ruling 2: tier B stays 2,25 x income, and the 12,00% rate is the sourced one.
  assert.deepEqual(DEBT_TERMS.B, { limitMultiple: 2.25, ratePct: 12.0, termTurns: 6 });
  assert.deepEqual(DEBT_TERMS.C, { limitMultiple: 1.5, ratePct: 17.0, termTurns: 4 });
  assert.deepEqual(DEBT_TERMS.D, { limitMultiple: 1.0, ratePct: 23.0, termTurns: 3 });
  assert.deepEqual(DEBT_TERMS.E, { limitMultiple: 0.5, ratePct: 30.0, termTurns: 2 });
  // Tier F's cells are numbers, never absences, so DerivedEconomy stays total.
  assert.deepEqual(DEBT_TERMS.F, { limitMultiple: 0.0, ratePct: 0.0, termTurns: 0 });
});

test("the dependency matrix is spec 13.2 verbatim and its inversion round-trips", () => {
  const expected: [ResourceKey, SectorKey[]][] = [
    ["coal", ["heavyIndustry", "lightIndustry", "extraction"]],
    ["oil", ["heavyIndustry"]],
    ["fibre", ["agriculture", "commercial"]],
    ["ferrous", ["heavyIndustry", "lightIndustry"]],
    ["nonferrous", ["heavyIndustry", "lightIndustry"]],
    ["rubber", ["heavyIndustry"]],
    ["chemical", ["agriculture", "heavyIndustry", "lightIndustry"]],
    ["precious", ["commercial"]],
  ];
  for (const [resource, sectors] of expected) {
    assert.deepEqual([...RESOURCE_DEPENDENTS[resource]], sectors, resource);
  }

  // Both directions: the inversion is computed at module load, so this is the
  // only guard against the two tables drifting apart.
  for (const [resource, sectors] of expected) {
    for (const sector of sectors) {
      assert.ok(
        SECTOR_DEPENDENCIES[sector].includes(resource),
        sector + " must depend on " + resource,
      );
    }
  }
  for (const sector of Object.keys(SECTOR_DEPENDENCIES) as SectorKey[]) {
    for (const resource of SECTOR_DEPENDENCIES[sector]) {
      assert.ok(
        RESOURCE_DEPENDENTS[resource].includes(sector),
        resource + " must list " + sector,
      );
    }
  }

  assert.deepEqual([...SECTOR_DEPENDENCIES.agriculture], ["fibre", "chemical"]);
  assert.deepEqual(
    [...SECTOR_DEPENDENCIES.lightIndustry],
    ["coal", "ferrous", "nonferrous", "chemical"],
  );
  assert.deepEqual(
    [...SECTOR_DEPENDENCIES.heavyIndustry],
    ["coal", "oil", "ferrous", "nonferrous", "rubber", "chemical"],
  );
  assert.deepEqual([...SECTOR_DEPENDENCIES.commercial], ["fibre", "precious"]);
  assert.deepEqual([...SECTOR_DEPENDENCIES.extraction], ["coal"]);
  // An Other sector has no resource dependency at all.
  assert.deepEqual([...SECTOR_DEPENDENCIES.other1], []);
  assert.deepEqual([...SECTOR_DEPENDENCIES.other2], []);
});

test("the per-sector weight sums equal spec 13.4's precomputed table", () => {
  const sums: [SectorKey, number][] = [
    ["agriculture", 0.833333],
    ["lightIndustry", 1.666667],
    ["heavyIndustry", 3.666667],
    ["commercial", 1.5],
    ["extraction", 0.333333],
    ["other1", 0],
    ["other2", 0],
  ];
  for (const [sector, expected] of sums) {
    let total = 0;
    for (const resource of SECTOR_DEPENDENCIES[sector]) {
      total += RESOURCE_WEIGHTS[resource];
    }
    assert.ok(Math.abs(total - expected) < 1e-6, sector + " weight sum: got " + total);
  }
  assert.equal(RESOURCE_KEYS.length, 8);
});

test("concessions are limited to exactly the four sourced regions", () => {
  assert.deepEqual([...CONCESSION_REGIONS], ["bengo", "aglan", "sudhara", "badiyat"]);
});
