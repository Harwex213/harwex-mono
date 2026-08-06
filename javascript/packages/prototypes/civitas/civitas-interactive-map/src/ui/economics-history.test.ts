import assert from "node:assert/strict";
import test from "node:test";
import {
  STEP_TITLES,
  buildHistoryTurn,
  buildHistoryView,
  humanizeLabel,
  splitWarning,
} from "./economics-history";
import { ECONOMY_CONSTANTS } from "../economy/constants";
import { STEP_NAMES, resolveTurn } from "../economy/pipeline";
import { createInitialEconomy } from "../economy/economy-state";
import type { EconomyState, ResourceKey, SectorKey, TurnRecord } from "../economy/types";
import type { HistoryStep, HistoryTurn } from "./economics-history";

function record(patch: Partial<TurnRecord> = {}): TurnRecord {
  return {
    turn: 1,
    gdpTotalObor: 100000000,
    gdpNextTotalObor: 103000000,
    overallGrowthPct: 3,
    frGenerated: 1000,
    frRemainder: 250,
    micGenerated: 40,
    micRemainder: 10,
    ratingScore: 70,
    ratingNext: 71,
    controlPosition: 50,
    controlNext: 50,
    steps: [],
    warnings: [],
    ...patch,
  };
}

test("every engine step name has a title, so no step can render nameless", () => {
  for (const name of STEP_NAMES) {
    assert.equal(typeof STEP_TITLES[name], "string", name + " has no title");
  }
  assert.equal(Object.keys(STEP_TITLES).length, STEP_NAMES.length);
});

test("an unknown step key degrades to a readable title instead of vanishing", () => {
  const view = buildHistoryTurn(record({
    steps: [{ step: "future-step", deltas: [{ label: "x", value: 1, unit: "fr" }], notes: [] }],
  }));
  assert.equal(view.steps[0]?.title, "Future step");
});

test("humanizeLabel maps a known engine label and splits camelCase otherwise", () => {
  assert.equal(humanizeLabel("frGenerated"), "FR generated");
  assert.equal(humanizeLabel("micGenerated"), "MIC generated");
  assert.equal(humanizeLabel("frCore"), "FR before emission");
  assert.equal(humanizeLabel("controlFrMultiplier"), "Control multiplier");
  assert.equal(humanizeLabel("gdpTotalObor"), "GDP");
  // Prose already reads correctly and only gains a capital.
  assert.equal(humanizeLabel("coal shortage"), "Coal shortage");
  assert.equal(humanizeLabel("free units carried"), "Free units carried");
  // The fallback: an unmapped camelCase label.
  assert.equal(humanizeLabel("someNewField"), "Some new field");
});

test("splitWarning peels the V-code off into a chip", () => {
  assert.deepEqual(splitWarning("V17: a reserve addition starved a loan"), {
    code: "V17",
    text: "a reserve addition starved a loan",
  });
  assert.deepEqual(splitWarning("no prefix here"), { code: null, text: "no prefix here" });
});

test("a zero-valued delta is dropped, because a wall of 0.00 is the dump the brief forbids", () => {
  const view = buildHistoryTurn(record({
    steps: [{
      step: "generation",
      deltas: [
        { label: "frGenerated", value: 1000, unit: "fr" },
        { label: "frEmission", value: 0, unit: "fr" },
        { label: "micGenerated", value: Number.NaN, unit: "mic" },
      ],
      notes: [],
    }],
  }));
  const step = view.steps[0];
  assert.equal(step?.deltas.length, 1);
  assert.equal(step?.deltas[0]?.label, "FR generated");
  // UNSIGNED: a step record mixes changes with closing levels and carries no flag
  // telling them apart, so a "+" would claim a level had just risen by its own
  // value. The sign field still carries the direction for the colour.
  assert.equal(step?.deltas[0]?.text, "1,000.00 FR");
  assert.equal(step?.deltas[0]?.sign, 1);
  assert.equal(step?.quiet, false);
});

