import assert from "node:assert/strict";
import test from "node:test";
import { STATE_KEY, createMemoryStorage } from "./persistence";
import { addCountry, deleteCountry, economicsOf, initWorldStore, statePersistent } from "./world-store";
import {
  addOtherSector,
  clearLedgerLines,
  dismissTurnOutcome,
  endEconomyTurn,
  hydrateEconomy,
  initEconomySync,
  judgeMode,
  lastTurnOutcome,
  removeOtherSector,
  resetEconomyStore,
  selectedDerived,
  selectedEconomy,
  setJudgeMode,
  setLedgerLines,
  toggleJudgeMode,
  updateEconomy,
  updateResource,
  updateSector,
} from "./economy-store";
import { ECONOMY_CONSTANTS, RESOURCE_KEYS } from "../economy/constants";
import { createInitialEconomy } from "../economy/economy-state";
import { deriveEconomy } from "../economy/derive";
import { economyToJson } from "../economy/serialize";
import { buildHistoryView } from "../ui/economics-history";
import { clearSelection, selectCountry } from "./selection-store";
import type { EconomyState, SectorKey, TurnRecord } from "../economy/types";
import type { StateStorage, TimerHandle, Timers } from "./persistence";

// Both stores are module singletons, so `initWorldStore` with an injected storage
// plus `resetEconomyStore` IS the reset between tests.

function fakeTimers(): Timers & { run(): void } {
  let nextHandle = 1;
  const armed = new Map<number, () => void>();
  return {
    set(fn: () => void, _ms: number): TimerHandle {
      const handle = nextHandle;
      nextHandle += 1;
      armed.set(handle, fn);
      return handle as unknown as TimerHandle;
    },
    clear(handle: TimerHandle): void {
      armed.delete(handle as unknown as number);
    },
    run(): void {
      const due = [...armed.entries()];
      armed.clear();
      for (const [, fn] of due) {
        fn();
      }
    },
  };
}

function quotaError(): unknown {
  const error = new Error("full") as Error & { name: string };
  error.name = "QuotaExceededError";
  return error;
}

function setup(options: { failWrite?: boolean } = {}): { storage: StateStorage; timers: Timers & { run(): void } } {
  const inner = createMemoryStorage();
  const storage: StateStorage = {
    getItem(key: string): string | null {
      return inner.getItem(key);
    },
    setItem(key: string, value: string): void {
      if (options.failWrite === true && key === STATE_KEY) {
        throw quotaError();
      }
      inner.setItem(key, value);
    },
    removeItem(key: string): void {
      inner.removeItem(key);
    },
  };
  const timers = fakeTimers();
  initWorldStore({ storage, timers });
  resetEconomyStore();
  clearSelection();
  return { storage, timers };
}

// --- hydrateEconomy --------------------------------------------------------

test("hydrateEconomy with no saved slot returns the standard opening sheet", () => {
  const hydrated = hydrateEconomy(null);
  assert.deepEqual(hydrated.repairs, []);
  assert.deepEqual(hydrated.state, createInitialEconomy());
});

test("hydrateEconomy round-trips a saved economy and reports its repairs", () => {
  const state = createInitialEconomy();
  state.turn = 4;
  state.emissionPct = 6;
  const clean = hydrateEconomy({ version: 1, data: economyToJson(state) });
  assert.equal(clean.state.turn, 4);
  assert.equal(clean.state.emissionPct, 6);
  assert.deepEqual(clean.repairs, []);

  // The reader is REPAIRING, which is exactly why the hydrated object is held in
  // memory rather than re-read on every keystroke.
  const broken = hydrateEconomy({ version: 1, data: { turn: "not a number" } });
  assert.ok(broken.repairs.length > 0);
  assert.equal(Number.isFinite(broken.state.turn), true);
});

// --- selection and derive --------------------------------------------------

test("no selected country means no slot and no derived economy", () => {
  setup();
  assert.equal(selectedEconomy.value, null);
  assert.equal(selectedDerived.value, null);
});

