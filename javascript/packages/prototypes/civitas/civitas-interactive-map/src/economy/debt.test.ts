import assert from "node:assert/strict";
import test from "node:test";
import { createInitialEconomy } from "./economy-state";
import { deriveBorrowStage, deriveDebtServiceStage, nextStatusOf } from "./debt";
import type { EconomyState, Loan } from "./types";

function loan(overrides: Partial<Loan>): Loan {
  return {
    id: 1,
    principal: 6000,
    ratePct: 12,
    termTurns: 6,
    turnsRemaining: 4,
    createdTurn: 2,
    allocatedFr: 0,
    ...overrides,
  };
}

function stateWith(loans: Loan[], overrides: Partial<EconomyState> = {}): EconomyState {
  return { ...createInitialEconomy(), turn: 4, loans, ...overrides };
}

test("the limit is a multiple of income and the outstanding loans eat into it", () => {
  const stage = deriveBorrowStage(stateWith([loan({})]), "B", 15483.197826);
  assert.ok(Math.abs(stage.debtLimit - 34837.1951085) < 1e-6);
  assert.equal(stage.debtOutstanding, 6000);
  assert.ok(Math.abs(stage.newLoanAvailable - 28837.1951085) < 1e-6);
  assert.equal(stage.newLoanRatePct, 12);
  assert.equal(stage.newLoanTermTurns, 6);
});

test("tier F borrows nothing and its terms are numbers, not absences", () => {
  const stage = deriveBorrowStage(
    stateWith([], { borrowRequest: 100 }),
    "F",
    10000,
  );
  assert.equal(stage.debtLimit, 0);
  assert.equal(stage.newLoanAvailable, 0);
  assert.equal(stage.newLoanRatePct, 0);
  assert.equal(stage.newLoanTermTurns, 0);
  assert.equal(stage.createdLoan, null);
});

test("a country in default cannot borrow until a clean turn closes", () => {
  const stage = deriveBorrowStage(
    stateWith([], { borrowRequest: 100, debtStatus: "default" }),
    "B",
    10000,
  );
  assert.equal(stage.createdLoan, null);
  assert.equal(stage.newLoanProceeds, 0);
});

test("an accepted loan locks its rate and term at the moment of borrowing", () => {
  const stage = deriveBorrowStage(
    stateWith([], { borrowRequest: 5000, nextLoanId: 7 }),
    "C",
    10000,
  );
  assert.ok(stage.createdLoan);
  assert.equal(stage.createdLoan.id, 7);
  assert.equal(stage.createdLoan.principal, 5000);
  assert.equal(stage.createdLoan.ratePct, 17);
  assert.equal(stage.createdLoan.termTurns, 4);
  assert.equal(stage.createdLoan.turnsRemaining, 4);
  assert.equal(stage.createdLoan.createdTurn, 4);
  assert.equal(stage.newLoanProceeds, 5000);
});

test("a loan created THIS turn is not serviced this turn", () => {
  const stage = deriveDebtServiceStage(
    stateWith([loan({ createdTurn: 4 })]),
    100000,
  );
  const service = stage.loanService[0];
  assert.ok(service);
  assert.equal(service.serviced, false);
  assert.equal(service.requiredFr, 0);
  assert.equal(service.allocatedFr, 0);
  assert.equal(service.principalNext, 6000, "the principal does not move");
  assert.equal(service.turnsRemainingNext, 4, "the term does not tick");
  assert.equal(stage.requiredTotal, 0);
  assert.equal(stage.shortfallTotal, 0);
});

test("straight-line amortisation over the remaining term closes at exactly 0", () => {
  let principal = 6000;
  let turnsRemaining = 4;
  for (let turn = 5; turn <= 8; turn += 1) {
    const stage = deriveDebtServiceStage(
      stateWith([loan({ principal, turnsRemaining, createdTurn: 2 })], { turn }),
      1000000,
    );
    const service = stage.loanService[0];
    assert.ok(service);
    assert.equal(service.shortfall, 0);
    principal = service.principalNext;
    turnsRemaining = service.turnsRemainingNext;
  }
  assert.ok(Math.abs(principal) < 1e-9, "the loan closes at exactly 0, got " + principal);
  assert.equal(turnsRemaining, 0);
});

