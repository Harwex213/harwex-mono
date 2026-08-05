import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import {
  LEDGER_LABEL_MAX,
  LEDGER_LINE_MAX,
  TAG_LEGEND,
  appendLedgerLine,
  canAddOtherSector,
  fieldAccess,
  freeOtherSectorKey,
  inputStep,
  parseNumberInput,
  patchLedgerLine,
  removeLedgerLine,
  stepWindow,
  stepWindowText,
} from "./economics-fields";
import { ECONOMY_CONSTANTS } from "../economy/constants";
import { createInitialEconomy, createSector } from "../economy/economy-state";
import { deriveEconomy } from "../economy/derive";
import type { EconomyState, LedgerLine, Sector } from "../economy/types";
import type { FieldTag, NumberSpec } from "./economics-fields";

const POINTS: NumberSpec = { min: 0, max: 1000, decimals: 2, integer: false };
const WHOLE: NumberSpec = { min: 0, max: 100, decimals: 0, integer: true };

function lines(count: number): LedgerLine[] {
  const out: LedgerLine[] = [];
  for (let at = 0; at < count; at += 1) {
    out.push({ label: "line " + at, points: at });
  }
  return out;
}

// --- the tag table ---------------------------------------------------------

test("a [P] field is editable in both modes", () => {
  assert.deepEqual(fieldAccess("P", false), { editable: true, locked: false, auto: false });
  assert.deepEqual(fieldAccess("P", true), { editable: true, locked: false, auto: false });
});

test("a [V] field is locked until judge mode is on", () => {
  assert.deepEqual(fieldAccess("V", false), { editable: false, locked: true, auto: false });
  assert.deepEqual(fieldAccess("V", true), { editable: true, locked: false, auto: false });
});

test("an [A] field is NEVER editable, and judge mode does not unlock it", () => {
  // The brief's hard rule. Judge mode unlocks verdict fields and nothing else;
  // an [A] value is the engine's output and typing into it would be a lie.
  assert.deepEqual(fieldAccess("A", false), { editable: false, locked: false, auto: true });
  assert.deepEqual(fieldAccess("A", true), { editable: false, locked: false, auto: true });
});

test("the legend covers all three tags exactly once", () => {
  assert.deepEqual(TAG_LEGEND.map((entry) => {
    return entry.tag;
  }), ["P", "V", "A"]);
  for (const entry of TAG_LEGEND) {
    assert.ok(entry.title.length > 0);
    assert.ok(entry.help.length > 0);
  }
});

// --- parsing ---------------------------------------------------------------

test("parseNumberInput accepts a plain number inside the range", () => {
  assert.deepEqual(parseNumberInput("12.5", POINTS), { ok: true, value: 12.5 });
  assert.deepEqual(parseNumberInput(" 0 ", POINTS), { ok: true, value: 0 });
  assert.deepEqual(parseNumberInput("1000", POINTS), { ok: true, value: 1000 });
  assert.deepEqual(parseNumberInput("+4", POINTS), { ok: true, value: 4 });
  assert.deepEqual(parseNumberInput("4.", POINTS), { ok: true, value: 4 });
  assert.deepEqual(parseNumberInput(".5", POINTS), { ok: true, value: 0.5 });
});

test("an empty field is refused and is NOT read as zero", () => {
  // Silently turning a cleared field into 0 is how a player wipes their GDP
  // without noticing.
  const empty = parseNumberInput("", POINTS);
  assert.equal(empty.ok, false);
  assert.deepEqual(parseNumberInput("   ", POINTS).ok, false);
});

test("anything parseFloat would leave a tail on is refused", () => {
  for (const text of ["1e9", "12px", "1,000", "--3", "3..4", "0x10", "Infinity", "NaN", "1 2"]) {
    assert.equal(parseNumberInput(text, POINTS).ok, false, text + " must be refused");
  }
});

