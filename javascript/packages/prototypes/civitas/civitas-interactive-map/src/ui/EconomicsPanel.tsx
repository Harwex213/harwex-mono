import { useSignals } from "@preact/signals-react/runtime";
import { EconomyBudget } from "./EconomyBudget";
import { EconomyDebt } from "./EconomyDebt";
import { EconomyFlags } from "./EconomyFlags";
import { EconomyResources } from "./EconomyResources";
import { EconomySavings } from "./EconomySavings";
import { EconomySectors } from "./EconomySectors";
import { EconomyStanding } from "./EconomyStanding";
import { EconomyTurn } from "./EconomyTurn";
import { Panel } from "./Panel";
import { TAG_LEGEND } from "./economics-fields";
import { judgeMode, selectedDerived, selectedEconomy, toggleJudgeMode } from "../state/economy-store";
import { saveNoticeFor } from "./country-overview";
import { selectedCountry } from "../state/selection-store";
import { stateWarning } from "../state/world-store";
import { formatInteger } from "./economics-format";
import styles from "./economics.module.css";
import bodyStyles from "./panel-bodies.module.css";

// The economics sheet: all twelve areas of the spec, driven entirely by the
// engine in `src/economy/`.
//
// NO FORMULA LIVES IN THIS SUBTREE. Every number comes from `selectedDerived`,
// which is one memoised `deriveEconomy` call. The panel decides who may type into
// what and how a value is printed, and nothing else.
//
// The panel root carries `data-judge`, so one CSS rule marks every unlocked [V]
// field instead of a prop threaded through eleven components.

const REPAIRS_SHOWN = 5;

function EconomicsPanel() {
  useSignals();

  const country = selectedCountry.value;
  const slot = selectedEconomy.value;
  const derived = selectedDerived.value;
  const warning = stateWarning.value;
  const judge = judgeMode.value;

  if (country === null) {
    return (
      <Panel panelId="economics" title="Economics">
        <p className={bodyStyles.empty}>no country selected — the economy sheet is per country</p>
      </Panel>
    );
  }

  // Unreachable while `country` is non-null, but the types say it is possible and
  // an unchecked `!` is not allowed in this codebase.
  if (slot === null || derived === null) {
    return (
      <Panel panelId="economics" title="Economics">
        <p className={bodyStyles.empty}>no economy for this country yet</p>
      </Panel>
    );
  }

  const notice = saveNoticeFor(warning, false);
  const repairs = slot.repairs;

  return (
    <Panel
      panelId="economics"
      subtitle={country.name + " — turn " + formatInteger(slot.state.turn)}
      title="Economics"
    >
      <div className={styles.sheet} data-judge={judge ? "true" : "false"}>
        {notice === null ? null : (
          <p className={styles.notice} data-kind={notice.kind} role="status">
            {notice.text}
          </p>
        )}

        {/* Naturally present only until the first edit: after it the draft wins
            and the repairs have been superseded. */}
        {repairs.length === 0 ? null : (
          <p className={styles.notice} data-kind="warn" role="status">
            the saved economy was repaired on load: {repairs.slice(0, REPAIRS_SHOWN).join("; ")}
            {repairs.length > REPAIRS_SHOWN
              ? " and " + (repairs.length - REPAIRS_SHOWN) + " more"
              : ""}
          </p>
        )}

        <div className={styles.head}>
          <ul className={styles.legend}>
            {TAG_LEGEND.map((entry) => {
              return (
                <li className={styles.legendItem} key={entry.tag}>
                  <span className={styles.tag} data-tag={entry.tag}>
                    {entry.tag}
                  </span>
                  <span className={styles.legendTitle}>{entry.title}</span>
                  <span>{entry.help}</span>
                </li>
              );
            })}
          </ul>
          <label className={styles.judgeToggle} data-on={judge ? "true" : "false"}>
            <input
              className={styles.checkbox}
              checked={judge}
              type="checkbox"
              onChange={toggleJudgeMode}
            />
            judge mode — unlocks [V] fields
          </label>
        </div>

        <EconomySectors derived={derived} slot={slot} />
        <EconomyStanding derived={derived} slot={slot} />
        <EconomyBudget derived={derived} slot={slot} />
        <EconomySavings derived={derived} slot={slot} />
        <EconomyResources derived={derived} slot={slot} />
        <EconomyDebt derived={derived} slot={slot} />
        <EconomyFlags derived={derived} slot={slot} />
        <EconomyTurn derived={derived} slot={slot} />
      </div>
    </Panel>
  );
}

export { EconomicsPanel };
