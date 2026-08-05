import assert from "node:assert/strict";
import test from "node:test";
import { createInitialEconomy } from "./economy-state";
import { deriveEconomy } from "./derive";
import type { EconomyState, ResourceKey } from "./types";

// V1 through V13 abort the turn; V14 through V20 are warnings that let it run.
// Every rule is checked both ways here — that it fires when it should, and that
// a healthy sheet raises nothing.

const DEPOSITS: Record<ResourceKey, number> = {
  coal: 2, oil: 1, fibre: 1, ferrous: 1,
  nonferrous: 1, rubber: 1, chemical: 2, precious: 1,
};

function healthy(): EconomyState {
  const state = createInitialEconomy();
  state.resources = state.resources.map((resource) => {
    return { ...resource, deposits: DEPOSITS[resource.key] };
  });
  return state;
}

function codesOf(state: EconomyState): string[] {
  return deriveEconomy(state).errors.map((error) => {
    return error.code;
  });
}

test("a healthy sheet raises no error and no warning", () => {
  const derived = deriveEconomy(healthy());
  assert.deepEqual(derived.errors, []);
  assert.deepEqual(derived.warnings, []);
});

test("V1 and V2 bound emission and military spending, NaN included", () => {
  assert.ok(codesOf({ ...healthy(), emissionPct: 60 }).includes("V1"));
  assert.ok(codesOf({ ...healthy(), emissionPct: -1 }).includes("V1"));
  assert.ok(codesOf({ ...healthy(), emissionPct: Number.NaN }).includes("V1"));
  assert.ok(codesOf({ ...healthy(), militaryPct: 61 }).includes("V2"));
  assert.ok(codesOf({ ...healthy(), militaryPct: Number.NaN }).includes("V2"));
});

test("V3 and V4 make the step a hard cap, not a clamp", () => {
  // At band 5 the limit is 10,00 pp on both levers.
  const bigEmission = { ...healthy(), emissionPct: 11, emissionPctLast: 0 };
  assert.ok(codesOf(bigEmission).includes("V3"));
  // The value the player typed is left exactly where it was.
  assert.equal(bigEmission.emissionPct, 11);
  assert.equal(codesOf({ ...healthy(), emissionPct: 10, emissionPctLast: 0 }).includes("V3"), false);

  assert.ok(codesOf({ ...healthy(), militaryPct: 21, militaryPctLast: 10 }).includes("V4"));
  // Mobilization is the one exception, and it widens only the military step.
  const mobilized = { ...healthy(), mobilized: true, militaryPct: 30, militaryPctLast: 10 };
  assert.equal(codesOf(mobilized).includes("V4"), false);
});

test("V5 and V6 abort an overspent ledger rather than clamping it (guard G13)", () => {
  const overFr = healthy();
  overFr.frExpenseLines = [{ label: "too much", points: 999999 }];
  assert.ok(codesOf(overFr).includes("V5"));

  const overMic = healthy();
  overMic.micExpenseLines = [{ label: "too much", points: 999999 }];
  assert.ok(codesOf(overMic).includes("V6"));
});

test("V7 fires only on a country actually asking for money", () => {
  const tooMuch = { ...healthy(), borrowRequest: 999999 };
  assert.ok(codesOf(tooMuch).includes("V7"));

  const inDefault = { ...healthy(), borrowRequest: 100, debtStatus: "default" as const };
  assert.ok(codesOf(inDefault).includes("V7"));

  const bankrupt = { ...healthy(), ratingScore: 5, borrowRequest: 100 };
  assert.ok(codesOf(bankrupt).includes("V7"));

  // A tier-F country with no request must still be able to end its turn.
  const quiet = { ...healthy(), ratingScore: 5, borrowRequest: 0 };
  assert.equal(codesOf(quiet).includes("V7"), false);

  assert.ok(codesOf({ ...healthy(), borrowRequest: Number.NaN }).includes("V7"));
});

test("V8 enforces the cooldown and the lockout, V9 the roll", () => {
  const onCooldown = {
    ...healthy(),
    turnsSincePrivatization: 1,
    pendingAction: { kind: "privatization" as const, enterprise: "civilian" as const, roll: 7 },
  };
  assert.ok(codesOf(onCooldown).includes("V8"));

  const lockedOut = {
    ...healthy(),
    controlPosition: 100,
    pendingAction: { kind: "privatization" as const, enterprise: "civilian" as const, roll: 7 },
  };
  assert.ok(codesOf(lockedOut).includes("V8"));

  for (const roll of [0, 11, 4.5, Number.NaN]) {
    const bad = {
      ...healthy(),
      pendingAction: { kind: "nationalization" as const, enterprise: "civilian" as const, roll },
    };
    assert.ok(codesOf(bad).includes("V9"), "roll " + roll);
  }
});

