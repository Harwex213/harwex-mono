import { useSignals } from "@preact/signals-react/runtime";
import { getLastLabelStats } from "../../../services/index";
import { provinceAt, provinceById, useStore } from "../../../store/index";
import styles from "./map-canvas.module.css";

// A debug readout, kept on purpose. It shows that the screen-to-map transform holds
// and that border scans stay fast. It sits bottom-left, clear of the button bar.
function MapCanvasHud() {
  useSignals();
  const store = useStore();

  const current = store.view.view.value;
  const cursor = store.view.cursorMap.value;
  const id = cursor ? provinceAt(store, cursor.x, cursor.y) : null;
  const province = id === null ? null : provinceById(store, id);
  const scan = store.borders.stats.value;
  const country = store.borders.countryStats.value;
  const selected = store.selection.selectedProvinceId.value;
  // The message tells a failed scan from a slow one.
  const failure = store.borders.error.value;
  // One frame stale. The HUD re-renders on every cursor move, so the number stays live enough.
  const labelStats = getLastLabelStats();
  const labelsOn = store.labels.showLabels.value;

  return (
    <>
      <div className={styles.hud}>
        <span>
          zoom <span className={styles.hudValue}>
            {current ? Math.round(current.scale * 100) + "%" : "—"}
          </span>
        </span>
        {/* Checks the resize policy: a fitted view re-fits on resize, a manual zoom keeps its scale. */}
        <span>
          fit <span className={styles.hudValue}>{store.view.viewFitted.value ? "yes" : "no"}</span>
        </span>
        <span>
          px <span className={styles.hudValue}>
            {cursor ? cursor.x + ", " + cursor.y : "—"}
          </span>
        </span>
        <span>
          province <span className={styles.hudProvince}>
            {id === null ? "—" : id + (province ? " " + province.name : "")}
          </span>
        </span>
        <span>
          selected <span className={styles.hudProvince}>{selected === null ? "—" : selected}</span>
        </span>
        <span>
          scope <span className={styles.hudValue}>{store.selection.scope.value}</span>
        </span>
        <span>
          border <span className={styles.hudValue}>{store.borders.phase.value}</span>
        </span>
        {failure === null ? null : (
          <span>
            reason <span className={styles.hudValue}>{failure}</span>
          </span>
        )}
        <span>
          scan <span className={styles.hudValue}>
            {scan ? Math.round(scan.elapsedMs) + " ms" : "—"}
          </span>
        </span>
        <span>
          segs <span className={styles.hudValue}>{scan ? scan.segments : "—"}</span>
        </span>
        <span>
          country <span className={styles.hudValue}>
            {country ? Math.round(country.elapsedMs) + " ms / " + country.segments : "—"}
          </span>
        </span>
        <span>
          labels <span className={styles.hudValue}>{labelsOn ? "on" : "off"}</span>
        </span>
        <span>
          placed <span className={styles.hudValue}>
            {labelStats.drawn + "/" + labelStats.candidates}
          </span>
        </span>
      </div>
    </>
  );
}

export { MapCanvasHud };
