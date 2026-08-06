import assert from "node:assert/strict";
import test from "node:test";
import { createInitialEconomy } from "./economy-state";
import {
  deriveActionStage,
  deriveConcessionStage,
  nationalizationAvailableOf,
  privatizationAvailableOf,
} from "./actions";
import type { EconomyState, PendingAction } from "./types";

function withAction(action: PendingAction | null): EconomyState {
  return { ...createInitialEconomy(), pendingAction: action };
}

test("nationalization pays a fraction of THIS turn's income in its own currency", () => {
  const civilian = deriveActionStage(
    withAction({ kind: "nationalization", enterprise: "civilian", roll: 10 }),
    5,
    1000,
    200,
  );
  // The full 26,25% at a roll of 10.
  assert.ok(Math.abs(civilian.natFrPayout - 262.5) < 1e-9);
  assert.equal(civilian.natMicPayout, 0);

  const military = deriveActionStage(
    withAction({ kind: "nationalization", enterprise: "military", roll: 4 }),
    5,
    1000,
    200,
  );
  assert.equal(military.natFrPayout, 0);
  assert.ok(Math.abs(military.natMicPayout - 200 * 0.2625 * 0.4) < 1e-9);
});

test("nationalization always succeeds structurally and always costs 4 rating", () => {
  const stage = deriveActionStage(
    withAction({ kind: "nationalization", enterprise: "civilian", roll: 1 }),
    5,
    1000,
    200,
  );
  assert.equal(stage.success, true);
  assert.deepEqual(stage.ratingDeltas, [{ reason: "Nationalization", points: -4 }]);
  assert.equal(stage.controlShift, -3);
  assert.equal(stage.timedModifier?.growthPp, -0.75);
  assert.equal(stage.timedModifier?.turnsRemaining, 2);
});

test("privatization turns on the roll: 5 fails, 6 succeeds", () => {
  const failed = deriveActionStage(
    withAction({ kind: "privatization", enterprise: "civilian", roll: 5 }),
    5,
    1000,
    200,
  );
  assert.equal(failed.success, false);
  assert.equal(failed.timedModifier?.growthPp, -0.25);
  assert.deepEqual(failed.ratingDeltas, [{ reason: "Failed privatization", points: -2 }]);
  assert.equal(failed.controlShift, 0);
  assert.equal(failed.privatizationFrDragTurns, 0);

  const succeeded = deriveActionStage(
    withAction({ kind: "privatization", enterprise: "civilian", roll: 6 }),
    5,
    1000,
    200,
  );
  assert.equal(succeeded.success, true);
  assert.ok(Math.abs((succeeded.timedModifier?.growthPp ?? 0) - 0.45) < 1e-9);
  assert.deepEqual(succeeded.ratingDeltas, []);
  assert.equal(succeeded.controlShift, 3);
  assert.equal(succeeded.privatizationFrDragTurns, 3);
  assert.equal(succeeded.privatizationMicDragTurns, 0);
});

test("a military privatization drags MIC, not FR", () => {
  const stage = deriveActionStage(
    withAction({ kind: "privatization", enterprise: "military", roll: 9 }),
    5,
    1000,
    200,
  );
  assert.equal(stage.privatizationFrDragTurns, 0);
  assert.equal(stage.privatizationMicDragTurns, 3);
});

test("the cooldown and the control-scale lockout gate availability", () => {
  const fresh = createInitialEconomy();
  assert.equal(nationalizationAvailableOf(fresh, 5), true);
  assert.equal(privatizationAvailableOf(fresh, 5), true);

  const justActed = { ...fresh, turnsSinceNationalization: 1, turnsSincePrivatization: 1 };
  assert.equal(nationalizationAvailableOf(justActed, 5), false);
  assert.equal(privatizationAvailableOf(justActed, 5), false);

  // Band 0: everything worth seizing is already state-owned.
  assert.equal(nationalizationAvailableOf(fresh, 0), false);
  assert.equal(privatizationAvailableOf(fresh, 0), true);
  // Band 10: there is nothing left in state hands.
  assert.equal(nationalizationAvailableOf(fresh, 10), true);
  assert.equal(privatizationAvailableOf(fresh, 10), false);
});

test("an unavailable action or a malformed roll resolves nothing", () => {
  const locked = { ...withAction({ kind: "privatization", enterprise: "civilian", roll: 9 }) };
  const stage = deriveActionStage(locked, 10, 1000, 200);
  assert.equal(stage.resolved, false);
  assert.equal(stage.controlShift, 0);
  assert.equal(stage.timedModifier, null);

  const badRoll = deriveActionStage(
    withAction({ kind: "privatization", enterprise: "civilian", roll: 11 }),
    5,
    1000,
    200,
  );
  assert.equal(badRoll.resolved, false);

  const nanRoll = deriveActionStage(
    withAction({ kind: "nationalization", enterprise: "civilian", roll: Number.NaN }),
    5,
    1000,
    200,
  );
  assert.equal(nanRoll.resolved, false);
  assert.equal(nanRoll.natFrPayout, 0);
});

test("no pending action resolves nothing at all", () => {
  const stage = deriveActionStage(withAction(null), 5, 1000, 200);
  assert.equal(stage.kind, null);
  assert.equal(stage.resolved, false);
  assert.deepEqual(stage.ratingDeltas, []);
});

test("a concession needs both a sourced region and a sector that exists", () => {
  const base = createInitialEconomy();

  const wrongRegion = {
    ...base,
    region: "none" as const,
    pendingConcession: { sectorKey: "agriculture" as const },
  };
  assert.equal(deriveConcessionStage(wrongRegion).granted, false);
  assert.equal(deriveConcessionStage(wrongRegion).concessionGrowthPp, 0);

  const missingSector = {
    ...base,
    region: "bengo" as const,
    pendingConcession: { sectorKey: "other2" as const },
  };
  assert.equal(deriveConcessionStage(missingSector).granted, false);

  const good = {
    ...base,
    region: "aglan" as const,
    pendingConcession: { sectorKey: "commercial" as const },
  };
  const stage = deriveConcessionStage(good);
  assert.equal(stage.granted, true);
  assert.equal(stage.sectorKey, "commercial");
  // The +1,50 pp applies from the GRANT turn onward.
  assert.equal(stage.concessionGrowthPp, 1.5);
});

test("the concession bonus does not stack across grants (guard G20)", () => {
  const state = {
    ...createInitialEconomy(),
    region: "sudhara" as const,
    pendingConcession: { sectorKey: "extraction" as const },
    concessions: [
      { id: 1, sectorKey: "agriculture" as const, gdpTransferredObor: 1, grantedTurn: 1, active: true },
      { id: 2, sectorKey: "commercial" as const, gdpTransferredObor: 1, grantedTurn: 2, active: true },
    ],
  };
  assert.equal(deriveConcessionStage(state).concessionGrowthPp, 1.5);
});

test("an inactive concession grants no bonus", () => {
  const state = {
    ...createInitialEconomy(),
    concessions: [
      { id: 1, sectorKey: "agriculture" as const, gdpTransferredObor: 1, grantedTurn: 1, active: false },
    ],
  };
  assert.equal(deriveConcessionStage(state).concessionGrowthPp, 0);
});