test("a fractional value is refused by an integer spec", () => {
  assert.equal(parseNumberInput("70.5", WHOLE).ok, false);
  assert.deepEqual(parseNumberInput("70", WHOLE), { ok: true, value: 70 });
});

test("a value outside the range is REFUSED, never clamped", () => {
  // Spec 12: a step violation is a validation error, not a clamp. A clamp would
  // change what the player typed and then resolve a turn they did not intend.
  const over = parseNumberInput("1001", POINTS);
  assert.equal(over.ok, false);
  if (!over.ok) {
    assert.match(over.reason, /outside 0 to 1000/);
  }
  assert.equal(parseNumberInput("-1", POINTS).ok, false);
});

test("inputStep matches the spec's precision so the browser agrees with us", () => {
  assert.equal(inputStep(WHOLE), "1");
  assert.equal(inputStep(POINTS), "0.01");
  assert.equal(inputStep({ min: 0, max: 1, decimals: 1, integer: false }), "0.1");
});

// --- the step window -------------------------------------------------------

test("stepWindow is the last committed value plus and minus this turn's step", () => {
  assert.deepEqual(stepWindow(4, 10, 0, 50), { min: 0, max: 14, limitPp: 10 });
  assert.deepEqual(stepWindow(30, 10, 0, 50), { min: 20, max: 40, limitPp: 10 });
});

test("stepWindow never leaves the field's own range", () => {
  // At position 0 with a 10 pp step the window would run to -10; the field's own
  // minimum wins.
  assert.deepEqual(stepWindow(0, 10, 0, 50), { min: 0, max: 10, limitPp: 10 });
  assert.deepEqual(stepWindow(55, 10, 0, 60), { min: 45, max: 60, limitPp: 10 });
});

test("stepWindow survives a non-finite anchor or limit", () => {
  assert.deepEqual(stepWindow(Number.NaN, 10, 0, 50), { min: 0, max: 10, limitPp: 10 });
  assert.deepEqual(stepWindow(4, Number.NaN, 0, 50), { min: 4, max: 4, limitPp: 0 });
  assert.deepEqual(stepWindow(4, -3, 0, 50), { min: 4, max: 4, limitPp: 0 });
});

test("an over-large emission cannot pass the window spec", () => {
  // The brief: "a player cannot commit an emission percentage beyond this turn's
  // step". At control 50 the step is 10 pp and the last value is 0, so 30 is
  // outside 0..10 and the field refuses it.
  const window = stepWindow(0, ECONOMY_CONSTANTS.STEP_LIMIT_NEUTRAL_PP, 0, ECONOMY_CONSTANTS.EMISSION_PCT_MAX);
  const spec: NumberSpec = { min: window.min, max: window.max, decimals: 2, integer: false };
  assert.equal(parseNumberInput("30", spec).ok, false);
  assert.deepEqual(parseNumberInput("4", spec), { ok: true, value: 4 });
  assert.deepEqual(parseNumberInput("10", spec), { ok: true, value: 10 });
});

test("stepWindowText names the step and what it allows", () => {
  const text = stepWindowText(stepWindow(0, 10, 0, 50), 4);
  assert.equal(text, "step this turn: 10.00 pp — you may set 0.00% to 10.00% (now 4.00%)");
});

// --- ledger array edits ----------------------------------------------------

test("appendLedgerLine adds one empty line and copies the rest", () => {
  const before = lines(2);
  const after = appendLedgerLine(before);
  assert.equal(after.length, 3);
  assert.deepEqual(after[2], { label: "", points: 0 });
  // A fresh array of fresh objects: a mutated array is Object.is-equal to itself
  // and nothing re-renders.
  assert.notEqual(after, before);
  assert.notEqual(after[0], before[0]);
});

test("appendLedgerLine is a no-op at the cap", () => {
  const full = lines(LEDGER_LINE_MAX);
  const after = appendLedgerLine(full);
  assert.equal(after.length, LEDGER_LINE_MAX);
  assert.equal(LEDGER_LINE_MAX, ECONOMY_CONSTANTS.LEDGER_LINE_MAX);
});

