import { ECONOMY_CONSTANTS, OTHER_SECTOR_KEYS } from "../economy/constants";
import { formatPct, formatPp } from "./economics-format";
import type { LedgerLine, Sector, SectorKey } from "../economy/types";

// The panel's defining behaviour, as pure functions: which tag may be typed
// into, how a typed string becomes a number, and what this turn's step allows.
//
// No React, no signals, no DOM.

type FieldTag = "P" | "V" | "A";

type FieldAccess = {
  // Render an enabled input.
  editable: boolean;
  // A [V] field while judge mode is off.
  locked: boolean;
  // An [A] field — never rendered as an input at all.
  auto: boolean;
};

// The whole table:
//
// | tag | judge off              | judge on               |
// | P   | editable               | editable               |
// | V   | locked                 | editable               |
// | A   | auto                   | auto  <- unchanged     |
//
// [A] never becomes editable in either mode. That is enforced twice: here, and
// structurally by `EconomyReadout.tsx` containing no `<input>` at all.
function fieldAccess(tag: FieldTag, judge: boolean): FieldAccess {
  if (tag === "A") {
    return { editable: false, locked: false, auto: true };
  }
  if (tag === "V") {
    return { editable: judge, locked: !judge, auto: false };
  }
  return { editable: true, locked: false, auto: false };
}

const TAG_LEGEND: readonly { tag: FieldTag; title: string; help: string }[] = [
  { tag: "P", title: "player", help: "you set it directly" },
  { tag: "V", title: "verdict", help: "only a judge, an event or a dice roll changes it" },
  { tag: "A", title: "auto", help: "the engine computes it; it is never editable" },
];

type NumberSpec = {
  min: number;
  max: number;
  decimals: number;
  integer: boolean;
};

type ParseResult =
  | { ok: true; value: number }
  | { ok: false; reason: string };

// Anything `Number.parseFloat` would leave a tail on is refused before it is
// parsed, so "1e9", "12px" and "1,000" all fail cleanly instead of becoming a
// number nobody typed.
const PLAIN_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

function specText(spec: NumberSpec): string {
  const min = Number.isFinite(spec.min) ? String(spec.min) : "any";
  const max = Number.isFinite(spec.max) ? String(spec.max) : "any";
  return min + " to " + max;
}

// NOTHING HERE CLAMPS. Spec section 12 is explicit that a step violation is a
// validation error and not a clamp, because "a clamp would silently change what
// the player typed and then resolve a turn they did not intend". The same
// reasoning applies to every range in the sheet, so rejection is uniform.
function parseNumberInput(text: string, spec: NumberSpec): ParseResult {
  const trimmed = text.trim();
  // An empty field is NOT zero. Silently turning a cleared field into 0 is how a
  // player wipes their GDP without noticing.
  if (trimmed === "") {
    return { ok: false, reason: "enter a number" };
  }
  if (!PLAIN_NUMBER.test(trimmed)) {
    return { ok: false, reason: "digits, an optional sign and one decimal point only" };
  }
  const value = Number(trimmed);
  // `sanitizeRecord` DROPS a NaN key, so such a value would make the field
  // vanish from the saved document on the next reload.
  if (!Number.isFinite(value)) {
    return { ok: false, reason: "enter a finite number" };
  }
  if (spec.integer && !Number.isInteger(value)) {
    return { ok: false, reason: "whole numbers only" };
  }
  // Written NEGATED, so a value that slipped through the checks above still
  // fails rather than passing straight into every downstream product.
  if (!(value >= spec.min && value <= spec.max)) {
    return { ok: false, reason: "outside " + specText(spec) };
  }
  return { ok: true, value };
}

// The `step` attribute an `<input type="number">` gets, so the browser's own
// spinner and validation agree with `parseNumberInput`.
function inputStep(spec: NumberSpec): string {
  if (spec.integer || spec.decimals <= 0) {
    return "1";
  }
  return String(1 / 10 ** spec.decimals);
}

type StepWindow = { min: number; max: number; limitPp: number };

// The UI half of the hard cap. An over-large value fails `parseNumberInput`'s
// range check and is never written, so V3 and V4 cannot be produced by typing.
// The engine's own check stays the authority — a judge lowering the control
// position can put an already-committed value outside the window with nothing
// typed, and only `derived.errors` catches that.
function stepWindow(last: number, limitPp: number, min: number, max: number): StepWindow {
  const anchor = Number.isFinite(last) ? last : min;
  const limit = Number.isFinite(limitPp) ? Math.max(0, limitPp) : 0;
  return {
    min: Math.max(min, anchor - limit),
    max: Math.min(max, anchor + limit),
    limitPp: limit,
  };
}

function stepWindowText(window: StepWindow, current: number): string {
  return "step this turn: " + formatPp(window.limitPp)
    + " — you may set " + formatPct(window.min) + " to " + formatPct(window.max)
    + " (now " + formatPct(current) + ")";
}

const LEDGER_LINE_MAX = ECONOMY_CONSTANTS.LEDGER_LINE_MAX;
const LEDGER_LABEL_MAX = 60;

function appendLedgerLine(lines: readonly LedgerLine[]): LedgerLine[] {
  if (lines.length >= LEDGER_LINE_MAX) {
    return lines.map((line) => {
      return { ...line };
    });
  }
  return [...lines.map((line) => {
    return { ...line };
  }), { label: "", points: 0 }];
}

function removeLedgerLine(lines: readonly LedgerLine[], index: number): LedgerLine[] {
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
    return lines.map((line) => {
      return { ...line };
    });
  }
  const out: LedgerLine[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    if (at === index) {
      continue;
    }
    out.push({ ...(lines[at] as LedgerLine) });
  }
  return out;
}

function patchLedgerLine(
  lines: readonly LedgerLine[],
  index: number,
  patch: Partial<LedgerLine>,
): LedgerLine[] {
  return lines.map((line, at) => {
    if (at !== index) {
      return { ...line };
    }
    const label = typeof patch.label === "string"
      ? patch.label.slice(0, LEDGER_LABEL_MAX)
      : line.label;
    const points = typeof patch.points === "number" ? patch.points : line.points;
    return { label, points };
  });
}

function freeOtherSectorKey(sectors: readonly Sector[]): SectorKey | null {
  for (const key of OTHER_SECTOR_KEYS) {
    const taken = sectors.some((sector) => {
      return sector.key === key;
    });
    if (!taken) {
      return key;
    }
  }
  return null;
}

function canAddOtherSector(sectors: readonly Sector[]): boolean {
  return freeOtherSectorKey(sectors) !== null;
}

export {
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
  type FieldAccess,
  type FieldTag,
  type NumberSpec,
  type ParseResult,
  type StepWindow,
};
