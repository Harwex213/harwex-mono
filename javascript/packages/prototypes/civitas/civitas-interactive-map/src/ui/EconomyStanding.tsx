import { CONTROL_BANDS, DEBT_TERMS, ECONOMY_CONSTANTS, RATING_TIERS } from "../economy/constants";
import { NumberField, errorFor } from "./EconomyField";
import { Readout } from "./EconomyReadout";
import {
  controlFrMultiplierOf,
  controlGrowthPpOf,
  stepLimitPpOf,
} from "../economy/control";
import { formatBool, formatFactor, formatInteger, formatPct, formatPp, formatSigned } from "./economics-format";
import { ratingFactorOf } from "../economy/rating";
import { updateEconomy } from "../state/economy-store";
import type { NumberSpec } from "./economics-fields";
import type { SectionProps } from "./EconomyField";
import styles from "./economics.module.css";

// Spec areas 3, 4 and 9: the credit rating, the state control scale, and both
// step limits at their source.
//
// Every band figure comes from the engine's own `control.ts` and `rating.ts`
// helpers, so the strips cannot drift from what the turn actually applies.

const SCORE_SPEC: NumberSpec = { min: 0, max: 100, decimals: 0, integer: true };

function EconomyStanding(props: SectionProps) {
  const countryId = props.slot.countryId;
  const state = props.slot.state;
  const derived = props.derived;

  // The three clauses of spec 6.2a, ticked individually, so "clean turn: no" is
  // never a mystery.
  const clauses: { text: string; on: boolean }[] = [
    { text: "no emission this turn", on: state.emissionPct === 0 },
    { text: "no missed debt payment", on: derived.debtShortfallTotal === 0 },
    { text: "positive overall growth", on: derived.overallGrowthPct > 0 },
  ];

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Credit rating and state control</h3>
      <p className={styles.sectionSub}>areas 3, 4 and 9 — the rating tier, the control band, the step limits</p>

      <div className={styles.grid}>
        <NumberField
          key={"rating-" + countryId}
          error={errorFor(derived, "ratingScore")}
          label="rating score"
          spec={SCORE_SPEC}
          tag="V"
          value={state.ratingScore}
          withRange
          onCommit={(next) => {
            updateEconomy(countryId, (current) => {
              return { ...current, ratingScore: next };
            });
          }}
        />
        <Readout label="tier" value={derived.ratingTier} />
        <Readout
          hint="scales FR generation"
          label="rating factor"
          value={formatFactor(derived.ratingFactor)}
        />
        <Readout label="rating next turn" value={formatInteger(derived.ratingNext)} />
        <Readout
          label="clean turn"
          tone={derived.ratingCleanTurn ? "good" : "muted"}
          value={formatBool(derived.ratingCleanTurn)}
        />
        <Readout
          hint="+1 per turn on a clean turn"
          label="recovery"
          value={formatSigned(formatInteger(derived.ratingRecovery), derived.ratingRecovery)}
        />
      </div>

      <ul className={styles.list}>
        {clauses.map((clause) => {
          return (
            <li className={styles.check} data-on={clause.on} key={clause.text}>
              {clause.on ? "yes" : "no"} — {clause.text}
            </li>
          );
        })}
      </ul>

      {derived.ratingDeltas.length === 0 ? (
        <p className={styles.note}>nothing moves the rating this turn.</p>
      ) : (
        <ul className={styles.list}>
          {derived.ratingDeltas.map((delta, at) => {
            return (
              <li className={styles.listRow} key={delta.reason + "-" + at}>
                <span>{delta.reason}</span>
                <span className={styles.listValue}>
                  {formatSigned(formatInteger(delta.points), delta.points)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <p className={styles.subhead}>the seven tiers</p>
      <ul className={styles.strip}>
        {RATING_TIERS.map((tier) => {
          const terms = DEBT_TERMS[tier.tier];
          return (
            <li className={styles.band} data-on={derived.ratingTier === tier.tier} key={tier.tier}>
              <span className={styles.bandName}>{tier.tier}</span>
              <span className={styles.bandMeta}>{tier.min}–{tier.max}</span>
              <span className={styles.bandMeta}>
                {formatFactor(ratingFactorOf(tier.min))} FR
              </span>
              <span className={styles.bandMeta}>
                x{terms.limitMultiple.toFixed(2)} limit · {terms.ratePct.toFixed(2)}%
              </span>
            </li>
          );
        })}
      </ul>

      <div className={styles.grid}>
        <NumberField
          key={"control-" + countryId}
          error={errorFor(derived, "controlPosition")}
          hint="the range is for feel, the number for precision"
          label="control position"
          spec={SCORE_SPEC}
          tag="V"
          value={state.controlPosition}
          withRange
          onCommit={(next) => {
            updateEconomy(countryId, (current) => {
              return { ...current, controlPosition: next };
            });
          }}
        />
        <Readout label="band" value={derived.controlBandName} />
        <Readout label="band index" value={formatInteger(derived.controlBandIndex)} />
        <Readout
          label="control growth"
          tone={derived.controlGrowthPp < 0 ? "bad" : "normal"}
          value={formatSigned(formatPp(derived.controlGrowthPp), derived.controlGrowthPp)}
        />
        <Readout label="control FR multiplier" value={formatFactor(derived.controlFrMultiplier)} />
        <Readout label="control next turn" value={formatInteger(derived.controlNext)} />
        <Readout
          hint="the hard cap on an emission move this turn"
          label="emission step"
          value={formatPp(derived.emissionStepLimitPp)}
        />
        <Readout
          hint={state.mobilized
            ? "includes mobilization's +" + ECONOMY_CONSTANTS.MOB_STEP_BONUS_PP.toFixed(2) + " pp"
            : "the hard cap on a military move this turn"}
          label="military step"
          value={formatPp(derived.militaryStepLimitPp)}
        />
      </div>

      <p className={styles.subhead}>the eleven bands</p>
      <div className={styles.tableWrap}>
        <ul className={styles.strip}>
          {CONTROL_BANDS.map((band, index) => {
            return (
              <li
                className={styles.band}
                data-on={derived.controlBandIndex === index}
                key={band.name}
              >
                <span className={styles.bandName} title={band.name}>{band.name}</span>
                <span className={styles.bandMeta}>{band.min}–{band.max}</span>
                <span className={styles.bandMeta}>
                  {formatSigned(formatPp(controlGrowthPpOf(index)), controlGrowthPpOf(index))}
                </span>
                <span className={styles.bandMeta}>{formatFactor(controlFrMultiplierOf(index))} FR</span>
                <span className={styles.bandMeta}>step {formatPp(stepLimitPpOf(index))}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <p className={styles.note}>
        band {ECONOMY_CONSTANTS.CONTROL_NEUTRAL_BAND_INDEX} — position{" "}
        {ECONOMY_CONSTANTS.START_CONTROL} — is neutral: no growth bonus, no FR penalty, and a step of{" "}
        {formatPp(ECONOMY_CONSTANTS.STEP_LIMIT_NEUTRAL_PP)}. tightening control widens the step and
        cuts FR; loosening it does the reverse. planned growth is{" "}
        {formatPct(derived.plannedGrowthPct)}.
      </p>
    </section>
  );
}

export { EconomyStanding };