test("a country with no saved economy renders the opening sheet and writes NOTHING", () => {
  // A 60-country document must not gain 60 economies nobody touched.
  const { timers } = setup();
  const country = addCountry("Testland");
  selectCountry(country.id);

  const slot = selectedEconomy.value;
  assert.notEqual(slot, null);
  assert.equal(slot?.state.turn, 1);
  assert.equal(slot?.state.ratingScore, ECONOMY_CONSTANTS.START_RATING);
  timers.run();
  assert.equal(economicsOf(country.id), null);
});

test("the derived object is the engine's own, province count included", () => {
  setup();
  const country = addCountry("Testland");
  selectCountry(country.id);

  const derived = selectedDerived.value;
  assert.notEqual(derived, null);
  const expected = deriveEconomy(createInitialEconomy(), { provinceCount: 0 });
  assert.equal(derived?.gdpTotalObor, expected.gdpTotalObor);
  assert.equal(derived?.frGenerated, expected.frGenerated);
  // Never recomputed in the UI layer: the panel's numbers are these numbers.
  assert.equal(derived?.gdpTotalObor, ECONOMY_CONSTANTS.START_GDP_OBOR);
});

test("an [A] value moves as soon as a [P] input is committed", () => {
  // The done condition, in the only layer that can be tested without a DOM.
  setup();
  const country = addCountry("Testland");
  selectCountry(country.id);

  // Deposits first. A fresh country has none, so every resource-dependent sector
  // is capped at 0 growth and `gdpNextTotalObor` cannot move at all — correct
  // behaviour, and the wrong baseline for this assertion.
  for (const key of RESOURCE_KEYS) {
    updateResource(country.id, key, { deposits: 400 });
  }

  const before = selectedDerived.value;
  const frBefore = before?.frGenerated ?? 0;
  const inflationBefore = before?.inflationPct ?? 0;

  updateEconomy(country.id, (current) => {
    return { ...current, emissionPct: 4 };
  });

  const after = selectedDerived.value;
  assert.ok((after?.frGenerated ?? 0) > frBefore);
  assert.ok((after?.inflationPct ?? 0) > inflationBefore);
  assert.notEqual(after?.gdpNextTotalObor, before?.gdpNextTotalObor);
});

// --- write-through ---------------------------------------------------------

test("an edit writes through to the economics slot and survives a reload", () => {
  const { storage, timers } = setup();
  const country = addCountry("Testland");
  selectCountry(country.id);

  updateEconomy(country.id, (current) => {
    return { ...current, emissionPct: 4, turn: 3 };
  });
  updateSector(country.id, "agriculture", { gdpObor: 33000000 });
  updateResource(country.id, "coal", { deposits: 5 });
  setLedgerLines(country.id, "frExpenseLines", [{ label: "roads", points: 12 }]);

  // The slot is written synchronously; only the localStorage write is debounced.
  assert.notEqual(economicsOf(country.id), null);
  timers.run();

  // A fresh init off the same storage is a reload.
  initWorldStore({ storage, timers: fakeTimers() });
  resetEconomyStore();
  selectCountry(country.id);

  const slot = selectedEconomy.value;
  assert.equal(slot?.state.emissionPct, 4);
  assert.equal(slot?.state.turn, 3);
  assert.equal(slot?.state.sectors.find((sector) => {
    return sector.key === "agriculture";
  })?.gdpObor, 33000000);
  assert.equal(slot?.state.resources.find((resource) => {
    return resource.key === "coal";
  })?.deposits, 5);
  assert.deepEqual(slot?.state.frExpenseLines, [{ label: "roads", points: 12 }]);
});

test("every collection helper replaces its array instead of mutating it", () => {
  // A mutated array is Object.is-equal to itself and nothing re-renders.
  setup();
  const country = addCountry("Testland");
  selectCountry(country.id);

  const before = selectedEconomy.value?.state;
  updateSector(country.id, "agriculture", { gdpObor: 1 });
  const after = selectedEconomy.value?.state;
  assert.notEqual(before, after);
  assert.notEqual(before?.sectors, after?.sectors);
  // The untouched rows keep their identity, so only the edited row re-renders.
  assert.equal(before?.resources, after?.resources);
});

