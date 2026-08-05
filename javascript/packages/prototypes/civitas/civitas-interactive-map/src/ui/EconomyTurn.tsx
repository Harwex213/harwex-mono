import { useEffect, useRef, useState } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { ECONOMY_CONSTANTS } from "../economy/constants";
import { buildHistoryView } from "./economics-history";
import { dismissTurnOutcome, endEconomyTurn, lastTurnOutcome } from "../state/economy-store";
import { formatInteger, formatPct } from "./economics-format";
import { splitWarning } from "./economics-history";
import { statePersistent } from "../state/world-store";
import type { SectionProps } from "./EconomyField";
import styles from "./economics.module.css";

// End Turn, its pre-flight error list, and the turn history.
//
// TWO-STAGE, BECAUSE AN END TURN CANNOT BE UNDONE. `resolveTurn` is synchronous,
// so a fast double click would advance two turns with no way back. The first press
// arms the button, a second press within five seconds resolves, and the arm is
// dropped by the timeout, by a change of country and on unmount.

const ARM_MS = 5000;

function EconomyTurn(props: SectionProps) {
  useSignals();

  const countryId = props.slot.countryId;
  const state = props.slot.state;
  const derived = props.derived;
  const persistent = statePersistent.value;
  const outcome = lastTurnOutcome.value;

  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function disarm(): void {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setArmed(false);
  }

  // Switching country must not leave another country's turn armed, and neither
  // must unmounting the panel.
  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, []);

  useEffect(() => {
    disarm();
  }, [countryId]);

  const blocked = !persistent;
  const turns = buildHistoryView(state.history);
  const shown = outcome !== null && outcome.countryId === countryId ? outcome : null;

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>End turn</h3>
      <p className={styles.sectionSub}>the engine's fifteen-step pipeline, then the record of what moved</p>

      {derived.errors.length === 0 ? (
        <p className={styles.note}>no blocking errors — the turn can be resolved.</p>
      ) : (
        <ul className={styles.errorList}>
          {derived.errors.map((error, at) => {
            return (
              <li className={styles.errorRow} key={error.code + error.field + at}>
                <span className={styles.chip}>{error.code}</span>
                <span className={styles.errorField}>{error.field}</span>
                <span>{error.message}</span>
              </li>
            );
          })}
        </ul>
      )}

      {derived.warnings.length === 0 ? null : (
        <ul className={styles.errorList}>
          {derived.warnings.map((warning, at) => {
            const parsed = splitWarning(warning);
            return (
              <li className={styles.errorRow} data-tone="warn" key={warning + at}>
                {parsed.code === null ? null : <span className={styles.chip}>{parsed.code}</span>}
                <span>{parsed.text}</span>
              </li>
            );
          })}
        </ul>
      )}

      <div className={styles.turnBar}>
        <button
          className={styles.endTurn}
          data-armed={armed}
          disabled={blocked}
          title={blocked
            ? "saving is off, so a resolved turn could never reach storage"
            : "resolve turn " + state.turn}
          type="button"
          onClick={() => {
            if (!armed) {
              setArmed(true);
              timer.current = setTimeout(() => {
                timer.current = null;
                setArmed(false);
              }, ARM_MS);
              return;
            }
            disarm();
            endEconomyTurn(countryId);
          }}
        >
          {armed ? "confirm turn " + formatInteger(state.turn) : "end turn " + formatInteger(state.turn)}
        </button>
        {blocked ? (
          <span className={styles.message}>
            saving is off. resolving a turn that can never be saved would lose it, so the control is
            disabled.
          </span>
        ) : (
          <span className={styles.hint}>
            {armed
              ? "press again to resolve — this cannot be undone"
              : "two presses: an End Turn cannot be undone"}
          </span>
        )}
      </div>

      {shown === null ? null : shown.ok ? (
        <div className={styles.notice} data-kind={shown.saved ? "info" : "error"} role="status">
          <p className={styles.note}>
            turn {formatInteger(shown.turn)} resolved. growth was{" "}
            {formatPct(shown.record.overallGrowthPct)}, and the rating moved from{" "}
            {formatInteger(shown.record.ratingScore)} to {formatInteger(shown.record.ratingNext)}.
          </p>
          {shown.saved ? null : (
            <p className={styles.note}>
              the economy advanced in memory but did NOT reach storage. remove a flag or a province
              image, then edit any field to retry the save.
            </p>
          )}
          <div className={styles.actions}>
            <button className={styles.button} type="button" onClick={dismissTurnOutcome}>
              dismiss
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.notice} data-kind="error" role="alert">
          <p className={styles.note}>
            turn {formatInteger(shown.turn)} was not resolved and nothing changed.
          </p>
          <ul className={styles.errorList}>
            {shown.errors.map((error, at) => {
              return (
                <li className={styles.errorRow} key={error.code + error.field + at}>
                  <span className={styles.chip}>{error.code}</span>
                  <span className={styles.errorField}>{error.field}</span>
                  <span>{error.message}</span>
                </li>
              );
            })}
          </ul>
          <div className={styles.actions}>
            <button className={styles.button} type="button" onClick={dismissTurnOutcome}>
              dismiss
            </button>
          </div>
        </div>
      )}

      <p className={styles.subhead}>turn history</p>
      {turns.length === 0 ? (
        <p className={styles.note}>
          no turns resolved yet — the sheet above is turn {formatInteger(state.turn)}.
        </p>
      ) : (
        <div className={styles.historyList}>
          {turns.map((turn, index) => {
            return (
              <details className={styles.historyTurn} key={turn.turn} open={index === 0}>
                <summary className={styles.historySummary}>turn {formatInteger(turn.turn)}</summary>
                <div className={styles.historyHeadline}>
                  {turn.headline.map((entry) => {
                    return (
                      <span className={styles.historyDelta} key={entry.label}>
                        <span>{entry.label}</span>
                        <span className={styles.historyDeltaValue} data-sign={entry.sign}>
                          {entry.text}
                        </span>
                      </span>
                    );
                  })}
                </div>

                {turn.warnings.length === 0 ? null : (
                  <ul className={styles.chips}>
                    {turn.warnings.map((warning, at) => {
                      return (
                        <li className={styles.errorRow} data-tone="warn" key={warning.text + at}>
                          {warning.code === null ? null : (
                            <span className={styles.chip}>{warning.code}</span>
                          )}
                          <span>{warning.text}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {turn.steps.map((step) => {
                  return (
                    <div className={styles.historyStep} key={step.key}>
                      <span className={styles.historyStepTitle}>{step.title}</span>
                      {step.quiet ? (
                        <span className={styles.historyQuiet}>no change</span>
                      ) : (
                        <ul className={styles.historyDeltas}>
                          {step.deltas.map((delta) => {
                            return (
                              <li className={styles.historyDelta} key={delta.label}>
                                <span>{delta.label}</span>
                                <span className={styles.historyDeltaValue} data-sign={delta.sign}>
                                  {delta.text}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {step.notes.map((note, at) => {
                        return (
                          <p className={styles.historyNote} key={note + at}>
                            {note}
                          </p>
                        );
                      })}
                    </div>
                  );
                })}
              </details>
            );
          })}
        </div>
      )}

      <p className={styles.note}>
        the engine keeps the last {ECONOMY_CONSTANTS.TURN_HISTORY_MAX} turns; an older record is
        dropped to keep the saved document inside its storage budget. a zero-valued row is hidden, so
        a step that reads &quot;no change&quot; ran and moved nothing.
      </p>
    </section>
  );
}

export { EconomyTurn };
