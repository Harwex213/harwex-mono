import { useSignals } from "@preact/signals-react/runtime";
import { Panel } from "./Panel";
import { selectedCountry } from "../state/selection-store";
import styles from "./panel-bodies.module.css";

// A PHASE-3 PLACEHOLDER. T11-B implements the calculator and T12 renders the
// sheet. Nothing here reads or writes the `economics` slot.

function EconomicsPanel() {
  useSignals();

  const country = selectedCountry.value;

  if (country === null) {
    return (
      <Panel panelId="economics" title="Economics">
        <p className={styles.empty}>
          no country selected — the economy sheet is per country
        </p>
      </Panel>
    );
  }

  return (
    <Panel panelId="economics" subtitle={country.name} title="Economics">
      <dl className={styles.readouts}>
        <div className={styles.readout}>
          <dt className={styles.readoutTerm}>country</dt>
          <dd className={styles.readoutValue}>{country.name}</dd>
        </div>
        <div className={styles.readout}>
          <dt className={styles.readoutTerm}>turn</dt>
          <dd className={styles.readoutValue}>—</dd>
        </div>
      </dl>
      <p className={styles.note}>
        T11-B implements the calculator; T12 renders the sheet.
      </p>
    </Panel>
  );
}

export { EconomicsPanel };