test("removeLedgerLine drops exactly one row and ignores a bad index", () => {
  const before = lines(3);
  assert.deepEqual(removeLedgerLine(before, 1).map((line) => {
    return line.label;
  }), ["line 0", "line 2"]);
  assert.equal(removeLedgerLine(before, -1).length, 3);
  assert.equal(removeLedgerLine(before, 3).length, 3);
  assert.equal(removeLedgerLine(before, 1.5).length, 3);
});

test("patchLedgerLine touches one row and caps the label", () => {
  const before = lines(2);
  const after = patchLedgerLine(before, 0, { points: 9 });
  assert.deepEqual(after[0], { label: "line 0", points: 9 });
  assert.deepEqual(after[1], { label: "line 1", points: 1 });

  const long = patchLedgerLine(before, 1, { label: "x".repeat(LEDGER_LABEL_MAX + 40) });
  assert.equal((long[1] as LedgerLine).label.length, LEDGER_LABEL_MAX);
  // The engine's own cap is higher, so this one can only ever be stricter.
  assert.ok(LEDGER_LABEL_MAX <= ECONOMY_CONSTANTS.LEDGER_LABEL_MAX);
});

// --- Other sectors ---------------------------------------------------------

test("freeOtherSectorKey walks the two slots in order and then reports none", () => {
  const base: Sector[] = [createSector("agriculture")];
  assert.equal(freeOtherSectorKey(base), "other1");
  assert.equal(canAddOtherSector(base), true);

  const one = [...base, createSector("other1")];
  assert.equal(freeOtherSectorKey(one), "other2");
  assert.equal(canAddOtherSector(one), true);

  const two = [...one, createSector("other2")];
  assert.equal(freeOtherSectorKey(two), null);
  assert.equal(canAddOtherSector(two), false);
  assert.equal(ECONOMY_CONSTANTS.OTHER_SECTOR_MAX, 2);
});

test("a hole in the slots is reused rather than reported full", () => {
  const withSecond: Sector[] = [createSector("other2")];
  assert.equal(freeOtherSectorKey(withSecond), "other1");
});

// --- the [P]/[V]/[A] classification table ----------------------------------
//
// THE MOST VALUABLE TEST IN T12. The panel's whole contract is "the tag decides
// who may type into a field", so the tag of every field has to be the tag spec
// section 18 assigns it — not the tag whoever wrote the component happened to
// pick.
//
// The table below is transcribed BY HAND from `.plan/T11/FORMULA-SPEC.md`
// section 18 and the per-area field tables. It is then used three ways:
//
// 1. every field of a fully populated `EconomyState` must appear in it, so a
//    field added later WITHOUT a tag fails;
// 2. `fieldAccess` must agree with it for every entry;
// 3. every editable field the panel actually renders must carry the tag the
//    table gives it, read out of the `.tsx` sources.

type SpecTag = FieldTag;

// Spec 18, `type EconomyState`. The four annotation-free container fields are
// tagged by who may change their MEMBERSHIP, with the spec clause named:
//
// - `sectors`   [V] — spec 4.1: "creating an Other sector is [V], not [P]";
// - `resources` [A] — spec 18: "exactly 8, fixed order", so no membership edit
//                     exists at all;
// - `loans`     [A] — spec 14: the engine creates a loan at borrowing and
//                     retires it at term; `borrowRequest` is the [P] lever;
// - `concessions` [A] — spec 15.3: the engine appends the record at grant;
//                     `pendingConcession` is the [V] lever.
const STATE_TAGS: Readonly<Record<string, SpecTag>> = {
  schemaVersion: "A",
  turn: "A",
  sectors: "V",
  ratingScore: "V",
  controlPosition: "V",
  emissionPct: "P",
  emissionPctLast: "A",
  militaryPct: "P",
  militaryPctLast: "A",
  frExpenseLines: "P",
  micExpenseLines: "P",
  frIncomeLines: "P",
  micIncomeLines: "P",
  reserveFr: "A",
  reserveAdd: "P",
  reserveWithdraw: "P",
  micStock: "A",
  micStockAdd: "P",
  micStockWithdraw: "P",
  resources: "A",
  loans: "A",
  nextLoanId: "A",
  borrowRequest: "P",
  debtAutoService: "P",
  debtStatus: "A",
  defaultLastTurn: "A",
  mobilized: "V",
  mobilizationJustified: "V",
  region: "V",
  concessions: "A",
  nextConcessionId: "A",
  pendingConcession: "V",
  pendingAction: "P",
  turnsSinceNationalization: "A",
  turnsSincePrivatization: "A",
  timedModifiers: "A",
  nextModifierId: "A",
  privatizationFrDragTurns: "A",
  privatizationMicDragTurns: "A",
  history: "A",
};