test("a step that loses every row is marked quiet, and its notes keep it loud", () => {
  // The step order stays visible so a reader can see the step ran at all.
  const quiet = buildHistoryTurn(record({
    steps: [{ step: "upkeep", deltas: [{ label: "micUpkeepPaid", value: 0, unit: "fr" }], notes: [] }],
  }));
  assert.equal(quiet.steps[0]?.quiet, true);

  const noted = buildHistoryTurn(record({
    steps: [{ step: "upkeep", deltas: [], notes: ["nothing was stockpiled"] }],
  }));
  assert.equal(noted.steps[0]?.quiet, false);
  assert.deepEqual(noted.steps[0]?.notes, ["nothing was stockpiled"]);
});

test("a rate keeps its plus; a level and a step row never gain one", () => {
  const view = buildHistoryTurn(record({
    overallGrowthPct: 3,
    steps: [{
      step: "growth",
      deltas: [{ label: "modifierPp", value: -0.9, unit: "pp" }],
      notes: [],
    }],
  }));
  assert.equal(view.steps[0]?.deltas[0]?.text, "-0.90 pp");
  assert.equal(view.steps[0]?.deltas[0]?.sign, -1);

  const gdp = view.headline.find((entry) => {
    return entry.label === "GDP";
  });
  assert.equal(gdp?.text, "100,000,000");
  // A rating LEVEL, not a change: "+68" would read as "the rating rose by 68".
  const ratingNext = view.headline.find((entry) => {
    return entry.label === "Rating next turn";
  });
  assert.equal(ratingNext?.text, "71");
  // Growth IS unambiguously a rate of change and keeps its sign.
  const growth = view.headline.find((entry) => {
    return entry.label === "Overall growth";
  });
  assert.equal(growth?.text, "+3.00%");
});

test("the headline is exactly the record's own closing scalars", () => {
  const view = buildHistoryTurn(record());
  assert.deepEqual(view.headline.map((entry) => {
    return entry.label;
  }), [
    "GDP",
    "GDP next turn",
    "Overall growth",
    "FR generated",
    "FR remainder",
    "MIC generated",
    "MIC remainder",
    "Credit rating",
    "Rating next turn",
    "Control position",
    "Control next",
  ]);
});

test("buildHistoryView reverses the engine's order, newest first", () => {
  const view = buildHistoryView([record({ turn: 1 }), record({ turn: 2 }), record({ turn: 3 })]);
  assert.deepEqual(view.map((turn) => {
    return turn.turn;
  }), [3, 2, 1]);
  assert.deepEqual(buildHistoryView([]), []);
});

test("a real resolved turn produces a view with every step present and readable", () => {
  // The end-to-end shape: the engine's own record, not a fixture. A fresh
  // country reads a full shortage (zero deposits), which is correct and is what
  // the resources section explains in prose.
  const resolved = resolveTurn(createInitialEconomy(), { provinceCount: 4 });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) {
    return;
  }
  const view = buildHistoryTurn(resolved.record);
  assert.equal(view.turn, 1);
  assert.deepEqual(view.steps.map((step) => {
    return step.key;
  }), [...STEP_NAMES]);
  for (const step of view.steps) {
    assert.notEqual(step.title, "");
    for (const delta of step.deltas) {
      assert.notEqual(delta.label, "");
      assert.doesNotMatch(delta.text, /NaN|undefined/);
    }
  }
  // Income actually ran, so its step is not quiet.
  const income = view.steps.find((step) => {
    return step.key === "generation";
  });
  assert.equal(income?.quiet, false);
});

// --- the spec's own worked turn, rendered ----------------------------------
//
// Aurelia, turn 4 — spec section 19.1, transcribed field for field. Section 19
// is the spec's primary fixture and every number below is the spec's own,
// computed at full precision and quoted at its stored precision. NOTHING here
// was read off a run: each expectation names the section it comes from.

