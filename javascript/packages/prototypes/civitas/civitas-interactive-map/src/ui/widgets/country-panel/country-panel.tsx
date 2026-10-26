import { useSignals } from "@preact/signals-react/runtime";
import { countryDisplayName } from "../../../domain/index";
import { useStore } from "../../../store/index";
import type { TAppRegistry } from "../../../actions/index";
import styles from "./country-panel.module.css";

type TCountryPanelRegistry = Pick<TAppRegistry, "selectCountry">;

// The read-only list of the countries from `assets/countries.json`.
// The editor in `../civitas-map` creates them. A row click selects the country.
// A sibling of `MapCanvas`, so it needs no `data-hud-control`.

function CountryRow(props: {
  registry: TCountryPanelRegistry;
  countryId: number;
  name: string;
  colorHex: string;
  provinceCount: number;
  pixelCount: number;
  selected: boolean;
}) {
  return (
    <div
      className={styles.row}
      data-selected={props.selected ? "true" : "false"}
      onClick={() => {
        props.registry.selectCountry(props.countryId);
      }}
    >
      <span className={styles.swatch} style={{ background: props.colorHex }} />
      <div className={styles.rowBody}>
        <span className={styles.name}>{countryDisplayName(props.countryId, props.name)}</span>
        <span className={styles.stats}>
          {props.provinceCount} prov · {props.pixelCount.toLocaleString()} px
        </span>
      </div>
    </div>
  );
}

function CountryPanel({ registry }: { registry: TCountryPanelRegistry }) {
  useSignals();
  const store = useStore();

  const list = store.world.countries.value;
  const selected = store.selection.selectedCountryId.value;
  const aggregates = store.labels.aggregates.value;

  return (
    <aside className={styles.panel}>
      <header className={styles.header}>
        <span className={styles.title}>Countries</span>
      </header>

      <div className={styles.list}>
        {list.length === 0 ? (
          <p className={styles.empty}>no countries yet</p>
        ) : (
          list.map((country) => {
            const aggregate = aggregates.get(country.id);
            return (
              <CountryRow
                key={country.id}
                registry={registry}
                countryId={country.id}
                name={country.name}
                colorHex={country.colorHex}
                provinceCount={aggregate ? aggregate.provinceCount : country.provinceIds.length}
                pixelCount={aggregate ? aggregate.pixelCount : 0}
                selected={selected === country.id}
              />
            );
          })
        )}
      </div>
    </aside>
  );
}

export { CountryPanel, type TCountryPanelRegistry };
