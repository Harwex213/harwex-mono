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
    // First and synchronous, so no panel reads an un-hydrated store.
    registry.hydrateWorld();
    const stopCountrySync = registry.startCountryBorderSync();
    // Never rejects; a failure lands in `map.error`.
    void registry.loadMap();

    // Also on `visibilitychange`: iOS Safari can kill a hidden tab without `pagehide`.
    const onPageHide = (): void => {
      try {
        registry.flushWorld();
      } catch {
        // Never throw during unload.
      }
    };
    const onVisibility = (): void => {
      if (document.visibilityState !== "hidden") {
        return;
      }
      onPageHide();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      stopCountrySync();
    };
  }, [registry]);

  const phase = store.map.phase.value;
  const warning = store.world.warning.value;

  return (
    <div className={styles.app}>
      {/* `App` stays lifecycle-shaped and renders one child. `MapPage` owns the
          layout, and the map inside it is mounted unconditionally, so the
          viewport is measured while the assets are still loading and the first
          painted frame is already fitted. */}
      <MapPage registry={registry} />

      {warning === null ? null : (
        <div className={styles.warning} data-kind={warning.kind}>
          <span className={styles.warningText}>{warning.message}</span>
          <button
            className={styles.warningDismiss}
            type="button"
            onClick={registry.dismissStateWarning}
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
