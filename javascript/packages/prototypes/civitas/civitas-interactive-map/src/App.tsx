import { useEffect } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { MapCanvas } from "./ui/MapCanvas";
import { ensureMapLoaded, loadError, loadPhase, loadProgress, loadStep } from "./state/map-store";
import {
  dismissStateWarning,
  initWorldStore,
  installStateFlush,
  stateWarning,
} from "./state/world-store";
import styles from "./app.module.css";

function statusLine(phase: string, step: string, progress: number, error: string | null): string {
  if (phase === "loading") {
    return "loading " + step + " " + Math.round(progress * 100) + "%";
  }
  if (phase === "failed") {
    return "failed: " + (error ?? "unknown error");
  }
  return phase;
}

function App() {
  // Reactivity is opt-in per component — without this call nothing below
  // re-renders when the load progresses.
  useSignals();

  useEffect(() => {
    // First, and synchronously: a panel added by a later task must never read an
    // un-hydrated store, and hydration cannot delay the map load because it does
    // not await anything.
    initWorldStore();
    const uninstall = installStateFlush();
    // Never rejects; a failure lands in `loadError`.
    ensureMapLoaded();
    return uninstall;
  }, []);

  const phase = loadPhase.value;
  const warning = stateWarning.value;

  return (
    <div className={styles.app}>
      {/* Mounted unconditionally, so the viewport is measured while the assets
          are still loading and the first painted frame is already fitted. */}
      <MapCanvas />

      {warning === null ? null : (
        <div className={styles.warning} data-kind={warning.kind}>
          <span className={styles.warningText}>{warning.message}</span>
          <button className={styles.warningDismiss} type="button" onClick={dismissStateWarning}>
            dismiss
          </button>
        </div>
      )}

      {phase === "ready" ? null : (
        <p className={styles.status} data-phase={phase}>
          {statusLine(phase, loadStep.value, loadProgress.value, loadError.value)}
        </p>
      )}
    </div>
  );
}

export { App };
