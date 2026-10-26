import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../../store/index";
import styles from "./status-bar.module.css";

function StatusBar() {
  useSignals();

  const store = useStore();
  const pixel = store.hover.pixel.value;
  const hovered = store.hover.province.value;
  const active = store.provinces.active.value;
  const countriesMode = store.tools.mode.value === "countries";
  const ownerId = hovered ? store.countries.owners.value.get(hovered.id) : undefined;
  const owner = ownerId === undefined ? null : (store.countries.list.value.find((country) => country.id === ownerId) ?? null);
  const activeCountry = store.countries.active.value;

  return (
    <footer className={styles.bar}>
      <span className={styles.cell}>{countriesMode ? "countries" : store.tools.tool.value}</span>
      <span className={styles.cell}>{Math.round(store.view.view.value.scale * 100)}%</span>
      <span className={styles.cell}>{pixel ? `${pixel.x}, ${pixel.y}` : "—"}</span>

      <span className={styles.cell}>
        under cursor:
        {hovered ? (
          <>
            <i className={styles.dot} style={{ background: hovered.hex }} />
            {hovered.name}
          </>
        ) : (
          <span className={styles.dim}>{store.map.info.value ? "unpainted" : "no map"}</span>
        )}
      </span>

      {countriesMode && hovered && (
        <span className={styles.cell}>
          country:
          {owner ? (
            <>
              <i className={styles.dot} style={{ background: owner.colorHex }} />
              {owner.name}
            </>
          ) : (
            <span className={styles.dim}>none</span>
          )}
        </span>
      )}

      <span className={styles.spacer} />

      {countriesMode ? (
        <span className={styles.cell}>
          assigning to:
          {activeCountry ? (
            <>
              <i className={styles.dot} style={{ background: activeCountry.colorHex }} />
              {activeCountry.name}
            </>
          ) : (
            <span className={styles.dim}>none</span>
          )}
        </span>
      ) : (
        <span className={styles.cell}>
          painting:
          {active ? (
            <>
              <i className={styles.dot} style={{ background: active.hex }} />
              {active.name}
            </>
          ) : (
            <span className={styles.dim}>none</span>
          )}
        </span>
      )}
    </footer>
  );
}

export { StatusBar };
