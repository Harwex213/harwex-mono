import assert from "node:assert/strict";
import test from "node:test";
import { autoInvestGrowthPp, deriveSavingsStage, deriveUpkeepStage, investedOborOf } from "./savings";
import { createInitialEconomy } from "./economy-state";
import type { EconomyState } from "./types";

function stateWith(overrides: Partial<EconomyState>): EconomyState {
  return { ...createInitialEconomy(), ...overrides };
}

test("the cap is two annual incomes and the addition is clipped to the headroom", () => {
  const stage = deriveSavingsStage(
    stateWith({ reserveFr: 3000, reserveAdd: 100000 }),
    10000,
    100000000,
  );
  assert.equal(stage.reserveCap, 20000);
  assert.equal(stage.reserveAddApplied, 17000);
  assert.equal(stage.reserveEnd, 20000);
  assert.ok(stage.warnings.some((warning) => {
    return warning.startsWith("V14");
  }));
});

test("the stock survives a cap that falls below it, and blocks further additions", () => {
  const stage = deriveSavingsStage(
    stateWith({ reserveFr: 50000, reserveAdd: 1 }),
    10000,
    100000000,
  );
  assert.equal(stage.reserveCap, 20000);
  // Blocked ENTIRELY while over the cap, not clipped to zero headroom.
  assert.equal(stage.reserveAddApplied, 0);
  assert.equal(stage.reserveEnd, 50000, "the stock itself is untouched");
});

test("a withdrawal is clipped to the stock, never to a negative reserve", () => {
  const stage = deriveSavingsStage(
    stateWith({ reserveFr: 500, reserveWithdraw: 900 }),
    10000,
    100000000,
  );
  assert.equal(stage.reserveWithdrawApplied, 500);
  assert.equal(stage.reserveEnd, 0);
});

test("the reserve penalty is 3,00 x the share of GDP the reserve represents", () => {
  const stage = deriveSavingsStage(
    stateWith({ reserveFr: 3500 }),
    15483.197826,
    106000000,
  );
  // 3,00 x (3 500 x 2 000 / 106 000 000)
  assert.ok(Math.abs(stage.reservePenaltyPp - 0.1981132075) < 1e-9);
});

test("a full reserve costs about 1,20 pp and never more", () => {
  const income = 10000;
  const stage = deriveSavingsStage(
    stateWith({ reserveFr: 2 * income }),
    income,
    100000000,
  );
  // 2 annual incomes is 40 000 000 obor against 100 000 000 of GDP.
  assert.ok(Math.abs(stage.reservePenaltyPp - 1.2) < 1e-9);
});

test("a stockpile withdrawal is clipped to the stock and raises V15", () => {
  const stage = deriveSavingsStage(
    stateWith({ micStock: 40, micStockWithdraw: 90, micStockAdd: 10 }),
    10000,
    100000000,
  );
  assert.equal(stage.micStockWithdrawApplied, 40);
  assert.equal(stage.micStockEndPreUpkeep, 10);
  assert.equal(stage.micUpkeepDue, 20);
  assert.ok(stage.warnings.some((warning) => {
    return warning.startsWith("V15");
  }));
});

test("unpaid upkeep loses only the points the budget could not cover", () => {
  // 101 FR buys 50 points at 2 FR each; 50 of the 100 held are lost.
  const stage = deriveUpkeepStage(100, 101);
  assert.equal(stage.micPointsPaidFor, 50);
  assert.equal(stage.micStockLost, 50);
  assert.equal(stage.micStockEnd, 50);
  assert.equal(stage.micUpkeepPaid, 100);
  assert.ok(stage.warnings.some((warning) => {
    return warning.startsWith("V16");
  }));
});

test("upkeep can never push the balance negative (guard G28)", () => {
  for (const balance of [0, 1, 1.99, 3, 99.5, -50]) {
    const stage = deriveUpkeepStage(100, balance);
    assert.ok(
      stage.micUpkeepPaid <= Math.max(0, balance) + 1e-9,
      "paid " + stage.micUpkeepPaid + " out of " + balance,
    );
    assert.ok(stage.micStockEnd >= 0, "the stock never goes negative");
    assert.ok(stage.micStockLost <= 100);
  }
});

test("a covered stockpile loses nothing and raises no warning", () => {
  const stage = deriveUpkeepStage(50, 12763.197826);
  assert.equal(stage.micStockLost, 0);
  assert.equal(stage.micUpkeepPaid, 100);
  assert.deepEqual(stage.warnings, []);
});

test("auto-investment values a MIC point at 25 FR points", () => {
  assert.equal(investedOborOf(1, 0), 2000);
  assert.equal(investedOborOf(0, 1), 50000);
  assert.equal(investedOborOf(10017, 233.2), 31694000);
  assert.ok(Math.abs(autoInvestGrowthPp(10017, 233.2, 100000000) - 0.63388) < 1e-9);
});

test("auto-investment divides by nothing on a zero-GDP country (guard G1)", () => {
  assert.equal(autoInvestGrowthPp(1000, 100, 0), 0);
});
