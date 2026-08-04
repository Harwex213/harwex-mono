import { useSignals } from "@preact/signals-react/runtime";
import { useState } from "react";
import { isAccepted } from "./map/map-image";
import { dismissError, error, openMapFile } from "./state/editor-state";
import { MapCanvas } from "./ui/MapCanvas";
import { ProvincePanel } from "./ui/ProvincePanel";
import { StatusBar } from "./ui/StatusBar";
import { Toolbar } from "./ui/Toolbar";
import { TopBar } from "./ui/TopBar";
import { useShortcuts } from "./ui/shortcuts";
import styles from "./app.module.css";

function App() {
  useSignals();
  useShortcuts();

  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={styles.app}
      onDragLeave={(event) => {
        // Only the drag leaving the window counts: moving between children fires
        // `dragleave` constantly and would flicker the overlay off.
        if (event.relatedTarget === null) {
          setDragging(false);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);

        const file = event.dataTransfer.files[0];

        if (!file) {
          return;
        }

        if (!isAccepted(file)) {
          error.value = `${file.name} is not a png, jpg or webp image`;

          return;
        }

        void openMapFile(file);
      }}
    >
      <TopBar />

      <div className={styles.body}>
        <Toolbar />
        <main className={styles.stage}>
          <MapCanvas />
        </main>
        <ProvincePanel />
      </div>

      <StatusBar />

      {dragging && <div className={styles.dropzone}>Drop a map image</div>}

      {error.value && (
        <div className={styles.error} role="alert">
          <span>{error.value}</span>
          <button onClick={dismissError} type="button">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

export { App };
