import { groupDigits } from "./country-overview";

// Every number the economics panel prints goes through this file. A readout and
// a history row can therefore never disagree about how a percentage looks.
//
// No React, no signals, no DOM.
//
// `.` for the decimal separator and `,` for thousands. The spec writes European
// commas; the codebase does not (`country-overview.ts` already prints
// `18,687 px`). Matching the codebase wins — two conventions in one app is worse
// than either. `toLocaleString` is not used for the same reason
// `country-overview.ts` avoided it: a test would assert whatever ICU the runner
// shipped with.

// What a non-finite value prints as. `deriveEconomy` guards everything with
// `finiteOr`, so this is defence in depth — but the panel also renders values
// straight off a loaded document.
const DASH = "—";

const DIGITS_ONLY = /^\d+$/;

// The integer part is grouped by `groupDigits`, which clamps to non-negative, so
// the sign is split off first and prepended.
function fixed(value: number, decimals: number): string {
  if (!Number.isFinite(value)) {
    return DASH;
  }
  const sign = value < 0 ? "-" : "";
  const text = Math.abs(value).toFixed(decimals);
  const dot = text.indexOf(".");
  const whole = dot < 0 ? text : text.slice(0, dot);
  const rest = dot < 0 ? "" : text.slice(dot);
  // `toFixed` switches to exponential notation above 1e21. Grouping that would
  // produce nonsense, so it is passed through untouched.
  if (!DIGITS_ONLY.test(whole)) {
    return sign + text;
  }
  return sign + groupDigits(Number(whole)) + rest;
}

function formatObor(value: number): string {
  return fixed(value, 0);
}

function formatPoints(value: number): string {
  return fixed(value, 2);
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) {
    return DASH;
  }
  return fixed(value, 2) + "%";
}

function formatPp(value: number): string {
  if (!Number.isFinite(value)) {
    return DASH;
  }
  return fixed(value, 2) + " pp";
}

// A DRAG. The engine stores `inflationGrowthPp`, `defenceGrowthPp` and
// `reservePenaltyPp` as POSITIVE magnitudes and SUBTRACTS them in
// `modifierPpOf`. Printing such a value with a "+" would read as a growth bonus
// when it is the opposite, so the sign is flipped for display.
//
// This is a display convention, not a formula: the number the engine uses is
// untouched and nothing here feeds back into arithmetic.
function formatDrag(value: number): string {
  if (!Number.isFinite(value)) {
    return DASH;
  }
  if (value === 0) {
    return fixed(0, 2) + " pp";
  }
  return fixed(-Math.abs(value), 2) + " pp";
}

// A share arrives as a fraction of one and prints as a percentage.
function formatShare(fraction: number): string {
  if (!Number.isFinite(fraction)) {
    return DASH;
  }
  return fixed(fraction * 100, 2) + "%";
}

function formatFactor(value: number): string {
  if (!Number.isFinite(value)) {
    return DASH;
  }
  return "x" + fixed(value, 2);
}

function formatUnits(value: number): string {
  if (!Number.isFinite(value)) {
    return DASH;
  }
  return fixed(value, 0) + (Math.abs(value) === 1 ? " unit" : " units");
}

function formatInteger(value: number): string {
  return fixed(value, 0);
}

function formatTurns(value: number): string {
  if (!Number.isFinite(value)) {
    return DASH;
  }
  return fixed(value, 0) + (Math.abs(value) === 1 ? " turn" : " turns");
}

// A "+" only for a strictly positive value. A negative already carries its own
// "-" from `fixed`, and zero is never decorated.
function formatSigned(text: string, value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return text;
  }
  return "+" + text;
}

// The value an `<input type="number">` shows. Never grouped: a comma inside a
// numeric input is not a number the browser or `parseNumberInput` accepts.
function formatForInput(value: number, decimals: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  if (decimals <= 0) {
    return String(Math.trunc(value));
  }
  // Rounded to the spec's precision, then printed with no trailing zeros: an
  // untouched field reads "20" and not "20.00", and typing a third decimal into
  // a two-decimal field does not leave a value the field would reject.
  const factor = 10 ** decimals;
  return String(Math.round(value * factor) / factor);
}

function formatBool(value: boolean): string {
  return value ? "yes" : "no";
}

// Dispatches on the engine's own unit strings — the exact set in `UNIT_DECIMALS`
// in `src/economy/history.ts`. An unknown unit falls back to points, so a future
// engine unit degrades to a readable number instead of throwing.
function formatDeltaValue(value: number, unit: string): string {
  switch (unit) {
    case "obor": {
      return formatObor(value);
    }
    case "fr": {
      return formatPoints(value) + " FR";
    }
    case "mic": {
      return formatPoints(value) + " MIC";
    }
    case "pp": {
      return formatPp(value);
    }
    case "pct": {
      return formatPct(value);
    }
    case "units": {
      return formatUnits(value);
    }
    case "rating": {
      return formatInteger(value);
    }
    case "turns": {
      return formatTurns(value);
    }
    case "count": {
      return formatInteger(value);
    }
    case "factor": {
      return formatFactor(value);
    }
  }
  return formatPoints(value);
}

export {
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
};
