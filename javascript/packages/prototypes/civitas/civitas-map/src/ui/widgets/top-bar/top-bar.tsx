import { useSignals } from "@preact/signals-react/runtime";
import type { TAppRegistry } from "../../../actions/index";
import type { EditorMode } from "../../../domain/index";
import { useStore } from "../../../store/index";
import styles from "./top-bar.module.css";

type TTopBarProps = {
  registry: Pick<TAppRegistry, "exportAll" | "openLibrary" | "setMode">;
};

const MODES: Array<{ id: EditorMode; label: string; hint: string }> = [
  { id: "provinces", label: "Provinces", hint: "Paint provinces onto the map" },
  { id: "countries", label: "Countries", hint: "Make countries out of provinces" },
];

function TopBar({ registry }: TTopBarProps) {
  useSignals();

  const store = useStore();
  const info = store.map.info.value;
  const busy = store.status.busy.value;

  return (
    <header className={styles.bar}>
      <h1 className={styles.title}>Civitas</h1>

      <div aria-label="Editor mode" className={styles.modes} role="group">
        {MODES.map((entry) => (
          <button
            aria-pressed={entry.id === store.tools.mode.value}
            className={entry.id === store.tools.mode.value ? `${styles.mode} ${styles.modeActive}` : styles.mode}
            disabled={!info}
            key={entry.id}
            onClick={() => {
              registry.setMode(entry.id);
            }}
            title={entry.hint}
            type="button"
          >
            {entry.label}
          </button>
        ))}
      </div>

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