// Spec 18, the seven nested types. `key` and every `id` are schema plumbing and
// therefore [A]: "the engine owns it, no UI ever shows it, and no verdict
// touches it".
const NESTED_TAGS: Readonly<Record<string, Readonly<Record<string, SpecTag>>>> = {
  sector: {
    key: "A",
    name: "P",
    grounds: "V",
    gdpObor: "V",
    growthPermanentPct: "V",
    growthTemporaryPct: "V",
  },
  resource: {
    key: "A",
    stockUnits: "A",
    deposits: "V",
    extractionBonusPct: "V",
    importsRequested: "P",
    exports: "P",
    blockadePct: "V",
  },
  loan: {
    id: "A",
    principal: "A",
    ratePct: "A",
    termTurns: "A",
    turnsRemaining: "A",
    createdTurn: "A",
    allocatedFr: "P",
  },
  ledgerLine: {
    label: "P",
    points: "P",
  },
  timedModifier: {
    id: "A",
    reason: "A",
    growthPp: "A",
    turnsRemaining: "A",
  },
  pendingAction: {
    kind: "P",
    enterprise: "P",
    roll: "V",
  },
  pendingConcession: {
    sectorKey: "V",
  },
  concession: {
    id: "A",
    sectorKey: "V",
    gdpTransferredObor: "A",
    grantedTurn: "A",
    active: "V",
  },
};

function tagOf(path: string): SpecTag | null {
  const dot = path.indexOf(".");
  if (dot < 0) {
    return STATE_TAGS[path] ?? null;
  }
  const owner = NESTED_TAGS[path.slice(0, dot)];
  if (owner === undefined) {
    return null;
  }
  return owner[path.slice(dot + 1)] ?? null;
}

function everyTaggedPath(): string[] {
  const out = Object.keys(STATE_TAGS);
  for (const owner of Object.keys(NESTED_TAGS)) {
    for (const field of Object.keys(NESTED_TAGS[owner] as Record<string, SpecTag>)) {
      out.push(owner + "." + field);
    }
  }
  return out.sort();
}

// Every optional part of the document present at once, so the key scan below
// sees the whole shape rather than the opening sheet's subset.
function fullyPopulated(): EconomyState {
  const state = createInitialEconomy();
  state.sectors = [...state.sectors, {
    key: "other1",
    name: "Aerospace",
    grounds: "a strategic aerospace programme",
    gdpObor: 6000000,
    growthPermanentPct: 5,
    growthTemporaryPct: 0,
  }];
  state.frExpenseLines = [{ label: "orders", points: 2500 }];
  state.loans = [{
    id: 1,
    principal: 6000,
    ratePct: 12,
    termTurns: 6,
    turnsRemaining: 4,
    createdTurn: 2,
    allocatedFr: 0,
  }];
  state.concessions = [{
    id: 1,
    sectorKey: "extraction",
    gdpTransferredObor: 5300000,
    grantedTurn: 3,
    active: true,
  }];
  state.pendingConcession = { sectorKey: "extraction" };
  state.pendingAction = { kind: "privatization", enterprise: "civilian", roll: 7 };
  state.timedModifiers = [{ id: 1, reason: "privatization", growthPp: 0.525, turnsRemaining: 2 }];
  return state;
}

