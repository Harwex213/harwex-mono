import { useSignals } from "@preact/signals-react/runtime";
import type { TAppRegistry } from "../../../actions/index";
import { useStore } from "../../../store/index";
import styles from "./country-panel.module.css";

type TCountryPanelProps = {
  registry: Pick<TAppRegistry, "addCountry" | "deleteCountry" | "recolorCountry" | "renameCountry" | "selectCountry">;
};

// The right menu of the countries mode. A click on the map puts the province
// under the cursor into the active country; this panel creates, names, colours
// and deletes the countries. Countries are few, so every row is mounted.
function CountryPanel({ registry }: TCountryPanelProps) {
  useSignals();

  const store = useStore();
  const list = store.countries.list.value;
  const activeId = store.countries.activeId.value;
  const disabled = store.map.info.value === null;
  const noProvinces = store.provinces.list.value.length === 0;

  return (
    <aside className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.heading}>
          Countries<span className={styles.count}>{list.length}</span>
        </h2>
        <button
          disabled={disabled}
          onClick={() => {
            registry.addCountry();
          }}
          type="button"
        >
          + New
        </button>
      </header>

      <ul className={styles.list}>
        {list.map((country) => {
          const active = country.id === activeId;
          const count = country.provinceIds.length;

          return (
            <li
              className={active ? `${styles.item} ${styles.itemActive}` : styles.item}
              key={country.id}
              onClick={() => {
                registry.selectCountry(country.id);
              }}
            >
              <div className={styles.top}>
                <input
                  className={styles.swatch}
                  onChange={(event) => {
                    registry.recolorCountry(country.id, event.target.value);
                  }}
                  type="color"
                  value={country.colorHex}
                />
                <input
                  onChange={(event) => {
                    registry.renameCountry(country.id, event.target.value);
                  }}
                  type="text"
                  value={country.name}
                />
              </div>
              <div className={styles.bottom}>
                <span className={styles.stats}>
                  {count} {count === 1 ? "province" : "provinces"}
                </span>
                <button
                  className={styles.remove}
                  onClick={(event) => {
                    event.stopPropagation();

                    if (window.confirm(`Delete ${country.name}? Its provinces stay on the map.`)) {
                      registry.deleteCountry(country.id);
                    }
                  }}
                  title="Delete the country; its provinces become unassigned"
                  type="button"
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {list.length === 0 && !disabled && (
        <p className={styles.empty}>
          {noProvinces
            ? "No provinces yet. Paint or detect provinces first."
            : "No countries yet. Add one, then click provinces on the map."}
        </p>
      )}
    </aside>
  );
}

export { CountryPanel };
