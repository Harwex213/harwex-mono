import { useSignals } from "@preact/signals-react/runtime";
import { useState } from "react";
import type { TAppRegistry } from "../../../actions/index";
import {
  isJsonFile,
  isMapImageFile,
} from "../../../domain/index";
import { useStore } from "../../../store/index";
import { CountryPanel } from "../../widgets/country-panel/country-panel";
import { MapCanvas } from "../../widgets/map-canvas/map-canvas";
import { MapLibraryDialog } from "../../widgets/map-library-dialog/map-library-dialog";
import { ProvincePanel } from "../../widgets/province-panel/province-panel";
import { StatusBar } from "../../widgets/status-bar/status-bar";
import { Toolbar } from "../../widgets/toolbar/toolbar";
import { TopBar } from "../../widgets/top-bar/top-bar";
import { useShortcuts } from "./use-shortcuts";
import styles from "./editor-page.module.css";

type TEditorPageProps = {
  registry: TAppRegistry;
};

// The one screen: the top bar, the left menu, the map, the right menu (the
// provinces or the countries, by mode), the status bar, and the map library
// dialog over them. The page owns the window-wide input: the
// keyboard shortcuts and the drop of local files.
function EditorPage({ registry }: TEditorPageProps) {
  useSignals();
  const store = useStore();
  useShortcuts(store, registry);

  const [dragging, setDragging] = useState(false);
  const error = store.status.error.value;
  const notice = store.status.notice.value;

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
          void registry.importProvinceFiles(files);

          return;
        }

        const image = files.find(isMapImageFile);

        if (!image) {
          registry.showError(`${files[0].name} is not a png, jpg or webp image`);

          return;
        }

        void registry.openMapFile(image);
      }}
    >
      <TopBar registry={registry} />

      <div className={styles.body}>
        <Toolbar registry={registry} />
        <main className={styles.stage}>
          <MapCanvas registry={registry} />
        </main>
        {store.tools.mode.value === "countries" ? (
          <CountryPanel registry={registry} />
        ) : (
          <ProvincePanel registry={registry} />
        )}
      </div>

      <StatusBar />

      {dragging && (
        <div className={styles.dropzone}>Drop a map image, or an export to reopen</div>
      )}

      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button
            onClick={() => {
              registry.dismissError();
            }}
            type="button"
          >
            Dismiss
          </button>
        </div>
      )}

      <MapLibraryDialog registry={registry} />

      {!error && notice && (
        <div className={styles.notice} role="status">
          <span>{notice}</span>
          <button
            onClick={() => {
              registry.dismissNotice();
            }}
            type="button"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

export { EditorPage };