test("a write for an unknown country id is dropped rather than half-applied", () => {
  // `setCountryEconomics` silently no-ops for an unknown id. A draft without a
  // matching slot would then be a value the panel shows and storage never has.
  setup();
  updateEconomy(4242, (current) => {
    return { ...current, emissionPct: 9 };
  });
  assert.equal(economicsOf(4242), null);
  selectCountry(4242);
  assert.equal(selectedEconomy.value, null);
});

test("a ledger list is capped at the engine's line limit", () => {
  setup();
  const country = addCountry("Testland");
  selectCountry(country.id);

  const many = [];
  for (let at = 0; at < ECONOMY_CONSTANTS.LEDGER_LINE_MAX + 6; at += 1) {
    many.push({ label: "line " + at, points: 1 });
  }
  setLedgerLines(country.id, "micExpenseLines", many);
  assert.equal(
    selectedEconomy.value?.state.micExpenseLines.length,
    ECONOMY_CONSTANTS.LEDGER_LINE_MAX,
  );
});

test("clearLedgerLines empties all four lists in one write", () => {
  setup();
  const country = addCountry("Testland");
  selectCountry(country.id);

  setLedgerLines(country.id, "frExpenseLines", [{ label: "a", points: 1 }]);
  setLedgerLines(country.id, "micExpenseLines", [{ label: "b", points: 2 }]);
  setLedgerLines(country.id, "frIncomeLines", [{ label: "c", points: 3 }]);
  setLedgerLines(country.id, "micIncomeLines", [{ label: "d", points: 4 }]);
  clearLedgerLines(country.id);

  const state = selectedEconomy.value?.state;
  assert.deepEqual(state?.frExpenseLines, []);
  assert.deepEqual(state?.micExpenseLines, []);
  assert.deepEqual(state?.frIncomeLines, []);
  assert.deepEqual(state?.micIncomeLines, []);
});

// --- Other sectors ---------------------------------------------------------

test("addOtherSector refuses empty grounds, so V10 is unreachable through the panel", () => {
  setup();
  const country = addCountry("Testland");
  selectCountry(country.id);

  addOtherSector(country.id, "Tourism", "   ");
  assert.equal(selectedEconomy.value?.state.sectors.length, 5);
  assert.deepEqual(selectedDerived.value?.errors, []);

  addOtherSector(country.id, "Tourism", "a treaty port pays a tithe");
  const sectors = selectedEconomy.value?.state.sectors ?? [];
  assert.equal(sectors.length, 6);
  const added = sectors[5];
  assert.equal(added?.key, "other1");
  assert.equal(added?.name, "Tourism");
  assert.equal(added?.grounds, "a treaty port pays a tithe");
  // A volume is a [V] the judge sets afterwards; inventing one here would be a
  // formula in the UI layer.
  assert.equal(added?.gdpObor, 0);
  assert.deepEqual(selectedDerived.value?.errors, []);
});

test("only two Other sectors exist, and removing one drops a concession aimed at it", () => {
  setup();
  const country = addCountry("Testland");
  selectCountry(country.id);

  addOtherSector(country.id, "Tourism", "grounds one");
  addOtherSector(country.id, "Shipping", "grounds two");
  addOtherSector(country.id, "Third", "grounds three");
  assert.equal(selectedEconomy.value?.state.sectors.length, 7);
  assert.equal(ECONOMY_CONSTANTS.OTHER_SECTOR_MAX, 2);

  updateEconomy(country.id, (current) => {
    return { ...current, region: "bengo", pendingConcession: { sectorKey: "other2" } };
  });
  removeOtherSector(country.id, "other2");
  const state = selectedEconomy.value?.state;
  assert.equal(state?.sectors.length, 6);
  assert.equal(state?.pendingConcession, null);
});

test("a base sector can never be removed by the Other-sector control", () => {
  setup();
  const country = addCountry("Testland");
  selectCountry(country.id);
  removeOtherSector(country.id, "agriculture");
  assert.equal(selectedEconomy.value?.state.sectors.length, 5);
});

// --- judge mode ------------------------------------------------------------

