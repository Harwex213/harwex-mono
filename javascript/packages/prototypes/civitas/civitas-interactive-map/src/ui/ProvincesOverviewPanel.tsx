import { useSignals } from "@preact/signals-react/runtime";
import { Panel } from "./Panel";
import { provinceDisplayName } from "../state/world-store";
import { selectProvince, selectedCountry, selectedProvinceId } from "../state/selection-store";
import styles from "./panel-bodies.module.css";

// A PHASE-3 PLACEHOLDER. T10 owns the real provinces overview, with an editable
// image, name and lore per row, and a virtualised list.
//
// THE CAP IS DELIBERATE. A 300-row unvirtualised list is exactly the performance
// trap T10 exists to solve, and shipping it here would make the shell feel slow
// before T10 lands.

const ROW_CAP = 50;

function ProvincesOverviewPanel() {
  useSignals();

  const country = selectedCountry.value;
  const selected = selectedProvinceId.value;

  if (country === null) {
    return (
      <Panel panelId="provinces" title="Provinces">
        <p className={styles.empty}>
          no country selected — right-click a province on the map to select its country
        </p>
      </Panel>
    );
  }

  const ids = country.provinceIds;
  const shown = ids.slice(0, ROW_CAP);
  const hidden = ids.length - shown.length;

  return (
    <Panel
      panelId="provinces"
      subtitle={country.name + " · " + ids.length + " provinces"}
      title="Provinces"
    >
      {ids.length === 0 ? (
        <p className={styles.empty}>
          this country holds no provinces — turn on assign mode and paint some
        </p>
      ) : (
        <ul className={styles.list}>
          {shown.map((id) => {
            return (
              <li key={id}>
                <button
                  className={styles.row}
                  data-on={selected === id ? "true" : "false"}
                  type="button"
                  onClick={() => {
                    selectProvince(id);
                  }}
                >
                  <span className={styles.rowName}>{provinceDisplayName(id)}</span>
                  <span className={styles.rowId}>{id}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {hidden > 0 ? (
        <p className={styles.note}>
          … and {hidden} more — T10 virtualises this list.
        </p>
      ) : (
        <p className={styles.note}>T10 replaces these rows with editable ones.</p>
      )}
    </Panel>
  );
}

export { ProvincesOverviewPanel, ROW_CAP };
