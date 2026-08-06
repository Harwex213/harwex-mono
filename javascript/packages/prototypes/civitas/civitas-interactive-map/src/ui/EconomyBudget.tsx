import { useState } from "react";
import { ECONOMY_CONSTANTS } from "../economy/constants";
import { LEDGER_LABEL_MAX, LEDGER_LINE_MAX, appendLedgerLine, patchLedgerLine, removeLedgerLine, stepWindow, stepWindowText } from "./economics-fields";
import { NumberField, TextField, errorFor } from "./EconomyField";
import { Readout } from "./EconomyReadout";
import { clearLedgerLines, setLedgerLines, updateEconomy } from "../state/economy-store";
import { formatDrag, formatFactor, formatObor, formatPct, formatPoints, formatPp, formatShare, formatSigned } from "./economics-format";
import { sumLines } from "../economy/derive";
import type { LedgerListKey } from "../state/economy-store";
import type { NumberSpec } from "./economics-fields";
import type { SectionProps } from "./EconomyField";
import styles from "./economics.module.css";

// Spec areas 5, 7 and 8, plus the UI half of area 9's step cap: emission,
// military spending, FR and MIC generation, and the four ledgers.
//
// THE STEP CAP IS ENFORCED HERE AS WELL AS IN THE ENGINE. Each percentage field
// takes its `min`/`max` from `stepWindow`, so `parseNumberInput` refuses an
// over-large value and nothing is written. The engine's V3/V4 stay the authority
// for the case no keystroke can catch: a judge lowering the control position
// narrows the window under a value that was already committed.

const POINTS_SPEC: NumberSpec = { min: 0, max: 1e9, decimals: 2, integer: false };

const LEDGERS: readonly { list: LedgerListKey; title: string; unit: string }[] = [
  { list: "frExpenseLines", title: "FR expenses", unit: "FR" },
  { list: "frIncomeLines", title: "FR other income", unit: "FR" },
  { list: "micExpenseLines", title: "MIC expenses", unit: "MIC" },
  { list: "micIncomeLines", title: "MIC other income", unit: "MIC" },
];

