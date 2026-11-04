import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import type { TAppRegistry } from "../../../actions/index";
import {
  useStore,
  type LibraryMode,
} from "../../../store/index";
import styles from "./map-library-dialog.module.css";

type TMapLibraryDialogProps = {
  registry: Pick<TAppRegistry, "closeLibrary" | "pickLibraryImage" | "retryLibrary">;
};

const COPY: Record<LibraryMode, { title: string; hint: string }> = {
  map: {
    title: "Load map",
    hint: "Pick the base map image.",
  },
  provinces: {
    title: "Load provinces",
    hint: "Pick an exported provinces PNG. A JSON manifest with the same name is loaded with it.",
  },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// The list of images in the map library. Opened by `Load map…` and
// `Load provinces…`; the mode decides what a pick does.
function MapLibraryDialog({ registry }: TMapLibraryDialogProps) {
  useSignals();

  const store = useStore();
  const panelRef = useRef<HTMLDivElement>(null);
  const state = store.library.state.value;
  const open = state !== null;

  // Focus moves into the dialog, so Escape and Tab act on it rather than on the
  // editor behind it. The panel itself takes focus, not the first row: a
  // focused row would read as a selection.
  useEffect(() => {
    if (open) {
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
        registry.closeLibrary();
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

  const copy = COPY[state.mode];

  return (
    <div
      className={styles.backdrop}
      onPointerDown={(event) => {
        // Only a press on the backdrop itself closes; one inside the panel does not.
        if (event.target === event.currentTarget) {
          registry.closeLibrary();
        }
      }}
    >
      <div
        aria-labelledby="map-library-title"
        aria-modal="true"
        className={styles.panel}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className={styles.header}>
          <div>
            <h2 className={styles.title} id="map-library-title">
              {copy.title}
            </h2>
            <p className={styles.hint}>{copy.hint}</p>
          </div>
          <button
            aria-label="Close"
            className={styles.close}
            onClick={() => {
              registry.closeLibrary();
            }}
            type="button"
          >
            ✕
          </button>
        </header>

        <div className={styles.body}>
          {state.status === "loading" && <p className={styles.message}>Loading the map library…</p>}

          {state.status === "failed" && (
            <div className={styles.failure} role="alert">
              <p className={styles.message}>The map library could not be loaded: {state.error}</p>
              <button
                onClick={() => {
                  void registry.retryLibrary();
                }}
                type="button"
              >
                Retry
              </button>
            </div>
          )}

          {state.status === "ready" && state.images.length === 0 && (
            <p className={styles.message}>No images in the map library.</p>
          )}

          {state.status === "ready" && state.images.length > 0 && (
            <ul aria-label="Map images" className={styles.list}>
              {state.images.map((image) => (
                <li key={image.url}>
                  <button
                    className={styles.item}
                    onClick={() => {
                      void registry.pickLibraryImage(image);
                    }}
                    type="button"
                  >
                    <span className={styles.name}>{image.name}</span>
                    {image.manifestUrl !== null && <span className={styles.tag}>+ manifest</span>}
                    <span className={styles.size}>{formatBytes(image.bytes)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export { MapLibraryDialog };
