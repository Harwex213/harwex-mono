import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../../store/index";
import styles from "./status-bar.module.css";

const HINTS = "Wheel zoom · space or middle drag pans · right drag erases · B G E I · [ ] size · ⌘Z";

function StatusBar() {
  useSignals();

  const store = useStore();
  const pixel = store.hover.pixel.value;
  const hovered = store.hover.province.value;
  const active = store.provinces.active.value;

  return (
    <footer className={styles.bar}>
      <span className={styles.cell}>{store.tools.tool.value}</span>
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

      <span className={styles.spacer} />

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

      <span className={`${styles.cell} ${styles.dim}`}>{HINTS}</span>
    </footer>
  );
}

export { StatusBar };