test("V10 requires grounds for an Other sector", () => {
  const noGrounds = healthy();
  noGrounds.sectors = [
    ...noGrounds.sectors,
    {
      key: "other1",
      name: "Aerospace",
      grounds: "   ",
      gdpObor: 1000000,
      growthPermanentPct: 3,
      growthTemporaryPct: 0,
    },
  ];
  assert.ok(codesOf(noGrounds).includes("V10"));

  const withGrounds = healthy();
  withGrounds.sectors = [
    ...withGrounds.sectors,
    {
      key: "other1",
      name: "Aerospace",
      grounds: "a strategic programme",
      gdpObor: 1000000,
      growthPermanentPct: 3,
      growthTemporaryPct: 0,
    },
  ];
  assert.equal(codesOf(withGrounds).includes("V10"), false);
});

test("V11 gates a concession on the region and on the named sector", () => {
  const wrongRegion = {
    ...healthy(),
    pendingConcession: { sectorKey: "agriculture" as const },
  };
  assert.ok(codesOf(wrongRegion).includes("V11"));

  const missingSector = {
    ...healthy(),
    region: "bengo" as const,
    pendingConcession: { sectorKey: "other1" as const },
  };
  assert.ok(codesOf(missingSector).includes("V11"));

  const fine = {
    ...healthy(),
    region: "badiyat" as const,
    pendingConcession: { sectorKey: "extraction" as const },
  };
  assert.equal(codesOf(fine).includes("V11"), false);
});

test("V12 rejects every negative or non-finite quantity input", () => {
  const negativeSector = healthy();
  negativeSector.sectors = negativeSector.sectors.map((sector, index) => {
    return index === 0 ? { ...sector, gdpObor: -1 } : sector;
  });
  assert.ok(codesOf(negativeSector).includes("V12"));

  assert.ok(codesOf({ ...healthy(), reserveAdd: -5 }).includes("V12"));
  assert.ok(codesOf({ ...healthy(), micStockAdd: Number.NaN }).includes("V12"));

  const badLine = healthy();
  badLine.frIncomeLines = [{ label: "sale", points: -100 }];
  assert.ok(codesOf(badLine).includes("V12"));

  const badResource = healthy();
  badResource.resources = badResource.resources.map((resource, index) => {
    return index === 0 ? { ...resource, exports: -3 } : resource;
  });
  assert.ok(codesOf(badResource).includes("V12"));
});

test("V13 keeps the rating and the control position whole and in range", () => {
  assert.ok(codesOf({ ...healthy(), ratingScore: 70.5 }).includes("V13"));
  assert.ok(codesOf({ ...healthy(), ratingScore: 101 }).includes("V13"));
  assert.ok(codesOf({ ...healthy(), controlPosition: -1 }).includes("V13"));
  assert.ok(codesOf({ ...healthy(), controlPosition: Number.NaN }).includes("V13"));
});

test("the derive pass is total: every error is collected, not just the first", () => {
  const broken = {
    ...healthy(),
    emissionPct: 90,
    militaryPct: 90,
    ratingScore: 200,
    controlPosition: -4,
  };
  const codes = codesOf(broken);
  assert.ok(codes.includes("V1"));
  assert.ok(codes.includes("V2"));
  assert.ok(codes.includes("V13"));
  assert.ok(codes.length >= 4, "step 1 reports the complete list");
});

test("the derive pass never throws and never yields a non-finite [A] value", () => {
  const poisoned = {
    ...healthy(),
    emissionPct: Number.NaN,
    militaryPct: Number.POSITIVE_INFINITY,
    reserveFr: Number.NaN,
    micStock: Number.NEGATIVE_INFINITY,
    ratingScore: Number.NaN,
    controlPosition: Number.NaN,
  };
  const derived = deriveEconomy(poisoned);
  assert.ok(derived.errors.length > 0);
  for (const [key, value] of Object.entries(derived)) {
    if (typeof value === "number") {
      assert.ok(Number.isFinite(value), key + " is non-finite: " + value);
    }
  }
});

test("V14 through V20 are warnings, and the turn still resolves", () => {
  const clipped = healthy();
  // Over the cap, so the addition is blocked entirely rather than clipped to a
  // headroom the budget could not have afforded anyway.
  clipped.reserveFr = 50000;
  clipped.reserveAdd = 10;
  clipped.micStock = 5;
  clipped.micStockWithdraw = 50;
  clipped.resources = clipped.resources.map((resource) => {
    return resource.key === "oil" ? { ...resource, exports: 9999 } : resource;
  });

  const derived = deriveEconomy(clipped);
  assert.deepEqual(derived.errors, []);
  const codes = derived.warnings.map((warning) => {
    return warning.slice(0, 3);
  });
  assert.ok(codes.includes("V14"));
  assert.ok(codes.includes("V15"));
  assert.ok(codes.includes("V19"));
});