function Ledger(props: SectionProps & { list: LedgerListKey; title: string; unit: string }) {
  const countryId = props.slot.countryId;
  const lines = props.slot.state[props.list];
  const full = lines.length >= LEDGER_LINE_MAX;

  return (
    <div className={styles.ledger}>
      <p className={styles.subhead}>
        {props.title} — {formatPoints(sumLines(lines))} {props.unit}
      </p>
      {lines.map((line, index) => {
        return (
          <div className={styles.ledgerRow} key={props.list + "-" + index}>
            <TextField
              key={props.list + "-label-" + index + "-" + countryId}
              label={"line " + (index + 1)}
              maxLength={LEDGER_LABEL_MAX}
              placeholder="what it pays for"
              tag="P"
              value={line.label}
              onCommit={(next) => {
                setLedgerLines(countryId, props.list, patchLedgerLine(lines, index, { label: next }));
              }}
            />
            <NumberField
              key={props.list + "-points-" + index + "-" + countryId}
              error={errorFor(props.derived, props.list + "[" + index + "].points")}
              label="points"
              spec={POINTS_SPEC}
              suffix={props.unit}
              tag="P"
              value={line.points}
              onCommit={(next) => {
                setLedgerLines(countryId, props.list, patchLedgerLine(lines, index, { points: next }));
              }}
            />
            <button
              className={styles.iconButton}
              title="remove this line"
              type="button"
              onClick={() => {
                setLedgerLines(countryId, props.list, removeLedgerLine(lines, index));
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <div className={styles.actions}>
        <button
          className={styles.button}
          disabled={full}
          title={full ? "the cap is " + LEDGER_LINE_MAX + " lines" : "add a line"}
          type="button"
          onClick={() => {
            setLedgerLines(countryId, props.list, appendLedgerLine(lines));
          }}
        >
          add line
        </button>
        {full ? <span className={styles.hint}>at the cap of {LEDGER_LINE_MAX} lines</span> : null}
      </div>
    </div>
  );
}

function EconomyBudget(props: SectionProps) {
  const countryId = props.slot.countryId;
  const state = props.slot.state;
  const derived = props.derived;

  const [armedClear, setArmedClear] = useState(false);

  const emissionWindow = stepWindow(
    state.emissionPctLast,
    derived.emissionStepLimitPp,
    ECONOMY_CONSTANTS.EMISSION_PCT_MIN,
    ECONOMY_CONSTANTS.EMISSION_PCT_MAX,
  );
  const militaryWindow = stepWindow(
    state.militaryPctLast,
    derived.militaryStepLimitPp,
    ECONOMY_CONSTANTS.MILITARY_PCT_MIN,
    ECONOMY_CONSTANTS.MILITARY_PCT_MAX,
  );

  const emissionSpec: NumberSpec = {
    min: emissionWindow.min,
    max: emissionWindow.max,
    decimals: 2,
    integer: false,
  };
  const militarySpec: NumberSpec = {
    min: militaryWindow.min,
    max: militaryWindow.max,
    decimals: 2,
    integer: false,
  };

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Emission, military spending and the budget</h3>
      <p className={styles.sectionSub}>areas 5, 7, 8 and 9 — the two percentages under their step cap, then the points</p>

      <div className={styles.gridWide}>
        <NumberField
          key={"emission-" + countryId}
          error={errorFor(derived, "emissionPct")}
          hint={stepWindowText(emissionWindow, state.emissionPct)}
          label="emission"
          spec={emissionSpec}
          suffix="%"
          tag="P"
          value={state.emissionPct}
          onCommit={(next) => {
            updateEconomy(countryId, (current) => {
              return { ...current, emissionPct: next };
            });
          }}
        />
        <NumberField
          key={"military-" + countryId}
          error={errorFor(derived, "militaryPct")}
          hint={stepWindowText(militaryWindow, state.militaryPct)}
          label="military spending"
          spec={militarySpec}
          suffix="%"
          tag="P"
          value={state.militaryPct}
          onCommit={(next) => {
            updateEconomy(countryId, (current) => {
              return { ...current, militaryPct: next };
            });
          }}
        />
      </div>
      <p className={styles.note}>
        last turn: emission {formatPct(state.emissionPctLast)}, military{" "}
        {formatPct(state.militaryPctLast)}. a move beyond the step is refused, never clamped — the
        panel will not quietly change what you typed and then resolve a turn you did not intend. the
        first {formatPct(ECONOMY_CONSTANTS.MILITARY_FREE_PCT)} of military spending costs no growth.
      </p>

      <div className={styles.grid}>
        <Readout label="inflation" tone={derived.inflationPct > 0 ? "bad" : "normal"} value={formatPct(derived.inflationPct)} />
        {/* The engine keeps a drag as a positive magnitude and subtracts it, so
            these two print negated — a "+" here would read as a bonus. */}
        <Readout
          label="inflation growth drag"
          tone={derived.inflationGrowthPp > 0 ? "bad" : "normal"}
          value={formatDrag(derived.inflationGrowthPp)}
        />
        <Readout label="emission rating cost" value={formatSigned(formatPoints(derived.emissionRatingPenalty), derived.emissionRatingPenalty)} />
        <Readout label="FR from emission" value={formatPoints(derived.frEmission)} />
        <Readout
          label="defence growth drag"
          tone={derived.defenceGrowthPp > 0 ? "bad" : "normal"}
          value={formatDrag(derived.defenceGrowthPp)}
        />
        <Readout label="defence FR drag" value={formatFactor(derived.frDefenceDrag)} />
      </div>

      <p className={styles.subhead}>FR generation</p>
      <div className={styles.grid}>
        <Readout label="tax base" value={formatPoints(derived.frTaxBase)} />
        <Readout label="growth factor" value={formatFactor(derived.frGrowthFactor)} />
        <Readout label="light industry bonus" value={formatShare(derived.frLightBonus)} />
        <Readout label="regime multiplier" value={formatFactor(derived.frRegimeMultiplier)} />
        <Readout label="FR before emission" value={formatPoints(derived.frCore)} />
        <Readout label="FR generated" tone="good" value={formatPoints(derived.frGenerated)} />
        <Readout label="FR other income" value={formatPoints(derived.frOtherIncome)} />
        <Readout label="FR available" value={formatPoints(derived.frAvailable)} />
        <Readout label="FR spent" value={formatPoints(derived.frSpent)} />
        <Readout
          hint={derived.frRemainder < 0 ? "the ledger is over — End Turn will refuse (V5)" : "auto-invested at turn end"}
          label="FR remainder"
          tone={derived.frRemainder < 0 ? "bad" : "normal"}
          value={formatPoints(derived.frRemainder)}
        />
      </div>

      {/* Spec 8.4a is the one ordering a reader has to hold in mind. Hidden by
          default keeps the section readable; a reader chasing a starved loan can
          open it. */}
      <details className={styles.details}>
        <summary className={styles.summary}>running balance, step by step</summary>
        <div className={styles.grid}>
          <Readout label="after savings" value={formatPoints(derived.frBalanceAfterSavings)} />
          <Readout label="after debt service" value={formatPoints(derived.frBalanceAfterDebt)} />
          <Readout label="after upkeep" value={formatPoints(derived.frBalanceAfterUpkeep)} />
        </div>
        <p className={styles.note}>
          a reserve addition is charged BEFORE debt service, so banking money can starve an
          auto-serviced loan and cost rating points. that never happens silently: V14 and V17 fire.
        </p>
      </details>

      <p className={styles.subhead}>MIC generation</p>
      <div className={styles.grid}>
        <Readout label="heavy industry bonus" value={formatShare(derived.micHeavyBonus)} />
        <Readout label="regime multiplier" value={formatFactor(derived.micRegimeMultiplier)} />
        <Readout label="MIC generated" tone="good" value={formatPoints(derived.micGenerated)} />
        <Readout label="MIC other income" value={formatPoints(derived.micOtherIncome)} />
        <Readout label="MIC available" value={formatPoints(derived.micAvailable)} />
        <Readout label="MIC spent" value={formatPoints(derived.micSpent)} />
        <Readout
          hint={derived.micRemainder < 0 ? "the ledger is over — End Turn will refuse (V6)" : "auto-invested at turn end"}
          label="MIC remainder"
          tone={derived.micRemainder < 0 ? "bad" : "normal"}
          value={formatPoints(derived.micRemainder)}
        />
        <Readout label="auto-investment" value={formatSigned(formatPp(derived.autoInvestGrowthPp), derived.autoInvestGrowthPp)} />
      </div>

      <p className={styles.note}>
        points do not carry over. whatever is left at turn end is auto-invested, at{" "}
        {formatObor(ECONOMY_CONSTANTS.OBOR_PER_FR_POINT)} obor per FR point and{" "}
        {formatObor(ECONOMY_CONSTANTS.OBOR_PER_MIC_POINT)} obor per MIC point.
      </p>

      {LEDGERS.map((ledger) => {
        return (
          <Ledger
            derived={derived}
            key={ledger.list}
            list={ledger.list}
            slot={props.slot}
            title={ledger.title}
            unit={ledger.unit}
          />
        );
      })}

      <div className={styles.actions}>
        <button
          className={armedClear ? styles.button + " " + styles.buttonArmed : styles.button}
          type="button"
          onClick={() => {
            if (!armedClear) {
              setArmedClear(true);
              return;
            }
            setArmedClear(false);
            clearLedgerLines(countryId);
          }}
        >
          {armedClear ? "confirm — clear all four ledgers" : "clear all lines"}
        </button>
      </div>
    </section>
  );
}

export { EconomyBudget };
