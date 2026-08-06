import { useSignals } from "@preact/signals-react/runtime";
import { useState } from "react";
import { isJsonFile } from "./map/import-provinces";
import { isAccepted } from "./map/map-image";
import {
  dismissError,
  dismissNotice,
  error,
  importProvinces,
  notice,
  openMapFile,
} from "./state/editor-state";
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

        const files = [...event.dataTransfer.files];

        if (files.length === 0) {
          return;
        }

        // A manifest in the drop means the whole drop is an export being
        // reopened. An image on its own is the base map — that is the ambiguous
        // case, and the drop is not the place to guess, so a provinces PNG
        // without its manifest goes through `Load provinces…`.
        if (files.some(isJsonFile)) {
          void importProvinces(files);

          return;
        }

        const image = files.find(isAccepted);

        if (!image) {
          error.value = `${files[0].name} is not a png, jpg or webp image`;

          return;
        }

        void openMapFile(image);
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

      {dragging && (
        <div className={styles.dropzone}>Drop a map image, or an export to reopen</div>
      )}

      {error.value && (
        <div className={styles.error} role="alert">
          <span>{error.value}</span>
          <button onClick={dismissError} type="button">
            Dismiss
          </button>
        </div>
      )}

      {!error.value && notice.value && (
        <div className={styles.notice} role="status">
          <span>{notice.value}</span>
          <button onClick={dismissNotice} type="button">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

export { App };
