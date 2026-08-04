import { useSignals } from "@preact/signals-react/runtime";
import { useRef } from "react";
import { ACCEPT_ATTRIBUTE } from "../map/map-image";
import {
  exportAll,
  exporting,
  fitToViewport,
  importProvinces,
  loading,
  mapInfo,
  openMapFile,
  openMapUrl,
  provinces,
} from "../state/editor-state";
import styles from "./top-bar.module.css";

// Dev builds serve `assets/map.png` from the package folder (see the rspack
// config), which saves picking the file by hand on every reload. Production
// builds have no such file, so the button is compiled out.
const SAMPLE_URL = "/assets/map.png";
const IS_DEV = process.env.NODE_ENV !== "production";

function TopBar() {
  useSignals();

  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const info = mapInfo.value;
  const busy = loading.value || exporting.value;

  return (
    <header className={styles.bar}>
      <h1 className={styles.title}>
        Civitas<span className={styles.titleDim}>map editor</span>
      </h1>

      <input
        accept={ACCEPT_ATTRIBUTE}
        className={styles.hidden}
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file) {
            void openMapFile(file);
          }

          // Cleared so picking the same file twice still fires a change event.
          event.target.value = "";
        }}
        ref={fileRef}
        type="file"
      />

      {/* One picker for both halves of an export: `multiple`, so the PNG and the
          JSON can be selected together in a single pass. */}
      <input
        accept=".png,.json,application/json"
        className={styles.hidden}
        multiple
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];

          if (files.length > 0) {
            void importProvinces(files);
          }

          event.target.value = "";
        }}
        ref={importRef}
        type="file"
      />

      <div className={styles.group}>
        <button
          disabled={busy}
          onClick={() => {
            fileRef.current?.click();
          }}
          type="button"
        >
          {loading.value ? "Loading…" : "Load map…"}
        </button>
        <button
          disabled={!info || busy}
          onClick={() => {
            importRef.current?.click();
          }}
          title="Load a previous export back in: the provinces PNG, its JSON manifest, or both"
          type="button"
        >
          Load provinces…
        </button>
        {IS_DEV && (
          <button
            disabled={busy}
            onClick={() => {
              void openMapUrl(SAMPLE_URL);
            }}
            title={SAMPLE_URL}
            type="button"
          >
            Sample
          </button>
        )}
      </div>

      {info && (
        <p className={styles.meta}>
          <span className={styles.name}>{info.name}</span>
          <span className={styles.dim}>
            {info.width} × {info.height}
          </span>
        </p>
      )}

      <div className={styles.spacer} />

      <div className={styles.group}>
        <button disabled={!info} onClick={fitToViewport} type="button">
          Fit
        </button>
        <button
          className={styles.primary}
          disabled={!info || busy || provinces.value.length === 0}
          onClick={() => {
            void exportAll();
          }}
          type="button"
        >
          {exporting.value ? "Exporting…" : "Export PNG + JSON"}
        </button>
      </div>
    </header>
  );
}

export { TopBar };
