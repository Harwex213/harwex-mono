import { formatDeltaValue, formatSigned } from "./economics-format";
import type { TurnRecord } from "../economy/types";

// `EconomyState.history` turned into something a player reads rather than a raw
// dump. This is the "readable record" half of T12's done condition.
//
// No React, no signals, no DOM.

type HistoryDelta = {
  label: string;
  text: string;
  unit: string;
  sign: -1 | 0 | 1;
};

type HistoryStep = {
  // The engine's own step name, e.g. "debt-service".
  key: string;
  title: string;
  deltas: HistoryDelta[];
  notes: string[];
  // Nothing survived the zero filter and there are no notes.
  quiet: boolean;
};

type HistoryTurn = {
  turn: number;
  headline: HistoryDelta[];
  steps: HistoryStep[];
  warnings: { code: string | null; text: string }[];
};

// All fifteen `STEP_NAMES`. An unknown key falls back to `humanizeLabel`, so a
// future engine step degrades to a readable row instead of disappearing.
const STEP_TITLES: Readonly<Record<string, string>> = {
  "derive-and-validate": "Checks",
  resources: "Resources",
  generation: "Income",
  actions: "Actions",
  borrowing: "Borrowing",
  savings: "Savings",
  "debt-service": "Debt service",
  upkeep: "Stockpile upkeep",
  spending: "Spending",
  "auto-invest": "Auto-investment",
  growth: "Growth",
  gdp: "GDP",
  rating: "Credit rating",
  flags: "Flags and cooldowns",
  commit: "Committed",
};

// The engine's delta labels that camelCase splitting alone would render badly.
const LABEL_TITLES: Readonly<Record<string, string>> = {
  autoInvestGrowthPp: "Auto-investment growth",
  concessionCostObor: "Concession cost",
  controlFrMultiplier: "Control multiplier",
  controlPosition: "Control position",
  controlShift: "Control shift",
  debtAllocatedTotal: "Debt paid",
  debtLimit: "Debt limit",
  debtRatingPenalty: "Rating penalty from debt",
  debtRequiredTotal: "Debt due",
  debtShortfallTotal: "Debt shortfall",
  frAvailable: "FR available",
  frCore: "FR before emission",
  frEmission: "FR from emission",
  frGenerated: "FR generated",
  frRemainder: "FR remainder",
  frSpent: "FR spent",
  gdpChangeObor: "GDP change",
  gdpNextTotalObor: "GDP next turn",
  gdpTotalObor: "GDP",
  investedObor: "Auto-invested",
  micAvailable: "MIC available",
  micGenerated: "MIC generated",
  micRemainder: "MIC remainder",
  micSpent: "MIC spent",
  micStockEnd: "MIC stockpile",
  micStockLost: "MIC stockpile lost",
  micUpkeepDue: "Upkeep due",
  micUpkeepPaid: "Upkeep paid",
  modifierPp: "Global growth modifier",
  natFrPayout: "Nationalization FR",
  natMicPayout: "Nationalization MIC",
  newLoanAvailable: "Borrowing headroom",
  newLoanProceeds: "Loan proceeds",
  overallGrowthPct: "Overall growth",
  plannedGrowthPct: "Planned growth",
  ratingFactor: "Rating factor",
  ratingNext: "Rating next turn",
  ratingScore: "Credit rating",
  reserveAddApplied: "Added to reserve",
  reserveEnd: "Reserve",
  reserveWithdrawApplied: "Withdrawn from reserve",
  turn: "Turn",
};

const WARNING_CODE = /^(V\d+):\s*(.*)$/;