const AURELIA_SECTORS: [SectorKey, number, number, number][] = [
  ["agriculture", 24000000, 3.0, 0],
  ["lightIndustry", 18000000, 3.0, 0],
  ["heavyIndustry", 30000000, 4.0, -1.0],
  ["commercial", 20000000, 2.5, 0],
  ["extraction", 8000000, 3.0, 0],
  ["other1", 6000000, 5.0, 0],
];

const AURELIA_DEPOSITS: Record<ResourceKey, number> = {
  coal: 1,
  oil: 0,
  fibre: 1,
  ferrous: 1,
  nonferrous: 0,
  rubber: 0,
  chemical: 1,
  precious: 0,
};

const AURELIA_IMPORTS: Record<ResourceKey, number> = {
  coal: 0,
  oil: 20,
  fibre: 0,
  ferrous: 0,
  nonferrous: 30,
  rubber: 10,
  chemical: 20,
  precious: 5,
};

function aurelia(): EconomyState {
  const state = createInitialEconomy();
  state.turn = 4;
  state.region = "bengo";
  state.ratingScore = 78;
  state.controlPosition = 44;
  state.emissionPct = 4.0;
  state.emissionPctLast = 0;
  state.militaryPct = 12.0;
  state.militaryPctLast = 10.0;
  state.reserveFr = 3000;
  state.reserveAdd = 500;
  state.micStock = 40;
  state.micStockAdd = 10;
  state.frExpenseLines = [{ label: "orders", points: 2500 }];
  state.micExpenseLines = [{ label: "orders", points: 100 }];
  state.debtAutoService = true;
  state.turnsSinceNationalization = 5;
  state.turnsSincePrivatization = 4;
  state.pendingAction = { kind: "privatization", enterprise: "civilian", roll: 7 };
  state.loans = [{
    id: 1,
    principal: 6000,
    ratePct: 12,
    termTurns: 6,
    turnsRemaining: 4,
    createdTurn: 2,
    allocatedFr: 0,
  }];
  state.nextLoanId = 2;
  state.sectors = AURELIA_SECTORS.map(([key, gdpObor, perm, temp]) => {
    return {
      key,
      name: key === "other1" ? "Aerospace" : key,
      grounds: key === "other1" ? "a strategic aerospace programme" : null,
      gdpObor,
      growthPermanentPct: perm,
      growthTemporaryPct: temp,
    };
  });
  state.resources = state.resources.map((resource) => {
    return {
      ...resource,
      deposits: AURELIA_DEPOSITS[resource.key],
      importsRequested: AURELIA_IMPORTS[resource.key],
    };
  });
  return state;
}

function aureliaView(): HistoryTurn {
  const resolved = resolveTurn(aurelia(), { provinceCount: 20 });
  assert.equal(resolved.ok, true, "spec 19.2 reports no errors, so the turn must resolve");
  if (!resolved.ok) {
    throw new Error("unreachable");
  }
  return buildHistoryTurn(resolved.record);
}

function stepOf(view: HistoryTurn, key: string): HistoryStep {
  const found = view.steps.find((step) => {
    return step.key === key;
  });
  assert.ok(found, key + " must be in the view");
  return found;
}

function rowsOf(step: HistoryStep): [string, string][] {
  return step.deltas.map((delta) => {
    return [delta.label, delta.text];
  });
}

test("19.16 — the headline reads the spec's own closing numbers", () => {
  const view = aureliaView();
  assert.equal(view.turn, 4);
  assert.deepEqual(rowsOf({ ...view.steps[0], deltas: view.headline } as HistoryStep), [
    // 19.2 and 19.13.
    ["GDP", "106,000,000"],
    ["GDP next turn", "107,795,555"],
    // 19.12. A rate keeps its sign, because here a "+" is the meaning.
    ["Overall growth", "+1.69%"],
    // 19.4 and 19.10.
    ["FR generated", "15,483.20 FR"],
    ["FR remainder", "10,163.20 FR"],
    ["MIC generated", "307.93 MIC"],
    ["MIC remainder", "197.93 MIC"],
    // 19.14: the rating opens at 78 and closes at 76.
    ["Credit rating", "78"],
    ["Rating next turn", "76"],
    // 19.15: privatization shifts the control scale 44 -> 47.
    ["Control position", "44"],
    ["Control next", "47"],
  ]);
});

