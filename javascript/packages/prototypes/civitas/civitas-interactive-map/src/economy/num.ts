// Numeric hygiene, spec section 3.
//
// Two rules govern everything here. Internal arithmetic runs at full double
// precision with no intermediate rounding, and a ROUNDED VALUE IS NEVER AN INPUT
// TO FURTHER ARITHMETIC. Rounding is a view applied at exactly two boundaries:
// the turn record and the commit step.

// Symmetric half-up on the magnitude. `Math.round` alone breaks ties upward, so
// -0,125 would become -0,12 while +0,125 became +0,13. Growth and rating deltas
// are signed, so the asymmetry would show.
function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const factor = 10 ** decimals;
  const magnitude = Math.round(Math.abs(value) * factor) / factor;
  return value < 0 ? -magnitude : magnitude;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  // Reached by NaN as well, which is why every caller pairs this with
  // `finiteOr` when the value can be user-typed.
  return value;
}

// `sanitizeRecord` in `src/state/schema.ts` DROPS a key whose value is NaN or
// +/-Infinity — the field does not become null, it disappears from the saved
// document and the next load reads it as absent. Every number the engine writes
// to a draft or to a record passes through here first (guard G23).
function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

// Guard G1, G2, G5, G6: every division in the engine goes through here, so a
// zero denominator yields 0 instead of NaN or Infinity.
function safeDivide(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return 0;
  }
  return numerator / denominator;
}

// Written as a negated comparison on purpose: `NaN >= 0` is false, so a NaN
// fails the test rather than sailing through it.
function isNonNegativeNumber(value: unknown): boolean {
  if (typeof value !== "number") {
    return false;
  }
  return Number.isFinite(value) && value >= 0;
}

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  if (typeof value !== "number") {
    return false;
  }
  if (!Number.isInteger(value)) {
    return false;
  }
  return value >= min && value <= max;
}

function sumOf(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
}

export {
  clamp,
  finiteOr,
  isIntegerInRange,
  isNonNegativeNumber,
  roundTo,
  safeDivide,
  sumOf,
};