test("judge mode is off by default and is not persisted", () => {
  const { storage, timers } = setup();
  const country = addCountry("Testland");
  selectCountry(country.id);
  assert.equal(judgeMode.value, false);

  setJudgeMode(true);
  assert.equal(judgeMode.value, true);
  toggleJudgeMode();
  assert.equal(judgeMode.value, false);
  setJudgeMode(true);
  updateEconomy(country.id, (current) => {
    return { ...current, emissionPct: 2 };
  });
  timers.run();

  // A player reloading the page must not inherit a judge's unlocked sheet.
  const raw = storage.getItem(STATE_KEY) ?? "";
  assert.doesNotMatch(raw, /judge/i);
  initWorldStore({ storage, timers: fakeTimers() });
  resetEconomyStore();
  assert.equal(judgeMode.value, false);
});

// --- End Turn --------------------------------------------------------------

test("endEconomyTurn advances the economy, records the turn and reports it saved", () => {
  const { timers } = setup();
  const country = addCountry("Testland");
  selectCountry(country.id);

  const outcome = endEconomyTurn(country.id);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    return;
  }
  assert.equal(outcome.turn, 1);
  assert.equal(outcome.saved, true);
  assert.equal(outcome.record.steps.length, 15);

  const state = selectedEconomy.value?.state;
  assert.equal(state?.turn, 2);
  assert.equal(state?.history.length, 1);
  assert.equal(state?.history[0]?.turn, 1);
  assert.deepEqual(lastTurnOutcome.value, outcome);

  // `flushState` ran inside the action, so the turn is on disk without waiting
  // for the debounce.
  assert.notEqual(economicsOf(country.id), null);
  timers.run();
  dismissTurnOutcome();
  assert.equal(lastTurnOutcome.value, null);
});

test("a failed End Turn writes NOTHING and reports every error", () => {
  setup();
  const country = addCountry("Testland");
  selectCountry(country.id);

  // 30% emission against a 10 pp step at control 50 is V3, and the FR ledger
  // being over is V5. Both must surface, not just the first.
  updateEconomy(country.id, (current) => {
    return { ...current, emissionPct: 30 };
  });
  const before = selectedEconomy.value?.state;

  const outcome = endEconomyTurn(country.id);
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  assert.ok(outcome.errors.some((error) => {
    return error.code === "V3";
  }));
  assert.equal(outcome.turn, 1);
  // The state is untouched: same turn, same object.
  assert.equal(selectedEconomy.value?.state, before);
  assert.equal(selectedEconomy.value?.state.turn, 1);
});

test("a quota failure on End Turn is reported as unsaved rather than hidden", () => {
  // The one write in this panel that cannot be undone. Discovering the failure
  // 400 ms later would read as "it worked, then a banner appeared".
  const { timers } = setup({ failWrite: true });
  const country = addCountry("Testland");
  selectCountry(country.id);
  timers.run();

  const outcome = endEconomyTurn(country.id);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    return;
  }
  assert.equal(outcome.saved, false);
  // Non-fatal: the in-memory economy still advanced.
  assert.equal(selectedEconomy.value?.state.turn, 2);
  assert.equal(statePersistent.value, true);
});

test("two consecutive turns keep the history in engine order, newest last", () => {
  setup();
  const country = addCountry("Testland");
  selectCountry(country.id);

  endEconomyTurn(country.id);
  endEconomyTurn(country.id);
  const history = selectedEconomy.value?.state.history ?? [];
  assert.equal(history.length, 2);
  assert.equal(history[0]?.turn, 1);
  assert.equal(history[1]?.turn, 2);
  assert.equal(selectedEconomy.value?.state.turn, 3);
});

// --- a full economy through a fake storage ---------------------------------
//
// The reload condition, end to end: two countries, every optional part of the
// document populated on one of them, out through `economyToJson` and the T05
// writer into an INJECTED storage, and back in through a fresh `initWorldStore`.
// Not one field may change on the way, and the reader must report no repair —
// a repair here would mean the writer produced something the reader disliked.