// camelCase to a sentence. A label that is already prose — "coal shortage",
// "free units carried" — passes through with only its first letter raised. A
// hyphen becomes a space too, because a step key is kebab-case and the same
// fallback names an unmapped step.
function humanizeLabel(label: string): string {
  const known = LABEL_TITLES[label];
  if (known !== undefined) {
    return known;
  }
  const spaced = label.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ");
  const lower = spaced.charAt(0).toLowerCase() + spaced.slice(1).toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// The engine prefixes a warning with its V-code, e.g. "V17: …". The code becomes
// a chip and the sentence stands on its own.
function splitWarning(warning: string): { code: string | null; text: string } {
  const match = WARNING_CODE.exec(warning);
  if (match === null) {
    return { code: null, text: warning };
  }
  return { code: match[1] as string, text: match[2] as string };
}

function signOf(value: number): -1 | 0 | 1 {
  if (!Number.isFinite(value) || value === 0) {
    return 0;
  }
  return value > 0 ? 1 : -1;
}

// A step row, printed UNSIGNED.
//
// A step record mixes genuine changes with closing levels — "Emission −2" is a
// rating change, but "GDP 100,000,000", "Debt limit 27,038.25 FR" and "Coal
// shortage 100.00%" are levels. The record carries no flag telling the two apart,
// so a blanket "+" would claim every level had just increased by its own value. A
// negative still carries its own "−" from the formatter, and `sign` drives the
// colour, so direction is not lost where it exists.
function toRow(label: string, value: number, unit: string): HistoryDelta {
  return {
    label: humanizeLabel(label),
    text: formatDeltaValue(value, unit),
    unit,
    sign: signOf(value),
  };
}

// A rate of change, where a leading "+" is the meaning and not a guess.
function toRate(label: string, value: number, unit: string): HistoryDelta {
  return {
    label: humanizeLabel(label),
    text: formatSigned(formatDeltaValue(value, unit), value),
    unit,
    sign: signOf(value),
  };
}

function buildHistoryTurn(record: TurnRecord): HistoryTurn {
  // Built from the record's own closing numbers, so nothing is recomputed here.
  const headline: HistoryDelta[] = [
    toRow("gdpTotalObor", record.gdpTotalObor, "obor"),
    toRow("gdpNextTotalObor", record.gdpNextTotalObor, "obor"),
    toRate("overallGrowthPct", record.overallGrowthPct, "pct"),
    toRow("frGenerated", record.frGenerated, "fr"),
    toRow("frRemainder", record.frRemainder, "fr"),
    toRow("micGenerated", record.micGenerated, "mic"),
    toRow("micRemainder", record.micRemainder, "mic"),
    toRow("ratingScore", record.ratingScore, "rating"),
    toRow("ratingNext", record.ratingNext, "rating"),
    toRow("controlPosition", record.controlPosition, "count"),
    toRow("controlNext", record.controlNext, "count"),
  ];

  const steps: HistoryStep[] = record.steps.map((step) => {
    // A fifteen-step dump where twelve rows read 0.00 is the raw dump the brief
    // forbids, so a zero-valued row is dropped. A step that loses every row is
    // marked quiet and still renders one line, so the order stays visible and a
    // reader can see that the step ran.
    const deltas: HistoryDelta[] = [];
    for (const entry of step.deltas) {
      if (!Number.isFinite(entry.value) || entry.value === 0) {
        continue;
      }
      deltas.push(toRow(entry.label, entry.value, entry.unit));
    }
    const notes = [...step.notes];
    return {
      key: step.step,
      title: STEP_TITLES[step.step] ?? humanizeLabel(step.step),
      deltas,
      notes,
      quiet: deltas.length === 0 && notes.length === 0,
    };
  });

  return {
    turn: record.turn,
    headline,
    steps,
    warnings: record.warnings.map(splitWarning),
  };
}

// The engine stores newest LAST; a player reads newest FIRST.
function buildHistoryView(records: readonly TurnRecord[]): HistoryTurn[] {
  const out: HistoryTurn[] = [];
  for (let at = records.length - 1; at >= 0; at -= 1) {
    out.push(buildHistoryTurn(records[at] as TurnRecord));
  }
  return out;
}

export {
  LABEL_TITLES,
  STEP_TITLES,
  buildHistoryTurn,
  buildHistoryView,
  humanizeLabel,
  splitWarning,
  type HistoryDelta,
  type HistoryStep,
  type HistoryTurn,
};
