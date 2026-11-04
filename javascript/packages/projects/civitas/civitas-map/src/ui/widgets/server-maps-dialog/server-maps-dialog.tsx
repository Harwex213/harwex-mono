import { useSignals } from "@preact/signals-react/runtime";
import {
  useEffect,
  useRef,
  useState,
} from "react";
import type { TAppRegistry } from "../../../actions/index";
import { useStore } from "../../../store/index";
import styles from "./server-maps-dialog.module.css";

type TServerMapsDialogProps = {
  registry: Pick<TAppRegistry, "closeServerMaps" | "createServerMap" | "openServerMaps" | "pickServerMap">;
};

// The maps stored on the backend, opened by `Maps…`. A pick opens the map with
// its countries and provinces; the form below uploads a new one.
function ServerMapsDialog({ registry }: TServerMapsDialogProps) {
  useSignals();

  const store = useStore();
  const panelRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const state = store.server.dialog.value;
  const open = state !== null;

  // Focus moves into the dialog, so Escape and Tab act on it rather than on the
  // editor behind it. A fresh open starts with an empty form.
  useEffect(() => {
    if (open) {
      setName("");
      setImage(null);
      panelRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        registry.closeServerMaps();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, registry]);

  if (!state) {
    return null;
  }

  return (
    <div
      className={styles.backdrop}
      onPointerDown={(event) => {
        // Only a press on the backdrop itself closes; one inside the panel does not.
        if (event.target === event.currentTarget) {
          registry.closeServerMaps();
        }
      }}
    >
      <div
        aria-labelledby="server-maps-title"
        aria-modal="true"
        className={styles.panel}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className={styles.header}>
          <div>
            <h2 className={styles.title} id="server-maps-title">
              Maps
            </h2>
            <p className={styles.hint}>Pick a map stored on the backend, or upload a new one.</p>
          </div>
          <button
            aria-label="Close"
            className={styles.close}
            onClick={() => {
              registry.closeServerMaps();
            }}
            type="button"
          >
            ✕
          </button>
        </header>

        <div className={styles.body}>
          {state.status === "loading" && <p className={styles.message}>Loading the maps…</p>}

          {state.status === "failed" && (
            <div className={styles.failure} role="alert">
              <p className={styles.message}>The maps could not be loaded: {state.error}</p>
              <button
                onClick={() => {
                  void registry.openServerMaps();
                }}
                type="button"
              >
                Retry
              </button>
            </div>
          )}

          {state.status === "ready" && state.maps.length === 0 && (
            <p className={styles.message}>No maps on the backend yet.</p>
          )}

          {state.status === "ready" && state.maps.length > 0 && (
            <ul aria-label="Maps" className={styles.list}>
              {state.maps.map((map) => (
                <li key={map.id}>
                  <button
                    className={styles.item}
                    disabled={state.creating}
                    onClick={() => {
                      void registry.pickServerMap(map);
                    }}
                    type="button"
                  >
                    <span className={styles.name}>{map.name}</span>
                    {map.id === store.server.map.value?.id && <span className={styles.tag}>open</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form
          aria-label="New map"
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void registry.createServerMap(name, image);
          }}
        >
          <h3 className={styles.formTitle}>New map</h3>
          <input
            aria-label="Map name"
            className={styles.input}
            disabled={state.creating}
            maxLength={255}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder="Name"
            type="text"
            value={name}
          />
          <input
            accept="image/png"
            aria-label="Map image"
            className={styles.file}
            disabled={state.creating}
            onChange={(event) => {
              setImage(event.target.files?.[0] ?? null);
            }}
            type="file"
          />
          {state.createError && (
            <p className={styles.createError} role="alert">
              {state.createError}
            </p>
          )}
          <button
            className={styles.primary}
            disabled={state.creating}
            type="submit"
          >
            {state.creating ? "Uploading…" : "Create and open"}
          </button>
        </form>
      </div>
    </div>
  );
}

export { ServerMapsDialog };