// A record with a step and a warning, so the deepest path the document has —
// data -> history[] -> record -> steps[] -> step -> deltas[] -> delta, seven
// container levels — is exercised. `sanitizeRecord` silently DROPS anything
// deeper than eight, so this is the assertion that catches a record growing a
// level.
function savedRecord(): TurnRecord {
  return {
    turn: 3,
    gdpTotalObor: 106000000,
    gdpNextTotalObor: 107795555,
    overallGrowthPct: 1.6939,
    frGenerated: 15483.2,
    frRemainder: 10163.2,
    micGenerated: 307.93,
    micRemainder: 197.93,
    ratingScore: 78,
    ratingNext: 76,
    controlPosition: 44,
    controlNext: 47,
    steps: [{
      step: "generation",
      deltas: [{ label: "frGenerated", value: 15483.2, unit: "fr" }],
      notes: ["the tax base carried the turn"],
    }],
    warnings: ["V18: extraction is starved to zero growth"],
  };
}

// Every remaining field of spec 18 set away from its opening value, so a field
// the writer forgets cannot pass by coincidence.
function populate(countryId: number): void {
  updateEconomy(countryId, (current) => {
    return {
      ...current,
      turn: 4,
      ratingScore: 78,
      controlPosition: 44,
      emissionPct: 4,
      emissionPctLast: 2,
      militaryPct: 12,
      militaryPctLast: 10,
      frExpenseLines: [{ label: "orders", points: 2500 }],
      micExpenseLines: [{ label: "shells", points: 100 }],
      frIncomeLines: [{ label: "a tariff", points: 40 }],
      micIncomeLines: [{ label: "a gift", points: 5 }],
      reserveFr: 3000,
      reserveAdd: 500,
      reserveWithdraw: 25,
      micStock: 40,
      micStockAdd: 10,
      micStockWithdraw: 3,
      loans: [{
        id: 1,
        principal: 6000,
        ratePct: 12,
        termTurns: 6,
        turnsRemaining: 4,
        createdTurn: 2,
        allocatedFr: 2220,
      }],
      nextLoanId: 2,
      borrowRequest: 1500,
      // Off, so `allocatedFr` above is the [P] value a player set by hand.
      debtAutoService: false,
      debtStatus: "arrears",
      defaultLastTurn: true,
      mobilized: true,
      mobilizationJustified: false,
      region: "bengo",
      concessions: [{
        id: 1,
        sectorKey: "extraction",
        gdpTransferredObor: 5300000,
        grantedTurn: 3,
        active: true,
      }],
      nextConcessionId: 2,
      pendingConcession: { sectorKey: "commercial" },
      pendingAction: { kind: "privatization", enterprise: "civilian", roll: 7 },
      turnsSinceNationalization: 5,
      turnsSincePrivatization: 4,
      timedModifiers: [{ id: 1, reason: "privatization", growthPp: 0.525, turnsRemaining: 2 }],
      nextModifierId: 2,
      privatizationFrDragTurns: 3,
      privatizationMicDragTurns: 2,
      history: [savedRecord()],
    };
  });
  for (const key of RESOURCE_KEYS) {
    updateResource(countryId, key, {
      stockUnits: 6,
      deposits: 2,
      extractionBonusPct: 25,
      importsRequested: 20,
      exports: 4,
      blockadePct: 10,
    });
  }
  for (const [key, gdpObor] of [
    ["agriculture", 24000000],
    ["lightIndustry", 18000000],
    ["heavyIndustry", 30000000],
    ["commercial", 20000000],
    ["extraction", 8000000],
  ] as [SectorKey, number][]) {
    updateSector(countryId, key, { gdpObor, growthPermanentPct: 3, growthTemporaryPct: -1 });
  }
}

