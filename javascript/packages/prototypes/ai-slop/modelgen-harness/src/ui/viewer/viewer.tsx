import { useCallback, useEffect, useRef, useState } from "react";
import type { SceneOutline } from "../../../shared/types.js";
import { modelUrl } from "../../state/bridge.js";
import { addAttachment, readOutline, setNotice } from "../../state/store.js";
import { MaterialPanel } from "./material-panel.js";
import { OutlinePanel } from "./outline-panel.js";
import { ModelViewer } from "./scene.js";
import type { GizmoMode, SceneInfo } from "./scene.js";

const EMPTY: SceneInfo = {
  materials: [],
  selected: null,
  selectedName: null,
  nodeNames: [],
  meshCount: 0,
  loaded: false,
  error: "",
};

const MODES: { mode: GizmoMode; label: string; key: string }[] = [
  { mode: "translate", label: "Move", key: "W" },
  { mode: "rotate", label: "Rotate", key: "R" },
  { mode: "scale", label: "Scale", key: "S" },
];

/** A drag under 8 CSS pixels either way is a click, not a region. */
const REGION_MIN = 8;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectOf(from: { x: number; y: number }, to: { x: number; y: number }): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/**
 * The left half of a workspace. Zoom with the wheel, orbit with the left
 * button, pan with the right button or Shift. Click a mesh to select it and
 * get the gizmo; nothing done here reaches the file. Screenshot drops the
 * current view into the composer as an attachment, Region drops one rectangle
 * of it.
 */
function Viewer({ tabId, stamp }: { tabId: string; stamp: number }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<ModelViewer | null>(null);
  const [info, setInfo] = useState<SceneInfo>(EMPTY);
  const [mode, setMode] = useState<GizmoMode>("translate");
  const [showMaterials, setShowMaterials] = useState(true);
  const [showObjects, setShowObjects] = useState(false);
  const [outline, setOutline] = useState<SceneOutline | null>(null);
  const [outlineError, setOutlineError] = useState("");
  const [outlineLoading, setOutlineLoading] = useState(false);
  /** Armed by the Region button: the next drag over the canvas is the capture. */
  const [region, setRegion] = useState(false);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);

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

  const loadOutline = useCallback(async () => {
    setOutlineLoading(true);
    try {
      setOutline(await readOutline(tabId));
      setOutlineError("");
    } catch (error) {
      setOutline(null);
      setOutlineError(error instanceof Error ? error.message : String(error));
    } finally {
      setOutlineLoading(false);
    }
  }, [tabId]);

  // Only while the panel is open, and again after every export: that is when
  // the scene has just changed.
  useEffect(() => {
    if (showObjects) {
      void loadOutline();
    }
  }, [showObjects, stamp, loadOutline]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) {
        return;
      }
      // While a region is armed, Escape puts it away and nothing else runs:
      // the keys would otherwise move the gizmo under the rectangle.
      if (region) {
        if (event.key === "Escape") {
          cancelRegion();
        }
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
  }, [region]);

  const attach = async (make: () => Promise<Blob>, what: string) => {
    try {
      const blob = await make();
      await addAttachment(tabId, blob, "viewer.png");
      setNotice(`${what} added to the message.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const screenshot = async () => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }
    await attach(() => viewer.screenshot(), "Screenshot");
  };

  function cancelRegion(): void {
    setRegion(false);
    setMarquee(null);
    dragFrom.current = null;
  }

  /** Where the pointer is inside the canvas, in CSS pixels. */
  function pointIn(event: React.PointerEvent<HTMLDivElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  const onRegionDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragFrom.current = pointIn(event);
    setMarquee(null);
  };

  const onRegionMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const from = dragFrom.current;
    if (from) {
      setMarquee(rectOf(from, pointIn(event)));
    }
  };

  const onRegionUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    const viewer = viewerRef.current;
    if (!from || !viewer) {
      cancelRegion();
      return;
    }
    const rect = rectOf(from, pointIn(event));
    cancelRegion();
    if (rect.width < REGION_MIN || rect.height < REGION_MIN) {
      setNotice("Drag a rectangle over the view to capture part of it.");
      return;
    }
    void attach(() => viewer.screenshotRegion(rect), "Region");
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
            className={region ? "button button--small button--on" : "button button--small"}
            title="Drag a rectangle over the view and put that part into the message"
            onClick={() => {
              if (region) {
                cancelRegion();
              } else {
                setRegion(true);
                setNotice("Drag a rectangle over the view. Esc cancels.");
              }
            }}
          >
            Region
          </button>
          <button
            type="button"
            className={showObjects ? "button button--small button--on" : "button button--small"}
            title="The collection and object tree, as Blender's outliner has it"
            onClick={() => {
              setShowObjects(!showObjects);
            }}
          >
            Objects
          </button>
          <button
            type="button"
            className={showMaterials ? "button button--small button--on" : "button button--small"}
            title="The scene's materials"
            onClick={() => {
              setShowMaterials(!showMaterials);
            }}
          >
            Materials
          </button>
        </div>
      </div>
      {showObjects ? (
        <OutlinePanel
          outline={outline}
          error={outlineError}
          loading={outlineLoading}
          nodeNames={info.nodeNames}
          selectedName={info.selectedName}
          onSelect={(name) => {
            viewerRef.current?.selectByName(name);
          }}
          onRefresh={() => {
            void loadOutline();
          }}
        />
      ) : null}
      {showMaterials ? (
        <MaterialPanel
          info={info}
          onSelect={(uuid) => {
            viewerRef.current?.selectByUuid(uuid);
          }}
          onPatch={(key, patch) => {
            viewerRef.current?.patchMaterial(key, patch);
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
      {region ? (
        <div
          className="viewer__region"
          onPointerDown={onRegionDown}
          onPointerMove={onRegionMove}
          onPointerUp={onRegionUp}
          onPointerCancel={() => {
            cancelRegion();
          }}
        >
          {marquee ? (
            <div
              className="viewer__marquee"
              style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }}
            />
          ) : null}
          <div className="viewer__region-hint">
            {marquee
              ? `${Math.round(marquee.width)} × ${Math.round(marquee.height)}`
              : "Drag a rectangle to capture it · Esc cancels"}
          </div>
        </div>
      ) : null}
      {info.loaded && info.meshCount === 0 ? (
        <div className="viewer__empty viewer__empty--soft">
          <p>The file has no meshes yet. Describe the model in the chat.</p>
        </div>
      ) : null}
      <div className="viewer__legend">
        wheel zooms · drag orbits · right-drag pans · click selects · W/R/S move, rotate, scale · Esc deselects
      </div>
    </div>
  );
}

export { Viewer };
