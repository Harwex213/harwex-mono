import { useEffect, useRef, useState } from "react";
import { modelUrl } from "../../state/bridge.js";
import { addAttachment, setNotice } from "../../state/store.js";
import { MaterialPanel } from "./material-panel.js";
import { ModelViewer } from "./scene.js";
import type { GizmoMode, SceneInfo } from "./scene.js";

const EMPTY: SceneInfo = { slots: [], selected: null, meshCount: 0, loaded: false, error: "" };

const MODES: { mode: GizmoMode; label: string; key: string }[] = [
  { mode: "translate", label: "Move", key: "G" },
  { mode: "rotate", label: "Rotate", key: "R" },
  { mode: "scale", label: "Scale", key: "S" },
];

/**
 * The left half of a workspace. Zoom with the wheel, orbit with the left
 * button, pan with the right button or Shift. Click a mesh to select it and
 * get the gizmo; nothing done here reaches the file. Screenshot drops the
 * current view into the composer as an attachment.
 */
function Viewer({ tabId, stamp }: { tabId: string; stamp: number }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<ModelViewer | null>(null);
  const [info, setInfo] = useState<SceneInfo>(EMPTY);
  const [mode, setMode] = useState<GizmoMode>("translate");
  const [showMaterials, setShowMaterials] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const viewer = new ModelViewer(canvas, setInfo);
    viewerRef.current = viewer;
    const observer = new ResizeObserver(() => {
      viewer.resize();
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (stamp > 0) {
      void viewerRef.current?.load(modelUrl(tabId, stamp));
    }
  }, [tabId, stamp]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) {
        return;
      }
      const entry = MODES.find((candidate) => candidate.key.toLowerCase() === event.key.toLowerCase());
      if (entry) {
        setMode(entry.mode);
        viewerRef.current?.setMode(entry.mode);
      }
      if (event.key === "Escape") {
        viewerRef.current?.selectByUuid(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const screenshot = async () => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }
    try {
      const blob = await viewer.screenshot();
      await addAttachment(tabId, blob, "viewer.png");
      setNotice("Screenshot added to the message.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="viewer">
      <canvas ref={canvasRef} className="viewer__canvas" />
      <div className="viewer__toolbar">
        <div className="viewer__group">
          {MODES.map((entry) => {
            return (
              <button
                key={entry.mode}
                type="button"
                className={mode === entry.mode ? "button button--small button--on" : "button button--small"}
                title={`${entry.label} the selected mesh (${entry.key})`}
                onClick={() => {
                  setMode(entry.mode);
                  viewerRef.current?.setMode(entry.mode);
                }}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
        <div className="viewer__group">
          <button
            type="button"
            className="button button--small"
            title="Bring the whole model into view"
            onClick={() => {
              viewerRef.current?.frameModel();
            }}
          >
            Frame
          </button>
          <button
            type="button"
            className="button button--small"
            title="Undo every try-out: reload the model as it is in the file"
            onClick={() => {
              void viewerRef.current?.reset();
            }}
          >
            Reset
          </button>
          <button
            type="button"
            className="button button--small"
            title="Put a screenshot of this view into the message"
            onClick={() => {
              void screenshot();
            }}
          >
            Screenshot
          </button>
          <button
            type="button"
            className={showMaterials ? "button button--small button--on" : "button button--small"}
            title="Material slots"
            onClick={() => {
              setShowMaterials(!showMaterials);
            }}
          >
            Materials
          </button>
        </div>
      </div>
      {showMaterials ? (
        <MaterialPanel
          info={info}
          onSelect={(uuid) => {
            viewerRef.current?.selectByUuid(uuid);
          }}
          onPatch={(key, patch) => {
            viewerRef.current?.patchSlot(key, patch);
          }}
        />
      ) : null}
      {!info.loaded ? (
        <div className="viewer__empty">
          {info.error.length > 0 ? (
            <p>The model could not be loaded: {info.error}</p>
          ) : stamp === 0 ? (
            <p>Waiting for Blender to export the model…</p>
          ) : (
            <p>Loading the model…</p>
          )}
        </div>
      ) : null}
      {info.loaded && info.meshCount === 0 ? (
        <div className="viewer__empty viewer__empty--soft">
          <p>The file has no meshes yet. Describe the model in the chat.</p>
        </div>
      ) : null}
      <div className="viewer__legend">wheel zooms · drag orbits · right-drag pans · click selects · Esc deselects</div>
    </div>
  );
}

export { Viewer };
