import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DASH,
  formatBool,
  formatDeltaValue,
  formatDrag,
  formatFactor,
  formatForInput,
  formatInteger,
  formatObor,
  formatPct,
  formatPoints,
  formatPp,
  formatShare,
  formatSigned,
  formatTurns,
  formatUnits,
} from "./economics-format";
import { UNIT_DECIMALS } from "../economy/history";

// The panel's formatting layer. Everything here is pure, which is why it lives
// outside the `.tsx` files — there is no jsdom in this repo.

test("formatObor groups thousands and keeps the sign", () => {
  assert.equal(formatObor(0), "0");
  assert.equal(formatObor(100000000), "100,000,000");
  assert.equal(formatObor(107795555), "107,795,555");
  assert.equal(formatObor(-2500000), "-2,500,000");
  // Rounded to whole obor, never shown with a fraction.
  assert.equal(formatObor(1234.6), "1,235");
});

test("formatPoints keeps two decimals and groups the integer part", () => {
  assert.equal(formatPoints(0), "0.00");
  assert.equal(formatPoints(15483.2), "15,483.20");
  assert.equal(formatPoints(-4.5), "-4.50");
  assert.equal(formatPoints(0.005), "0.01");
});

test("formatPct and formatPp carry their own unit", () => {
  assert.equal(formatPct(1.69), "1.69%");
  assert.equal(formatPct(0), "0.00%");
  assert.equal(formatPp(-0.9), "-0.90 pp");
  assert.equal(formatPp(10), "10.00 pp");
});

test("formatShare turns a fraction of one into a percentage", () => {
  assert.equal(formatShare(0.2), "20.00%");
  assert.equal(formatShare(1), "100.00%");
  assert.equal(formatShare(0), "0.00%");
});

test("formatFactor, formatUnits, formatInteger and formatTurns", () => {
  assert.equal(formatFactor(1.06), "x1.06");
  assert.equal(formatFactor(0.5), "x0.50");
  assert.equal(formatUnits(50), "50 units");
  assert.equal(formatUnits(1), "1 unit");
  assert.equal(formatUnits(0), "0 units");
  assert.equal(formatInteger(70), "70");
  assert.equal(formatInteger(-3), "-3");
  assert.equal(formatTurns(1), "1 turn");
  assert.equal(formatTurns(6), "6 turns");
});

test("a non-finite value prints the dash and never NaN", () => {
  // `sanitizeRecord` DROPS a NaN key, so a field printing "NaN" would silently
  // vanish from the document on the next reload. Nothing here may produce it.
  const bad = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const value of bad) {
    assert.equal(formatObor(value), DASH);
    assert.equal(formatPoints(value), DASH);
    assert.equal(formatPct(value), DASH);
    assert.equal(formatPp(value), DASH);
    assert.equal(formatShare(value), DASH);
    assert.equal(formatFactor(value), DASH);
    assert.equal(formatUnits(value), DASH);
    assert.equal(formatInteger(value), DASH);
    assert.equal(formatTurns(value), DASH);
    assert.equal(formatDeltaValue(value, "obor"), DASH);
  }
});

test("formatSigned prefixes a plus only for a strictly positive value", () => {
  assert.equal(formatSigned(formatPp(2), 2), "+2.00 pp");
  assert.equal(formatSigned(formatPp(-2), -2), "-2.00 pp");
  assert.equal(formatSigned(formatPp(0), 0), "0.00 pp");
  assert.equal(formatSigned(DASH, Number.NaN), DASH);
});

test("formatDrag prints a subtracted magnitude as a negative", () => {
  // `modifierPpOf` in `growth.ts` SUBTRACTS `inflationGrowthPp`,
  // `defenceGrowthPp` and `reservePenaltyPp`, all of which the engine stores as
  // positive magnitudes. Printing one with a "+" would read as a growth bonus
  // when it is the exact opposite.
  assert.equal(formatDrag(0.6), "-0.60 pp");
  assert.equal(formatDrag(2), "-2.00 pp");
  assert.equal(formatDrag(0), "0.00 pp");
  // Already negative stays negative rather than flipping to a bonus.
  assert.equal(formatDrag(-0.6), "-0.60 pp");
  assert.equal(formatDrag(Number.NaN), DASH);
});

test("the three drag fields really are subtracted by the engine", () => {
  // Pins the reason `formatDrag` exists. If a later engine change makes one of
  // these signed, this test fails and the display convention gets revisited
  // instead of quietly lying.
  const growth = readFileSync(new URL("../economy/growth.ts", import.meta.url), "utf8");
  for (const field of ["reservePenaltyPp", "inflationGrowthPp", "defenceGrowthPp"]) {
    assert.match(growth, new RegExp("-\\s*input\\." + field), field + " is no longer subtracted");
  }
});

test("formatForInput never groups, because a comma is not a number", () => {
  // The value goes straight into an `<input type="number">`. A grouped string is
  // rejected by the browser and by `parseNumberInput`.
  assert.equal(formatForInput(20000000, 0), "20000000");
  assert.equal(formatForInput(12.5, 2), "12.5");
  assert.equal(formatForInput(4, 2), "4");
  assert.equal(formatForInput(70, 0), "70");
  assert.equal(formatForInput(3.456, 2), "3.46");
  // A zero-decimal spec truncates rather than printing a fraction the field
  // would then reject.
  assert.equal(formatForInput(3.9, 0), "3");
  assert.equal(formatForInput(Number.NaN, 2), "");
});

test("formatBool spells a flag out", () => {
  assert.equal(formatBool(true), "yes");
  assert.equal(formatBool(false), "no");
});

test("formatDeltaValue covers every unit the engine emits", () => {
  // The engine's own unit table is the authority. A unit added there with no
  // case here would silently fall back to points, so the set is asserted.
  const covered: Record<string, string> = {
    obor: formatDeltaValue(1500, "obor"),
    fr: formatDeltaValue(12.5, "fr"),
    mic: formatDeltaValue(12.5, "mic"),
    pp: formatDeltaValue(-0.9, "pp"),
    pct: formatDeltaValue(1.69, "pct"),
    units: formatDeltaValue(50, "units"),
    rating: formatDeltaValue(-4, "rating"),
    turns: formatDeltaValue(6, "turns"),
    count: formatDeltaValue(2, "count"),
    factor: formatDeltaValue(1.06, "factor"),
  };
  assert.deepEqual(Object.keys(covered).sort(), Object.keys(UNIT_DECIMALS).sort());
  assert.equal(covered.obor, "1,500");
  assert.equal(covered.fr, "12.50 FR");
  assert.equal(covered.mic, "12.50 MIC");
  assert.equal(covered.pp, "-0.90 pp");
  assert.equal(covered.pct, "1.69%");
  assert.equal(covered.units, "50 units");
  assert.equal(covered.rating, "-4");
  assert.equal(covered.turns, "6 turns");
  assert.equal(covered.count, "2");
  assert.equal(covered.factor, "x1.06");
});

test("formatDeltaValue falls back to points for an unknown unit", () => {
  assert.equal(formatDeltaValue(3.5, "flurbs"), "3.50");
});