test("a matured loan divides by 1, not by 0 (guard G4)", () => {
  const stage = deriveDebtServiceStage(
    stateWith([loan({ principal: 1000, turnsRemaining: 0 })]),
    0,
  );
  const service = stage.loanService[0];
  assert.ok(service);
  // The whole principal plus its full interest, every turn, until it is cleared.
  assert.ok(Math.abs(service.requiredFr - 1120) < 1e-9);
  assert.ok(Number.isFinite(service.principalNext));
});

test("unpaid interest capitalises into the principal", () => {
  const stage = deriveDebtServiceStage(
    stateWith([loan({ principal: 1000, ratePct: 20, turnsRemaining: 5 })]),
    0,
  );
  const service = stage.loanService[0];
  assert.ok(service);
  assert.equal(service.allocatedFr, 0);
  assert.equal(service.interestPaid, 0);
  // 1000 - 0 + (200 - 0) = 1200. That is the debt spiral, with no extra rule.
  assert.ok(Math.abs(service.principalNext - 1200) < 1e-9);
});

test("a short balance starves the NEWEST loan, not all of them equally", () => {
  const stage = deriveDebtServiceStage(
    stateWith([
      loan({ id: 1, principal: 1000, ratePct: 10, turnsRemaining: 1 }),
      loan({ id: 2, principal: 1000, ratePct: 10, turnsRemaining: 1 }),
    ]),
    1100,
  );
  const first = stage.loanService[0];
  const second = stage.loanService[1];
  assert.ok(first && second);
  assert.ok(Math.abs(first.allocatedFr - 1100) < 1e-9, "the oldest is paid first");
  assert.equal(first.shortfall, 0);
  assert.equal(second.allocatedFr, 0);
  assert.ok(Math.abs(second.shortfall - 1100) < 1e-9);
});

test("the shortfall penalty ceils and caps at 10", () => {
  // A tenth missed costs 1.
  const tenth = deriveDebtServiceStage(
    stateWith([loan({ principal: 1000, ratePct: 0, turnsRemaining: 1 })]),
    900,
  );
  assert.equal(tenth.ratingPenalty, 1);

  // Everything missed costs the full tier drop.
  const all = deriveDebtServiceStage(
    stateWith([loan({ principal: 1000, ratePct: 0, turnsRemaining: 1 })]),
    0,
  );
  assert.equal(all.ratingPenalty, 10);

  // No loan, no penalty and no division (guard G5).
  const none = deriveDebtServiceStage(stateWith([]), 0);
  assert.equal(none.ratingPenalty, 0);
  assert.equal(none.requiredTotal, 0);
});

test("the three-state machine walks normal, arrears, default and back", () => {
  assert.equal(nextStatusOf(0, false), "normal");
  assert.equal(nextStatusOf(0, true), "normal", "one clean turn clears the arrears");
  assert.equal(nextStatusOf(10, false), "arrears");
  assert.equal(nextStatusOf(10, true), "default");
});

test("manual allocation is not clamped, and a shortfall raises V17", () => {
  const stage = deriveDebtServiceStage(
    stateWith([loan({ principal: 1000, ratePct: 10, turnsRemaining: 1 })], {
      debtAutoService: false,
      loans: [loan({ principal: 1000, ratePct: 10, turnsRemaining: 1, allocatedFr: 500 })],
    }),
    100000,
  );
  const service = stage.loanService[0];
  assert.ok(service);
  assert.equal(service.allocatedFr, 500);
  assert.ok(Math.abs(service.shortfall - 600) < 1e-9);
  assert.ok(stage.warnings.some((warning) => {
    return warning.startsWith("V17");
  }));
  assert.equal(stage.statusNext, "arrears");
  assert.equal(stage.defaultLastTurnNext, true);
});
