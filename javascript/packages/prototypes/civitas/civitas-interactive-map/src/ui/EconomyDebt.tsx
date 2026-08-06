import { NumberField, ToggleField, errorFor } from "./EconomyField";
import { Readout } from "./EconomyReadout";
import { formatFactor, formatInteger, formatPct, formatPoints, formatTurns } from "./economics-format";
import { updateEconomy, updateLoan } from "../state/economy-store";
import type { LoanServiceDerived } from "../economy/types";
import type { NumberSpec } from "./economics-fields";
import type { SectionProps } from "./EconomyField";
import styles from "./economics.module.css";

// Spec area 11: borrowing capacity from the credit tier, the loan book, and this
// turn's servicing.
//
// `borrowRequest`'s spec max IS `newLoanAvailable`, and the field is disabled with
// the reason spelled out in tier F or in default, so V7 cannot be produced through
// the panel. A silently accepted number the turn then rejects is worse than a
// disabled field that says why.

const POINTS_SPEC_MAX = 1e9;

function serviceFor(rows: readonly LoanServiceDerived[], loanId: number): LoanServiceDerived | null {
  for (const row of rows) {
    if (row.loanId === loanId) {
      return row;
    }
  }
  return null;
}

function EconomyDebt(props: SectionProps) {
  const countryId = props.slot.countryId;
  const state = props.slot.state;
  const derived = props.derived;

  const tierF = derived.ratingTier === "F";
  const inDefault = state.debtStatus === "default";
  const blocked = tierF
    ? "tier F cannot borrow at all"
    : inDefault
      ? "in default — borrowing reopens after one turn closes with no shortfall"
      : null;

  const borrowSpec: NumberSpec = {
    min: 0,
    max: Math.max(0, derived.newLoanAvailable),
    decimals: 2,
    integer: false,
  };
  const allocationSpec: NumberSpec = { min: 0, max: POINTS_SPEC_MAX, decimals: 2, integer: false };

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Debt</h3>
      <p className={styles.sectionSub}>area 11 — capacity, borrowing, the loan book, servicing</p>

      <div className={styles.grid}>
        <Readout label="tier" value={derived.ratingTier} />
        <Readout
          hint="a multiple of annual FR income, set by the tier"
          label="debt limit"
          value={formatPoints(derived.debtLimit)}
        />
        <Readout label="outstanding" value={formatPoints(derived.debtOutstanding)} />
        <Readout label="headroom" value={formatPoints(derived.newLoanAvailable)} />
        <Readout label="new loan rate" value={formatPct(derived.newLoanRatePct)} />
        <Readout label="new loan term" value={formatTurns(derived.newLoanTermTurns)} />
        <Readout
          label="status"
          tone={state.debtStatus === "normal" ? "normal" : "bad"}
          value={state.debtStatus}
        />
        <Readout
          label="status next turn"
          tone={derived.debtStatusNext === "normal" ? "normal" : "bad"}
          value={derived.debtStatusNext}
        />
      </div>

      <div className={styles.gridWide}>
        <NumberField
          key={"borrow-" + countryId}
          blocked={blocked}
          error={errorFor(derived, "borrowRequest")}
          hint={"at most " + formatPoints(derived.newLoanAvailable) + " FR this turn"}
          label="borrow this turn"
          spec={borrowSpec}
          suffix="FR"
          tag="P"
          value={state.borrowRequest}
          onCommit={(next) => {
            updateEconomy(countryId, (current) => {
              return { ...current, borrowRequest: next };
            });
          }}
        />
        <ToggleField
          key={"auto-service-" + countryId}
          hint="off means you allocate FR to each loan by hand"
          label="automatic debt service"
          tag="P"
          value={state.debtAutoService}
          onCommit={(next) => {
            updateEconomy(countryId, (current) => {
              return { ...current, debtAutoService: next };
            });
          }}
        />
      </div>

      {state.loans.length === 0 ? (
        <p className={styles.note}>no loans outstanding.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">loan</th>
                <th scope="col">principal</th>
                <th scope="col">rate</th>
                <th scope="col">term</th>
                <th scope="col">turns left</th>
                <th scope="col">required</th>
                <th scope="col">allocated</th>
                <th scope="col">interest</th>
                <th scope="col">principal paid</th>
                <th scope="col">shortfall</th>
              </tr>
            </thead>
            <tbody>
              {state.loans.map((loan) => {
                const service = serviceFor(derived.loanService, loan.id);
                const takenThisTurn = loan.createdTurn === state.turn;
                return (
                  <tr key={loan.id}>
                    <td>
                      #{loan.id}
                      {takenThisTurn ? (
                        <span className={styles.hint}>
                          {" "}taken this turn — its first payment falls next turn
                        </span>
                      ) : null}
                    </td>
                    <td>{formatPoints(loan.principal)}</td>
                    <td>{formatPct(loan.ratePct)}</td>
                    <td>{formatInteger(loan.termTurns)}</td>
                    <td>{formatInteger(loan.turnsRemaining)}</td>
                    <td>{formatPoints(service?.requiredFr ?? 0)}</td>
                    <td className={styles.cellInput}>
                      {/* Spec 14.5: `allocatedFr` is [P] only while auto-service
                          is off. With it on the engine owns the number, so the
                          cell is a readout and there is no input to type into. */}
                      {state.debtAutoService ? (
                        formatPoints(service?.allocatedFr ?? loan.allocatedFr)
                      ) : (
                        <NumberField
                          key={"alloc-" + loan.id + "-" + countryId}
                          error={errorFor(derived, "loans." + loan.id + ".allocatedFr")}
                          label="allocate"
                          spec={allocationSpec}
                          suffix="FR"
                          tag="P"
                          value={loan.allocatedFr}
                          onCommit={(next) => {
                            updateLoan(countryId, loan.id, { allocatedFr: next });
                          }}
                        />
                      )}
                    </td>
                    <td>{formatPoints(service?.interestDue ?? 0)}</td>
                    <td>{formatPoints(service?.principalPaid ?? 0)}</td>
                    <td className={(service?.shortfall ?? 0) > 0 ? styles.cellBad : styles.cellMuted}>
                      {formatPoints(service?.shortfall ?? 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.grid}>
        <Readout label="due this turn" value={formatPoints(derived.debtRequiredTotal)} />
        <Readout label="paid this turn" value={formatPoints(derived.debtAllocatedTotal)} />
        <Readout
          label="shortfall"
          tone={derived.debtShortfallTotal > 0 ? "bad" : "normal"}
          value={formatPoints(derived.debtShortfallTotal)}
        />
        <Readout
          label="rating cost from debt"
          tone={derived.debtRatingPenalty < 0 ? "bad" : "normal"}
          value={formatPoints(derived.debtRatingPenalty)}
        />
        <Readout label="loan proceeds this turn" value={formatPoints(derived.newLoanProceeds)} />
        <Readout label="rating factor" value={formatFactor(derived.ratingFactor)} />
      </div>

      <p className={styles.note}>
        debt service is charged after a reserve addition, so banking money can starve a loan. a
        shortfall costs rating points and pushes the status to arrears and then to default.
      </p>
    </section>
  );
}

export { EconomyDebt };
