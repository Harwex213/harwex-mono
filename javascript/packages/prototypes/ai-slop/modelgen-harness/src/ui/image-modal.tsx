import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MessageImage } from "../../shared/types.js";
import { imageUrl } from "../state/bridge.js";

/**
 * One picture, filling the window. It opens at the size that fits, and from
 * there the wheel zooms and a drag moves the picture: a render of a model is
 * worth looking at closely, and the chat column is too narrow for that.
 *
 * Scale 1 is the fitted size rather than the pixel size of the file, so the
 * number over the picture reads as "how much closer than the whole picture
 * this is".
 *
 * The classes are `lightbox*`. `viewer*` belongs to the 3D view, and a second
 * `.viewer` rule here covered the window with it.
 */

const MIN_SCALE = 0.2;
const MAX_SCALE = 16;
/** One wheel notch. The factor is multiplied, so a notch means the same at every zoom. */
const WHEEL_STEP = 1.0015;
const BUTTON_STEP = 1.4;

/** Where the picture sits and how close it is. `x` and `y` are pixels from the middle. */
interface View {
  scale: number;
  x: number;
  y: number;
}

const FITTED: View = { scale: 1, x: 0, y: 0 };

function clampScale(value: number): number {
  return Math.min(Math.max(value, MIN_SCALE), MAX_SCALE);
}

/** Where a mouse event landed, measured from the middle of the element. */
function fromCentre(element: HTMLElement, clientX: number, clientY: number): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: clientX - (box.left + box.width / 2), y: clientY - (box.top + box.height / 2) };
}

function ImageModal({ image, onClose }: { image: MessageImage; onClose: () => void }): React.JSX.Element {
  const [view, setView] = useState<View>(FITTED);
  const [dragging, setDragging] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragFrom = useRef<{ x: number; y: number; view: View; onPicture: boolean } | null>(null);
  // The wheel listener and the key handler are put on once and read the view
  // from here, so neither is torn down and rebuilt on every zoom.
  const current = useRef(view);
  current.current = view;

  /**
   * Zooms to `next`, keeping whatever sits under `point` where it is. The
   * picture is anchored in the middle of the stage, so a point of the picture
   * sits at `xy + scale × its place in the picture`; holding that place fixed
   * is what the two lines below do.
   */
  const zoomAt = useCallback((next: number, point: { x: number; y: number }) => {
    setView((now) => {
      const scale = clampScale(next);
      const ratio = scale / now.scale;
      return {
        scale,
        x: point.x - ratio * (point.x - now.x),
        y: point.y - ratio * (point.y - now.y),
      };
    });
  }, []);

  const zoomFromCentre = useCallback(
    (factor: number) => {
      zoomAt(current.current.scale * factor, { x: 0, y: 0 });
    },
    [zoomAt],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "+" || event.key === "=") {
        zoomFromCentre(BUTTON_STEP);
        return;
      }
      if (event.key === "-" || event.key === "_") {
        zoomFromCentre(1 / BUTTON_STEP);
        return;
      }
      if (event.key === "0") {
        setView(FITTED);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, zoomFromCentre]);

  // A wheel over the picture zooms it and must not scroll the chat behind it.
  // React's own wheel handler is passive and cannot stop that, so the listener
  // is put on by hand.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      zoomAt(current.current.scale * WHEEL_STEP ** -event.deltaY, fromCentre(stage, event.clientX, event.clientY));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      stage.removeEventListener("wheel", onWheel);
    };
  }, [zoomAt]);

  const label = image.kind === "preview" ? "preview" : image.kind === "generated" ? "reference" : "attached";

  return createPortal(
    <div
      className="lightbox"
      onPointerDown={(event) => {
        // Only the backdrop closes. A drag that starts on the picture pans it.
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="lightbox__bar">
        <span className="lightbox__label">
          {label} · {image.width}×{image.height}
        </span>
        <div className="lightbox__zoom">
          <button
            type="button"
            className="button button--small"
            title="Zoom out"
            onClick={() => {
              zoomFromCentre(1 / BUTTON_STEP);
            }}
          >
            −
          </button>
          <button
            type="button"
            className="button button--small lightbox__scale"
            title="Fit the picture again"
            onClick={() => {
              setView(FITTED);
            }}
          >
            {view.scale.toFixed(1)}×
          </button>
          <button
            type="button"
            className="button button--small"
            title="Zoom in"
            onClick={() => {
              zoomFromCentre(BUTTON_STEP);
            }}
          >
            +
          </button>
        </div>
        <button type="button" className="button button--small" onClick={onClose}>
          Close
        </button>
      </div>
      <div
        className={`lightbox__stage${dragging ? " lightbox__stage--dragging" : ""}`}
        ref={stageRef}
        onPointerDown={(event) => {
          // Which of the two was pressed has to be read now: the capture below
          // sends every later event of this pointer to the stage, so by the
          // time it is released the picture is no longer the target.
          dragFrom.current = {
            x: event.clientX,
            y: event.clientY,
            view,
            onPicture: event.target !== event.currentTarget,
          };
          setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const from = dragFrom.current;
          if (!from) {
            return;
          }
          setView({
            scale: from.view.scale,
            x: from.view.x + (event.clientX - from.x),
            y: from.view.y + (event.clientY - from.y),
          });
        }}
        onPointerUp={(event) => {
          const from = dragFrom.current;
          dragFrom.current = null;
          setDragging(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
          // A press on the empty part of the stage that moved nowhere is a
          // click beside the picture, and that closes the lightbox.
          const still = from && Math.abs(event.clientX - from.x) < 4 && Math.abs(event.clientY - from.y) < 4;
          if (still && from && !from.onPicture) {
            onClose();
          }
        }}
        onDoubleClick={(event) => {
          if (view.scale > 1.01) {
            setView(FITTED);
            return;
          }
          zoomAt(2.5, fromCentre(event.currentTarget, event.clientX, event.clientY));
        }}
      >
        <img
          className="lightbox__image"
          src={imageUrl(image.id)}
          alt={label}
          draggable={false}
          style={{ transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
      </div>
      <p className="lightbox__hint">
        {image.filePath ?? "Wheel zooms, drag moves, double-click goes in and back. Esc closes."}
      </p>
    </div>,
    document.body,
  );
}

export { ImageModal };
