import { useSignals } from "@preact/signals-react/runtime";
import { fromHex } from "../map/colors";
import type { ProvinceKind } from "../map/manifest";
import {
  activeProvinceId,
  addProvince,
  deleteProvince,
  mapInfo,
  provinces,
  recolorProvince,
  renameProvince,
  setProvinceKind,
} from "../state/editor-state";
import styles from "./province-panel.module.css";

const KINDS: ProvinceKind[] = ["land", "sea", "lake"];

function ProvincePanel() {
  useSignals();

  const disabled = mapInfo.value === null;
  const list = provinces.value;

  return (
    <aside className={styles.panel}>
      <header className={styles.header}>
        <h2 className={styles.heading}>
          Provinces<span className={styles.count}>{list.length}</span>
        </h2>
        <button disabled={disabled} onClick={addProvince} type="button">
          + New
        </button>
      </header>

      <ul className={styles.list}>
        {list.map((province) => {
          const active = province.id === activeProvinceId.value;

          return (
            <li
              className={active ? `${styles.item} ${styles.itemActive}` : styles.item}
              key={province.id}
              onClick={() => {
                activeProvinceId.value = province.id;
              }}
            >
              <div className={styles.top}>
                {/* A native colour input, so a province can be pinned to an exact
                    value when the palette has to match an existing map. */}
                <input
                  className={styles.swatch}
                  onChange={(event) => {
                    const rgb = fromHex(event.target.value);

                    if (rgb) {
                      recolorProvince(province.id, rgb);
                    }
                  }}
                  type="color"
                  value={province.hex}
                />
                <input
                  onChange={(event) => {
                    renameProvince(province.id, event.target.value);
                  }}
                  type="text"
                  value={province.name}
                />
              </div>
              <div className={styles.bottom}>
                <span className={styles.hex}>{province.hex}</span>
                <select
                  onChange={(event) => {
                    setProvinceKind(province.id, event.target.value as ProvinceKind);
                  }}
                  value={province.kind}
                >
                  {KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
                <button
                  className={styles.remove}
                  onClick={(event) => {
                    event.stopPropagation();

                    if (window.confirm(`Delete ${province.name} and erase its pixels?`)) {
                      deleteProvince(province.id);
                    }
                  }}
                  title="Delete the province and erase its pixels"
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
        <p className={styles.empty}>No provinces yet. Add one to start painting.</p>
      )}
    </aside>
  );
}

export { ProvincePanel };