test("every field of the economy document carries a spec tag", () => {
  // A field added to `EconomyState` later without a tag FAILS HERE, which is the
  // point: an untagged field has no defined answer to "may a player type into
  // it?", and the panel would have to guess.
  const state = fullyPopulated();
  for (const key of Object.keys(state)) {
    assert.notEqual(
      STATE_TAGS[key],
      undefined,
      "EconomyState." + key + " has no [P]/[V]/[A] tag in spec 18",
    );
  }
  // And nothing in the table has been left behind by a removed field.
  for (const key of Object.keys(STATE_TAGS)) {
    assert.ok(key in state, "spec 18 tags EconomyState." + key + ", which no longer exists");
  }
});

test("every field of every nested shape carries a spec tag", () => {
  const state = fullyPopulated();
  const samples: [string, object][] = [
    ["sector", state.sectors[5] as object],
    ["resource", state.resources[0] as object],
    ["loan", state.loans[0] as object],
    ["ledgerLine", state.frExpenseLines[0] as object],
    ["timedModifier", state.timedModifiers[0] as object],
    ["pendingAction", state.pendingAction as object],
    ["pendingConcession", state.pendingConcession as object],
    ["concession", state.concessions[0] as object],
  ];
  for (const [owner, sample] of samples) {
    const table = NESTED_TAGS[owner] as Record<string, SpecTag>;
    assert.deepEqual(Object.keys(sample).sort(), Object.keys(table).sort(), owner + " tag table");
  }
});

test("fieldAccess agrees with the spec tag of every field in the document", () => {
  // Read as: for each of the ~80 tagged fields, what the panel would do with it
  // in both modes. [A] is the one that must not budge.
  for (const path of everyTaggedPath()) {
    const tag = tagOf(path) as SpecTag;
    const off = fieldAccess(tag, false);
    const on = fieldAccess(tag, true);
    if (tag === "A") {
      assert.equal(off.editable, false, path + " is [A] and must never be editable");
      assert.equal(on.editable, false, path + " is [A]; judge mode must not unlock it");
      assert.equal(on.auto, true, path);
      continue;
    }
    if (tag === "V") {
      assert.equal(off.locked, true, path + " is [V] and must be locked for a player");
      assert.equal(off.editable, false, path);
      assert.equal(on.editable, true, path + " is [V] and a judge must be able to set it");
      continue;
    }
    assert.equal(off.editable, true, path + " is [P] and a player must be able to set it");
    assert.equal(on.editable, true, path);
  }
});

// --- the tag the panel actually renders ------------------------------------
//
// The table above says what the tag should be; this reads what the components
// do. Every editable cell in the sheet is a `NumberField`, `SelectField`,
// `ToggleField` or `TextField` carrying a literal `tag="P"` or `tag="V"` and an
// `onCommit` naming the state field it writes.

const uiDir = fileURLToPath(new URL("./", import.meta.url));
const FIELD_ELEMENT = /<(NumberField|SelectField|ToggleField|TextField)\b/g;