test("19.3 — the resources step names each shortage and the units carried", () => {
  const step = stepOf(aureliaView(), "resources");
  assert.equal(step.title, "Resources");
  // Fibre and ferrous are fully supplied, so their 0,00% rows are dropped rather
  // than printed. The 6 fibre and 2 ferrous units they leave over are the
  // "free units carried" row.
  assert.deepEqual(rowsOf(step), [
    ["Coal shortage", "10.71%"],
    ["Oil shortage", "33.33%"],
    ["Nonferrous shortage", "37.50%"],
    ["Rubber shortage", "66.67%"],
    ["Chemical shortage", "2.78%"],
    ["Precious shortage", "75.00%"],
    ["Free units carried", "8 units"],
  ]);
});

test("19.4 — the income step renders FR and MIC generation as readable rows", () => {
  const step = stepOf(aureliaView(), "generation");
  assert.equal(step.title, "Income");
  assert.deepEqual(rowsOf(step), [
    ["FR generated", "15,483.20 FR"],
    ["MIC generated", "307.93 MIC"],
    ["FR before emission", "13,363.20 FR"],
    ["FR from emission", "2,120.00 FR"],
    // A factor prints as "x1.08", never as a percentage.
    ["Rating factor", "x1.08"],
    ["Control multiplier", "x1.20"],
  ]);
  assert.equal(step.quiet, false);
});

test("19.6 to 19.9 — borrowing, savings, debt service and upkeep", () => {
  const view = aureliaView();
  // 19.6. `newLoanProceeds` is 0 and its row is dropped.
  assert.deepEqual(rowsOf(stepOf(view, "borrowing")), [
    ["Debt limit", "34,837.20 FR"],
    ["Borrowing headroom", "28,837.20 FR"],
  ]);
  // 19.7. Nothing was withdrawn, so that row is dropped too.
  assert.deepEqual(rowsOf(stepOf(view, "savings")), [
    ["Added to reserve", "500.00 FR"],
    ["Reserve", "3,500.00 FR"],
    ["MIC stockpile", "50.00 MIC"],
    ["Upkeep due", "100.00 FR"],
  ]);
  // 19.8. No shortfall, so neither the shortfall nor its rating penalty prints.
  assert.deepEqual(rowsOf(stepOf(view, "debt-service")), [
    ["Debt due", "2,220.00 FR"],
    ["Debt paid", "2,220.00 FR"],
  ]);
  // 19.9. The budget covered the upkeep in full, so nothing was lost.
  assert.deepEqual(rowsOf(stepOf(view, "upkeep")), [
    ["Upkeep paid", "100.00 FR"],
  ]);
});

test("19.10 to 19.12 — spending, auto-investment and growth", () => {
  const view = aureliaView();
  assert.deepEqual(rowsOf(stepOf(view, "spending")), [
    ["FR available", "15,483.20 FR"],
    ["FR spent", "5,320.00 FR"],
    ["FR remainder", "10,163.20 FR"],
    ["MIC available", "307.93 MIC"],
    ["MIC spent", "110.00 MIC"],
    ["MIC remainder", "197.93 MIC"],
  ]);
  // 19.11: 30 223 074,90 obor, stored to the obor.
  assert.deepEqual(rowsOf(stepOf(view, "auto-invest")), [
    ["Auto-invested", "30,223,075"],
    ["Auto-investment growth", "0.57 pp"],
  ]);
  // 19.12. The modifier is a net drag of 0,9029 pp and keeps its own minus; the
  // six sector rates follow in sector order.
  assert.deepEqual(rowsOf(stepOf(view, "growth")), [
    ["Global growth modifier", "-0.90 pp"],
    ["Overall growth", "1.69%"],
    ["Agriculture final pct", "2.07%"],
    ["Light industry final pct", "1.80%"],
    ["Heavy industry final pct", "1.39%"],
    ["Commercial final pct", "0.80%"],
    ["Extraction final pct", "1.87%"],
    ["Other1 final pct", "4.10%"],
  ]);
});

