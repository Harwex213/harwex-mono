import { useSignals } from "@preact/signals-react/runtime";
import {
  activeProvince,
  hoverPixel,
  hoverProvince,
  mapInfo,
  tool,
  view,
} from "../state/editor-state";
import styles from "./status-bar.module.css";

const HINTS = "Wheel zoom · space or middle drag pans · right drag erases · B G E I · [ ] size · ⌘Z";

function StatusBar() {
  useSignals();

  const pixel = hoverPixel.value;
  const hovered = hoverProvince.value;
  const active = activeProvince.value;

  return (
    <footer className={styles.bar}>
      <span className={styles.cell}>{tool.value}</span>
      <span className={styles.cell}>{Math.round(view.value.scale * 100)}%</span>
      <span className={styles.cell}>{pixel ? `${pixel.x}, ${pixel.y}` : "—"}</span>

      <span className={styles.cell}>
        under cursor:
        {hovered ? (
          <>
            <i className={styles.dot} style={{ background: hovered.hex }} />
            {hovered.name}
          </>
        ) : (
          <span className={styles.dim}>{mapInfo.value ? "unpainted" : "no map"}</span>
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