// Which spec path a committed field name belongs to. `sectorKey` is the pending
// concession's, because a GRANTED concession's sector is a record of what
// happened and the panel offers only its `active` toggle.
const COMMIT_PATHS: Readonly<Record<string, string>> = {
  active: "concession.active",
  allocatedFr: "loan.allocatedFr",
  blockadePct: "resource.blockadePct",
  borrowRequest: "borrowRequest",
  controlPosition: "controlPosition",
  debtAutoService: "debtAutoService",
  deposits: "resource.deposits",
  emissionPct: "emissionPct",
  enterprise: "pendingAction.enterprise",
  exports: "resource.exports",
  extractionBonusPct: "resource.extractionBonusPct",
  gdpObor: "sector.gdpObor",
  growthPermanentPct: "sector.growthPermanentPct",
  growthTemporaryPct: "sector.growthTemporaryPct",
  importsRequested: "resource.importsRequested",
  kind: "pendingAction.kind",
  label: "ledgerLine.label",
  militaryPct: "militaryPct",
  mobilizationJustified: "mobilizationJustified",
  mobilized: "mobilized",
  micStockAdd: "micStockAdd",
  micStockWithdraw: "micStockWithdraw",
  name: "sector.name",
  points: "ledgerLine.points",
  ratingScore: "ratingScore",
  region: "region",
  reserveAdd: "reserveAdd",
  reserveWithdraw: "reserveWithdraw",
  roll: "pendingAction.roll",
  sectorKey: "pendingConcession.sectorKey",
};

// A [P]/[V] field the panel deliberately does not render as its own input, each
// with the reason. A field that quietly stops being editable fails the coverage
// test below unless it is added here on purpose.
const PANEL_OMISSIONS: Readonly<Record<string, string>> = {
  sectors: "the add and remove buttons change membership, not a field",
  frExpenseLines: "the add and remove line buttons change the list, not a field",
  micExpenseLines: "the add and remove line buttons change the list, not a field",
  frIncomeLines: "the add and remove line buttons change the list, not a field",
  micIncomeLines: "the add and remove line buttons change the list, not a field",
  pendingAction: "the kind select creates and clears the object",
  pendingConcession: "the sector select creates and clears the object",
  "sector.grounds": "set by the Other-sector creation form, which is [V] per spec 4.1",
  "concession.sectorKey": "a granted concession's sector is a record; only `active` is revocable",
};

type PanelField = { file: string; component: string; tag: string; commits: string[] };

// The element's own extent, found by balancing `{}` so a `/>` inside an
// expression cannot end it early.
function panelFields(): PanelField[] {
  const out: PanelField[] = [];
  const files = readdirSync(uiDir).filter((name) => {
    return name.startsWith("Econom") && name.endsWith(".tsx");
  }).sort();
  for (const file of files) {
    const body = readFileSync(uiDir + file, "utf8");
    FIELD_ELEMENT.lastIndex = 0;
    let match = FIELD_ELEMENT.exec(body);
    while (match !== null) {
      let at = match.index + match[0].length;
      let depth = 0;
      let end = -1;
      while (at < body.length) {
        const char = body.charAt(at);
        if (char === "{") {
          depth += 1;
        } else if (char === "}") {
          depth -= 1;
        } else if (char === "/" && body.charAt(at + 1) === ">" && depth === 0) {
          end = at;
          break;
        }
        at += 1;
      }
      assert.ok(end > 0, file + ": an unterminated field element at " + match.index);
      const block = body.slice(match.index, end);
      const tag = /\stag="([PVA])"/.exec(block);
      assert.notEqual(tag, null, file + ": a field element with no literal tag attribute");
      const commits: string[] = [];
      for (const commit of block.matchAll(/(\w+):\s*(?:next|!)/g)) {
        commits.push(commit[1] as string);
      }
      out.push({
        file,
        component: match[1] as string,
        tag: (tag as RegExpExecArray)[1] as string,
        commits,
      });
      match = FIELD_ELEMENT.exec(body);
    }
  }
  return out;
}

test("the panel renders every editable field with the tag spec 18 gives it", () => {
  const fields = panelFields();
  // Pinned, so a scan that silently stopped finding elements cannot pass.
  assert.equal(fields.length, 32, "the panel's editable field count changed");

  let checked = 0;
  for (const field of fields) {
    for (const commit of field.commits) {
      const path = COMMIT_PATHS[commit];
      assert.notEqual(
        path,
        undefined,
        field.file + " writes `" + commit + "`, which has no spec path",
      );
      const expected = tagOf(path as string);
      assert.notEqual(expected, null, path + " has no spec tag");
      assert.equal(
        field.tag,
        expected,
        field.file + ": " + path + " is rendered as [" + field.tag + "] but spec 18 says ["
          + expected + "]",
      );
      checked += 1;
    }
  }
  // Two of the 32 write React state rather than the document: the Other-sector
  // creation form's name and grounds.
  assert.equal(checked, 30);
});

