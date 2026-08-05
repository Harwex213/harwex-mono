import { ECONOMY_CONSTANTS } from "../economy/constants";
import { NumberField, errorFor } from "./EconomyField";
import { Readout } from "./EconomyReadout";
import { formatDrag, formatPoints } from "./economics-format";
import { updateEconomy } from "../state/economy-store";
import type { NumberSpec } from "./economics-fields";
import type { SectionProps } from "./EconomyField";
import styles from "./economics.module.css";

// Spec area 6: the FR reserve and the MIC stockpile.
//
// The applied forms sit beside the raw inputs. V14's clip and V15's refusal are
// otherwise invisible: a player types 900 into the reserve, the cap allows 400,
// and without the applied readout nothing on the sheet says which number the turn
// used.

const POINTS_SPEC: NumberSpec = { min: 0, max: 1e9, decimals: 2, integer: false };

function EconomySavings(props: SectionProps) {
  const countryId = props.slot.countryId;
  const state = props.slot.state;
  const derived = props.derived;

  const addClipped = derived.reserveAddApplied !== state.reserveAdd;
  const withdrawClipped = derived.reserveWithdrawApplied !== state.reserveWithdraw;
  const stockWithdrawClipped = derived.micStockWithdrawApplied !== state.micStockWithdraw;

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Reserves and stockpiles</h3>
      <p className={styles.sectionSub}>area 6 — the FR reserve under its cap, the MIC stockpile under its upkeep</p>

      <p className={styles.subhead}>FR reserve</p>
      <div className={styles.grid}>
        <Readout label="reserve at turn start" value={formatPoints(state.reserveFr)} />
        <Readout
          hint={"the cap is " + ECONOMY_CONSTANTS.RESERVE_CAP_MULTIPLE.toFixed(2) + " annual incomes"}
          label="reserve cap"
          value={formatPoints(derived.reserveCap)}
        />
        <NumberField
          key={"reserve-add-" + countryId}
          error={errorFor(derived, "reserveAdd")}
          label="add to reserve"
          spec={POINTS_SPEC}
          suffix="FR"
          tag="P"
          value={state.reserveAdd}
          onCommit={(next) => {
            updateEconomy(countryId, (current) => {
              return { ...current, reserveAdd: next };
            });
          }}
        />
        {addClipped ? (
          <Readout
            hint="an addition over the cap is refused, not clipped to zero"
            label="addition applied"
            tone="bad"
            value={formatPoints(derived.reserveAddApplied)}
          />
        ) : null}
        <NumberField
          key={"reserve-withdraw-" + countryId}
          error={errorFor(derived, "reserveWithdraw")}
          label="withdraw from reserve"
          spec={POINTS_SPEC}
          suffix="FR"
          tag="P"
          value={state.reserveWithdraw}
          onCommit={(next) => {
            updateEconomy(countryId, (current) => {
              return { ...current, reserveWithdraw: next };
            });
          }}
        />
        {withdrawClipped ? (
          <Readout
            hint="clipped to what the reserve holds"
            label="withdrawal applied"
            tone="bad"
            value={formatPoints(derived.reserveWithdrawApplied)}
          />
        ) : null}
        <Readout label="reserve at turn end" value={formatPoints(derived.reserveEnd)} />
        {/* The engine keeps this penalty as a positive magnitude and SUBTRACTS
            it, so it prints negated: a "+" would read as a growth bonus. */}
        <Readout
          hint={"a banked point costs " + ECONOMY_CONSTANTS.RESERVE_PENALTY_MULTIPLE.toFixed(2)
            + "x the growth it would have added through auto-investment"}
          label="reserve growth penalty"
          tone={derived.reservePenaltyPp > 0 ? "bad" : "normal"}
          value={formatDrag(derived.reservePenaltyPp)}
        />
      </div>

      <p className={styles.subhead}>MIC stockpile</p>
      <div className={styles.grid}>
        <Readout label="stockpile at turn start" value={formatPoints(state.micStock)} />
        <NumberField
          key={"stock-add-" + countryId}
          error={errorFor(derived, "micStockAdd")}
          label="add to stockpile"
          spec={POINTS_SPEC}
          suffix="MIC"
          tag="P"
          value={state.micStockAdd}
          onCommit={(next) => {
            updateEconomy(countryId, (current) => {
              return { ...current, micStockAdd: next };
            });
          }}
        />
        <NumberField
          key={"stock-withdraw-" + countryId}
          error={errorFor(derived, "micStockWithdraw")}
          label="withdraw from stockpile"
          spec={POINTS_SPEC}
          suffix="MIC"
          tag="P"
          value={state.micStockWithdraw}
          onCommit={(next) => {
            updateEconomy(countryId, (current) => {
              return { ...current, micStockWithdraw: next };
            });
          }}
        />
        {stockWithdrawClipped ? (
          <Readout
            hint="clipped to what the stockpile holds"
            label="withdrawal applied"
            tone="bad"
            value={formatPoints(derived.micStockWithdrawApplied)}
          />
        ) : null}
        <Readout
          hint={ECONOMY_CONSTANTS.MIC_UPKEEP_FR_PER_POINT.toFixed(2) + " FR per stockpiled point per turn"}
          label="upkeep due"
          value={formatPoints(derived.micUpkeepDue)}
        />
        <Readout label="upkeep paid" value={formatPoints(derived.micUpkeepPaid)} />
        <Readout
          hint="only the points the budget could not cover are lost"
          label="stockpile lost"
          tone={derived.micStockLost > 0 ? "bad" : "normal"}
          value={formatPoints(derived.micStockLost)}
        />
        <Readout label="stockpile at turn end" value={formatPoints(derived.micStockEnd)} />
      </div>

      <p className={styles.note}>
        the reserve cap is two annual incomes; an addition over the cap is refused, not clipped to
        zero. a stockpile has no cap, and unpaid upkeep loses only the points the budget could not
        cover.
      </p>
    </section>
  );
}

export { EconomySavings };
