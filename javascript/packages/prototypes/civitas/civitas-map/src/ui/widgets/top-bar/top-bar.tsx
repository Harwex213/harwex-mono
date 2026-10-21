import { useSignals } from "@preact/signals-react/runtime";
import type { TAppRegistry } from "../../../actions/index";
import {
  hasWork,
  useStore,
} from "../../../store/index";
import styles from "./top-bar.module.css";

type TTopBarProps = {
  registry: Pick<TAppRegistry, "detectFromBaseMap" | "exportAll" | "fitToViewport" | "openLibrary" | "openSampleMap">;
};

// Production builds have no sample map, so the button is compiled out.
const IS_DEV = process.env.NODE_ENV !== "production";

function TopBar({ registry }: TTopBarProps) {
  useSignals();

  const store = useStore();
  const info = store.map.info.value;
  const busy = store.status.busy.value;

  return (
    <header className={styles.bar}>
      <h1 className={styles.title}>
        Civitas<span className={styles.titleDim}>map editor</span>
      </h1>

      {/* Both load buttons open the map library dialog. A drop on the window still
          takes local files, see the editor page. */}
      <div className={styles.group}>
        <button
          disabled={busy}
          onClick={() => {
            void registry.openLibrary("map");
          }}
          type="button"
        >
          {store.status.loading.value ? "Loading…" : "Load map…"}
        </button>
        <button
          disabled={!info || busy}
          onClick={() => {
            void registry.openLibrary("provinces");
          }}
          title="Load a previous export back in: the provinces PNG and the JSON manifest beside it"
          type="button"
        >
          Load provinces…
        </button>
        {IS_DEV && (
          <button
            disabled={busy}
            onClick={() => {
              void registry.openSampleMap();
            }}
            title="assets/maps/map.png"
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
        <button
          disabled={!info || busy}
          onClick={() => {
            if (hasWork(store) && !window.confirm("Replace the provinces layer with detected borders?")) {
              return;
            }

            void registry.detectFromBaseMap();
          }}
          title="Find provinces from borders drawn into the map image"
          type="button"
        >
          {store.status.detecting.value ? "Detecting…" : "Detect borders"}
        </button>
        <button
          disabled={!info}
          onClick={() => {
            registry.fitToViewport();
          }}
          type="button"
        >
          Fit
        </button>
        <button
          className={styles.primary}
          disabled={!info || busy || store.provinces.list.value.length === 0}
          onClick={() => {
            void registry.exportAll();
          }}
          type="button"
        >
          {store.status.exporting.value ? "Exporting…" : "Export PNG + JSON"}
        </button>
      </div>
    </header>
  );
}

export { TopBar };