test("no [A] field is rendered as an input, in either mode", () => {
  // The structural half of the rule. `Readout` is the only [A] cell and it has
  // no input at all; here we prove no field element claims the tag either.
  for (const field of panelFields()) {
    assert.notEqual(field.tag, "A", field.file + " renders an [A] field as an input");
    for (const commit of field.commits) {
      assert.notEqual(
        tagOf(COMMIT_PATHS[commit] as string),
        "A",
        field.file + " writes the [A] field " + commit,
      );
    }
  }
  const readout = readFileSync(uiDir + "EconomyReadout.tsx", "utf8");
  const body = readout.slice(readout.indexOf("function Readout"));
  assert.doesNotMatch(body, /<input|<select|<textarea|contentEditable/);
});

test("the Other-sector creation form is [V], because creating one is a verdict", () => {
  // Spec 4.1: an Other sector "requires weighty grounds — so creating an Other
  // sector is [V], not [P]". Its two form fields are therefore [V] even though
  // the resulting `sector.name` is [P] to edit afterwards.
  const form = panelFields().filter((field) => {
    return field.file === "EconomySectors.tsx" && field.commits.length === 0;
  });
  assert.equal(form.length, 2);
  for (const field of form) {
    assert.equal(field.tag, "V");
  }
  assert.equal(tagOf("sector.name"), "P");
  assert.equal(tagOf("sector.grounds"), "V");
});

test("every [P] and [V] field is either editable in the panel or a named omission", () => {
  const rendered = new Set<string>();
  for (const field of panelFields()) {
    for (const commit of field.commits) {
      rendered.add(COMMIT_PATHS[commit] as string);
    }
  }
  const missing: string[] = [];
  for (const path of everyTaggedPath()) {
    if (tagOf(path) === "A") {
      continue;
    }
    if (rendered.has(path) || path in PANEL_OMISSIONS) {
      continue;
    }
    missing.push(path);
  }
  assert.deepEqual(missing, [], "an editable field the panel does not expose");
  // The omission list is exact, so a field cannot be dropped from the sheet by
  // adding a line here without anyone noticing.
  assert.deepEqual(Object.keys(PANEL_OMISSIONS).sort(), [
    "concession.sectorKey",
    "frExpenseLines",
    "frIncomeLines",
    "micExpenseLines",
    "micIncomeLines",
    "pendingAction",
    "pendingConcession",
    "sector.grounds",
    "sectors",
  ]);
});

// --- the step cap at both edges of the window ------------------------------

function stepSpec(window: { min: number; max: number }): NumberSpec {
  return { min: window.min, max: window.max, decimals: 2, integer: false };
}

test("the step window accepts its own edges and refuses one hundredth beyond them", () => {
  // Spec 7.1 at band index 3 (position 31..44): step = 10 − 1,50 × (3 − 5) =
  // 13,00 pp. With `emissionPctLast` 20,00 the window is 7,00..33,00 and BOTH
  // edges are the step rather than the field's own range.
  const window = stepWindow(20, 13, ECONOMY_CONSTANTS.EMISSION_PCT_MIN, ECONOMY_CONSTANTS.EMISSION_PCT_MAX);
  assert.deepEqual(window, { min: 7, max: 33, limitPp: 13 });
  const spec = stepSpec(window);

  assert.deepEqual(parseNumberInput("33", spec), { ok: true, value: 33 });
  assert.deepEqual(parseNumberInput("7", spec), { ok: true, value: 7 });
  assert.equal(parseNumberInput("33.01", spec).ok, false);
  assert.equal(parseNumberInput("6.99", spec).ok, false);
});