test("19.13 to 19.16 — GDP, the rating and the committed turn", () => {
  const view = aureliaView();
  // 19.13. No concession was granted, so its cost row is dropped.
  assert.deepEqual(rowsOf(stepOf(view, "gdp")), [
    ["GDP next turn", "107,795,555"],
    ["GDP change", "1,795,555"],
  ]);
  // 19.14. Emission of 4,00% costs round(0,40 x 4,00) = 2 rating points, and the
  // clean-turn clause fails on the emission, so no recovery row appears.
  const rating = stepOf(view, "rating");
  assert.deepEqual(rowsOf(rating), [
    ["Emission", "-2"],
    ["Rating next turn", "76"],
  ]);
  assert.deepEqual(rating.notes, ["not a clean turn, so no automatic recovery"]);
  // 19.16, the closing table.
  const commit = rowsOf(stepOf(view, "commit"));
  assert.deepEqual(commit.slice(1), [
    ["GDP", "107,795,555"],
    ["Credit rating", "76"],
    ["Control position", "47"],
  ]);
  assert.deepEqual(commit[0], ["Turn", "5 turns"]);
});

test("19.2 — the worked turn renders no warning row at all", () => {
  // Spec 19.2: "No errors. Warnings: V18 fires for no sector — every finalPct is
  // above 0." Nothing was clipped (19.7), no payment fell short (19.8) and no
  // upkeep went unpaid (19.9), so V14 through V17 stay silent too. A shortage on
  // its own is NOT a warning — spec 17 raises one only when a sector is starved
  // all the way to 0 growth, and six of Aurelia's eight resources are short
  // without any sector reaching that.
  assert.deepEqual(aureliaView().warnings, []);
});

test("a warning a real turn does raise renders as a V-code chip and a sentence", () => {
  // The standard opening sheet holds no deposits, so every resource-dependent
  // sector is capped at 0 growth. That is V18, and it is the one warning
  // reachable without an invalid input.
  const resolved = resolveTurn(createInitialEconomy(), { provinceCount: 4 });
  assert.equal(resolved.ok, true);
  if (!resolved.ok) {
    return;
  }
  const view = buildHistoryTurn(resolved.record);
  assert.ok(view.warnings.length > 0, "a starved sheet must warn");
  for (const warning of view.warnings) {
    assert.notEqual(warning.code, null, "a warning without its V-code: " + warning.text);
    assert.match(warning.code as string, /^V\d+$/);
    assert.notEqual(warning.text, "");
    // The code became a chip, so the sentence must not repeat it.
    assert.doesNotMatch(warning.text, /^V\d+:/);
  }
  assert.ok(view.warnings.some((warning) => {
    return warning.code === "V18";
  }), "a sector starved to 0 growth is V18");
});

test("the whole history a document can carry stays within the engine's cap", () => {
  const many: TurnRecord[] = [];
  for (let turn = 1; turn <= ECONOMY_CONSTANTS.TURN_HISTORY_MAX; turn += 1) {
    many.push(record({ turn }));
  }
  const view = buildHistoryView(many);
  assert.equal(view.length, ECONOMY_CONSTANTS.TURN_HISTORY_MAX);
  assert.equal(view[0]?.turn, ECONOMY_CONSTANTS.TURN_HISTORY_MAX);
});
