import { useEffect } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { MapPage } from "./ui/pages/map/map-page";
import { useStore } from "./store/index";
import type { TAppRegistry } from "./actions/index";
import styles from "./app.module.css";

type TAppProps = {
  registry: TAppRegistry;
};

function statusLine(phase: string, step: string, progress: number, error: string | null): string {
  if (phase === "loading") {
    return "loading " + step + " " + Math.round(progress * 100) + "%";
  }
  if (phase === "failed") {
    return "failed: " + (error ?? "unknown error");
  }
  return phase;
}

function App({ registry }: TAppProps) {
  // Without this call the component does not re-render on load progress.
  useSignals();
  const store = useStore();

  useEffect(() => {
    const stopCountrySync = registry.startCountryBorderSync();
    // Never rejects; a failure lands in `map.error`. It also loads the countries.
    void registry.loadMap();

    return () => {
      stopCountrySync();
    };
  }, [registry]);

  const phase = store.map.phase.value;
  const notice = store.world.notice.value;

  return (
    <div className={styles.app}>
      {/* `App` stays lifecycle-shaped and renders one child. `MapPage` owns the
          layout, and the map inside it is mounted unconditionally, so the
          viewport is measured while the assets are still loading and the first
          painted frame is already fitted. */}
      <MapPage registry={registry} />

      {notice === null ? null : (
        <div className={styles.warning}>
          <span className={styles.warningText}>{notice}</span>
          <button
            className={styles.warningDismiss}
            type="button"
            onClick={registry.dismissCountriesNotice}
          >
            dismiss
          </button>
        </div>
      )}

      {phase === "ready" ? null : (
        <p className={styles.status} data-phase={phase}>
          {statusLine(phase, store.map.step.value, store.map.progress.value, store.map.error.value)}
        </p>
      )}
    </div>
  );
}

export { App };