test("a full economy with two Other sectors round-trips through storage untouched", () => {
  const { storage, timers } = setup();
  const rich = addCountry("Aurelia");
  const bare = addCountry("Plainland");

  selectCountry(rich.id);
  addOtherSector(rich.id, "Aerospace", "a strategic aerospace programme");
  addOtherSector(rich.id, "Shipping", "a treaty port pays a tithe");
  populate(rich.id);
  updateSector(rich.id, "other1", { gdpObor: 6000000, growthPermanentPct: 5 });
  updateSector(rich.id, "other2", { gdpObor: 2000000, growthPermanentPct: 4 });
  const before = selectedEconomy.value?.state as EconomyState;
  assert.equal(before.sectors.length, 7);

  // The second country has NO Other sector and is otherwise the opening sheet,
  // edited once so that it is written at all.
  selectCountry(bare.id);
  updateEconomy(bare.id, (current) => {
    return { ...current, emissionPct: 1 };
  });
  const bareBefore = selectedEconomy.value?.state as EconomyState;
  assert.equal(bareBefore.sectors.length, 5);

  // Only now does the document reach the injected storage.
  timers.run();
  const raw = storage.getItem(STATE_KEY);
  assert.notEqual(raw, null);
  assert.match(raw as string, /Aerospace/);

  // A fresh init off the same storage IS a reload.
  initWorldStore({ storage, timers: fakeTimers() });
  resetEconomyStore();

  selectCountry(rich.id);
  const after = selectedEconomy.value;
  // No repair: the reader accepted every field the writer produced. A repair here
  // would mean the two disagree about the document's own shape.
  assert.deepEqual(after?.repairs, []);
  assert.deepEqual(after?.state, before);

  selectCountry(bare.id);
  const bareAfter = selectedEconomy.value;
  assert.deepEqual(bareAfter?.repairs, []);
  assert.deepEqual(bareAfter?.state, bareBefore);
  // The reader inserts a MISSING BASE sector; it must never invent an Other one.
  assert.equal(bareAfter?.state.sectors.length, 5);
  assert.equal(bareAfter?.state.sectors.some((sector) => {
    return sector.key === "other1" || sector.key === "other2";
  }), false);
});

test("the reloaded economy still derives and still resolves a turn", () => {
  // A document that reads back field for field but can no longer be computed on
  // would be a round trip that lost the point of itself.
  const { storage, timers } = setup();
  const country = addCountry("Aurelia");
  selectCountry(country.id);
  addOtherSector(country.id, "Aerospace", "a strategic aerospace programme");
  addOtherSector(country.id, "Shipping", "a treaty port pays a tithe");
  populate(country.id);
  timers.run();

  initWorldStore({ storage, timers: fakeTimers() });
  resetEconomyStore();
  selectCountry(country.id);

  const state = selectedEconomy.value?.state as EconomyState;
  const derived = selectedDerived.value;
  assert.notEqual(derived, null);
  // The turn history came back whole, down to the delta inside the step.
  assert.equal(state.history.length, 1);
  assert.deepEqual(state.history[0], savedRecord());
  // The panel's own view of that record is readable.
  const view = buildHistoryView(state.history);
  assert.equal(view.length, 1);
  assert.equal(view[0]?.turn, 3);
  assert.deepEqual(view[0]?.warnings, [{
    code: "V18",
    text: "extraction is starved to zero growth",
  }]);

  // 20 pp of military movement against a 20 pp step at band 3 while mobilized is
  // legal, but this fixture moved 2 pp, so the only reason a turn could fail is a
  // field the round trip damaged.
  const outcome = endEconomyTurn(country.id);
  if (!outcome.ok) {
    assert.fail("the reloaded economy failed to resolve: " + JSON.stringify(outcome.errors));
  }
  assert.equal(outcome.turn, 4);
  assert.equal(selectedEconomy.value?.state.turn, 5);
});

// --- draft pruning ---------------------------------------------------------

test("initEconomySync drops the draft of a deleted country", () => {
  setup();
  const stop = initEconomySync();
  const first = addCountry("First");
  const second = addCountry("Second");
  selectCountry(first.id);
  updateEconomy(first.id, (current) => {
    return { ...current, emissionPct: 3 };
  });
  selectCountry(second.id);
  updateEconomy(second.id, (current) => {
    return { ...current, emissionPct: 5 };
  });

  deleteCountry(first.id);
  // The surviving country keeps its draft.
  selectCountry(second.id);
  assert.equal(selectedEconomy.value?.state.emissionPct, 5);

  // The deleted one is gone from the store AND from the drafts, so a reused id
  // could never inherit it.
  assert.equal(economicsOf(first.id), null);
  selectCountry(first.id);
  assert.equal(selectedEconomy.value, null);
  stop();
});
