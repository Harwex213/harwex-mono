import type { StateWarning } from "../state/persistence";

// The country panel's pure logic: the save-failure message table and the number
// formatting. Kept out of the `.tsx` because there is no jsdom in this repo and
// a component cannot be tested — a table that maps a warning to a sentence can.
//
// No React, no signals, no DOM.

// The lore counter stays silent until the text is within 10% of the cap. A
// counter that is always on is noise in a field meant for prose.
const LORE_COUNTER_AT = 0.9;

type SaveNoticeKind = "error" | "warn";

type SaveNotice = {
  kind: SaveNoticeKind;
  text: string;
};

// `toLocaleString()` is locale dependent and would make a test assert whatever
// ICU the runner was built with. Grouping by hand is a few lines and
// deterministic.
function groupDigits(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const digits = String(Math.max(0, Math.trunc(value)));
  let out = "";
  for (let at = 0; at < digits.length; at += 1) {
    out += digits[at];
    const left = digits.length - at - 1;
    if (left > 0 && left % 3 === 0) {
      out += ",";
    }
  }
  return out;
}

// A comma, not a thin space: `CountryPanel`'s row already reads `18,687 px` and
// the two must not disagree.
function formatArea(pixelCount: number): string {
  return groupDigits(pixelCount) + " px";
}

function formatProvinceCount(count: number): string {
  const whole = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  return groupDigits(whole) + (whole === 1 ? " province" : " provinces");
}

// KB only. A flag is never megabytes — `IMAGE_TARGET_BYTES` is 256 KB — and a
// second unit is a second thing to get wrong.
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }
  return groupDigits(Math.max(1, Math.round(bytes / 1024))) + " KB";
}

function loreCounterText(length: number, max: number): string | null {
  if (max <= 0 || length < Math.floor(max * LORE_COUNTER_AT)) {
    return null;
  }
  const left = Math.max(0, max - length);
  if (left === 0) {
    return "the lore is full at " + groupDigits(max) + " characters";
  }
  return groupDigits(left) + " characters left";
}

// `corrupt`, `unmigratable` and `repaired` are load-time events about the whole
// document. `App.tsx` already renders them in the top banner with a dismiss
// control, and repeating them inside a panel would say the same thing twice
// about something the panel cannot fix.
//
// An exhaustive `switch` with no catch-all beyond the final `return null`, so
// adding a `WarningKind` in a later task surfaces here.
function saveNoticeFor(warning: StateWarning | null, afterFlagWrite: boolean): SaveNotice | null {
  if (warning === null) {
    return null;
  }

  switch (warning.kind) {
    case "quota": {
      if (afterFlagWrite) {
        return {
          kind: "error",
          text:
            "storage is full, so the flag was not saved. it is still shown here; " +
            "remove it or a province image, and the next change will save.",
        };
      }
      return {
        kind: "error",
        text: "storage is full, so the last change was not saved. remove a flag or a province image.",
      };
    }
    case "budget": {
      return { kind: "warn", text: warning.message };
    }
    case "unavailable": {
      return { kind: "error", text: "saving is off: " + warning.message };
    }
    case "future": {
      return {
        kind: "error",
        text: "this document was written by a newer build, so nothing typed here is being saved.",
      };
    }
    case "corrupt":
    case "unmigratable":
    case "repaired": {
      return null;
    }
  }

  return null;
}

export {
  LORE_COUNTER_AT,
  formatArea,
  formatBytes,
  formatProvinceCount,
  groupDigits,
  loreCounterText,
  saveNoticeFor,
  type SaveNotice,
  type SaveNoticeKind,
};