test("the field's own range wins where it is stricter than the step", () => {
  // Spec 11: `militaryPct` runs 0,00..60,00. At position 50 the step is 10,00
  // pp, so from 55,00 the window's upper edge is the field maximum and its
  // lower edge is the step.
  const window = stepWindow(
    55,
    ECONOMY_CONSTANTS.STEP_LIMIT_NEUTRAL_PP,
    ECONOMY_CONSTANTS.MILITARY_PCT_MIN,
    ECONOMY_CONSTANTS.MILITARY_PCT_MAX,
  );
  assert.deepEqual(window, { min: 45, max: 60, limitPp: 10 });
  const spec = stepSpec(window);
  assert.deepEqual(parseNumberInput("60", spec), { ok: true, value: 60 });
  assert.equal(parseNumberInput("60.01", spec).ok, false);
  assert.equal(parseNumberInput("65", spec).ok, false);
  assert.deepEqual(parseNumberInput("45", spec), { ok: true, value: 45 });
  assert.equal(parseNumberInput("44.99", spec).ok, false);
});

test("mobilization widens the military window by ten points and nothing else", () => {
  // Spec 12: `militaryStepLimitPp = stepLimitPp + (mobilized ? 10,00 : 0)`, and
  // the emission step is untouched.
  const plain = stepWindow(30, ECONOMY_CONSTANTS.STEP_LIMIT_NEUTRAL_PP, 0, ECONOMY_CONSTANTS.MILITARY_PCT_MAX);
  const mobilized = stepWindow(
    30,
    ECONOMY_CONSTANTS.STEP_LIMIT_NEUTRAL_PP + ECONOMY_CONSTANTS.MOB_STEP_BONUS_PP,
    0,
    ECONOMY_CONSTANTS.MILITARY_PCT_MAX,
  );
  assert.deepEqual(plain, { min: 20, max: 40, limitPp: 10 });
  assert.deepEqual(mobilized, { min: 10, max: 50, limitPp: 20 });

  assert.equal(parseNumberInput("50", stepSpec(plain)).ok, false);
  assert.deepEqual(parseNumberInput("50", stepSpec(mobilized)), { ok: true, value: 50 });
  assert.equal(parseNumberInput("10", stepSpec(plain)).ok, false);
  assert.deepEqual(parseNumberInput("10", stepSpec(mobilized)), { ok: true, value: 10 });
});

test("the UI window is exactly the engine's V3, neither looser nor tighter", () => {
  // The engine stays the authority. If the field let through a value V3 refuses,
  // End Turn would fail on something the panel accepted; if it refused a value
  // V3 allows, a legal move would be unreachable. So both edges are checked
  // against `deriveEconomy` itself.
  const base = createInitialEconomy();
  base.controlPosition = 50;
  base.emissionPctLast = 20;

  const limit = deriveEconomy(base).emissionStepLimitPp;
  assert.equal(limit, ECONOMY_CONSTANTS.STEP_LIMIT_NEUTRAL_PP, "position 50 is the neutral band");
  const window = stepWindow(base.emissionPctLast, limit, 0, ECONOMY_CONSTANTS.EMISSION_PCT_MAX);
  assert.deepEqual(window, { min: 10, max: 30, limitPp: 10 });

  const v3 = (emissionPct: number): boolean => {
    return deriveEconomy({ ...base, emissionPct }).errors.some((error) => {
      return error.code === "V3";
    });
  };
  for (const edge of [window.min, window.max]) {
    assert.deepEqual(parseNumberInput(String(edge), stepSpec(window)), { ok: true, value: edge });
    assert.equal(v3(edge), false, edge + " is on the edge and the engine allows it");
  }
  for (const beyond of [window.min - 0.01, window.max + 0.01]) {
    assert.equal(parseNumberInput(String(beyond), stepSpec(window)).ok, false);
    assert.equal(v3(beyond), true, beyond + " is beyond the step and the engine refuses it");
  }
});
