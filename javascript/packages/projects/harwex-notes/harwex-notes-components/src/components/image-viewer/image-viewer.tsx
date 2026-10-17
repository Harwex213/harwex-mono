import { useCallback, useEffect, useRef, useState } from "react";
import "./image-viewer.css";
import type { FC, KeyboardEvent, PointerEvent as ReactPointerEvent, SyntheticEvent } from "react";
import type { TImageViewerProps } from "./image-viewer.types";

const MIN_SCALE = 0.02;
const MAX_SCALE = 32;
const BUTTON_ZOOM_FACTOR = 1.25;
// Scale change per pixel of wheel travel. A trackpad sends small deltas, a mouse wheel
// sends about 100 per notch, so one notch zooms by roughly 16 %.
const WHEEL_ZOOM_PER_PX = 0.0015;
// Above this scale every image pixel is a visible square, so smoothing would only blur it.
const PIXELATED_FROM_SCALE = 2;
// An SVG without width and height reports no natural size. Browsers draw such an image at
// 300 x 150, so the viewer measures it the same way.
const FALLBACK_WIDTH_PX = 300;
const FALLBACK_HEIGHT_PX = 150;

type TSize = {
  width: number;
  height: number;
};

type TView =
  | { mode: "fit" }
  | { mode: "free"; scale: number; x: number; y: number };

type TLoad =
  | { status: "loading" }
  | { status: "ready"; size: TSize }
  | { status: "error" };

// Load result and view are stored with the URL they belong to. A new URL then reads as
// loading and fitted on the very first render, with no effect to reset them.
type TForSrc<T> = {
  src: string;
  value: T;
};

type TPlacement = {
  scale: number;
  x: number;
  y: number;
};

type TDrag = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

const clampScale = (scale: number) => {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
};

// The image fits the pane but is never blown up past its own size by default (IMG-3).
const readFitScale = (image: TSize, pane: TSize) => {
  if (pane.width <= 0 || pane.height <= 0) {
    return 1;
  }

  return Math.min(1, pane.width / image.width, pane.height / image.height);
};

const centre = (image: TSize, pane: TSize, scale: number): TPlacement => {
  return {
    scale,
    x: (pane.width - image.width * scale) / 2,
    y: (pane.height - image.height * scale) / 2,
  };
};

const readPlacement = (view: TView, image: TSize, pane: TSize): TPlacement => {
  if (view.mode === "fit") {
    return centre(image, pane, readFitScale(image, pane));
  }

  return { scale: view.scale, x: view.x, y: view.y };
};

// Zooms so that the image point under (pointX, pointY) stays under it.
const zoomAround = (
  placement: TPlacement,
  nextScale: number,
  pointX: number,
  pointY: number
): TView => {
  const scale = clampScale(nextScale);
  const ratio = scale / placement.scale;

  return {
    mode: "free",
    scale,
    x: pointX - (pointX - placement.x) * ratio,
    y: pointY - (pointY - placement.y) * ratio,
  };
};

const formatPercent = (scale: number) => {
  return `${Math.round(scale * 100)}%`;
};

const ImageViewer: FC<TImageViewerProps> = ({ document, name }) => {
  const paneRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<TDrag | null>(null);

  const [pane, setPane] = useState<TSize>({ width: 0, height: 0 });
  const [loadForSrc, setLoadForSrc] = useState<TForSrc<TLoad> | null>(null);
  const [viewForSrc, setViewForSrc] = useState<TForSrc<TView> | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const src = document.src;
  const load: TLoad = loadForSrc?.src === src ? loadForSrc.value : { status: "loading" };
  const view: TView = viewForSrc?.src === src ? viewForSrc.value : { mode: "fit" };

  const setLoad = (value: TLoad) => {
    setLoadForSrc({ src, value });
  };

  // Kept in a ref so the wheel listener, attached once, writes the view of the current URL.
  const srcRef = useRef(src);
  srcRef.current = src;

  const setView = useCallback((value: TView) => {
    setViewForSrc({ src: srcRef.current, value });
  }, []);

  useEffect(() => {
    const element = paneRef.current;
    if (element === null) {
      return;
    }

    const observer = new ResizeObserver(() => {
      setPane({ width: element.clientWidth, height: element.clientHeight });
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  const size = load.status === "ready" ? load.size : null;
  const placement = size === null ? null : readPlacement(view, size, pane);

  // Kept in a ref so the wheel listener, attached once, always reads the current placement.
  const placementRef = useRef<TPlacement | null>(placement);
  placementRef.current = placement;

  // React attaches wheel listeners as passive, and a passive listener cannot stop the page
  // from scrolling. The viewer attaches its own.
  useEffect(() => {
    const element = paneRef.current;
    if (element === null) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      const current = placementRef.current;
      if (current === null) {
        return;
      }

      event.preventDefault();

      const bounds = element.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_PER_PX);

      setView(
        zoomAround(current, current.scale * factor, event.clientX - bounds.left, event.clientY - bounds.top)
      );
    };

    element.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, [setView]);

  const zoomByFactor = useCallback(
    (factor: number) => {
      if (placement === null) {
        return;
      }

      setView(zoomAround(placement, placement.scale * factor, pane.width / 2, pane.height / 2));
    },
    [pane, placement, setView]
  );

  const showActualSize = useCallback(() => {
    if (size === null) {
      return;
    }

    const actual = centre(size, pane, 1);
    setView({ mode: "free", ...actual });
  }, [pane, setView, size]);

  const fit = useCallback(() => {
    setView({ mode: "fit" });
  }, [setView]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (placement === null || event.button !== 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: placement.x,
      originY: placement.y,
    };
    setIsDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId || placement === null) {
      return;
    }

    setView({
      mode: "free",
      scale: placement.scale,
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    setIsDragging(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomByFactor(BUTTON_ZOOM_FACTOR);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomByFactor(1 / BUTTON_ZOOM_FACTOR);
    } else if (event.key === "0") {
      event.preventDefault();
      fit();
    } else if (event.key === "1") {
      event.preventDefault();
      showActualSize();
    }
  };

  const onLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    const width = image.naturalWidth > 0 ? image.naturalWidth : FALLBACK_WIDTH_PX;
    const height = image.naturalHeight > 0 ? image.naturalHeight : FALLBACK_HEIGHT_PX;

    setLoad({ status: "ready", size: { width, height } });
  };

  const onError = () => {
    setLoad({ status: "error" });
  };

  const isReady = placement !== null && size !== null;
  const isPixelated = isReady && placement.scale >= PIXELATED_FROM_SCALE;

  const imageClassName = [
    "image-viewer__image",
    isReady ? "" : "image-viewer__image--hidden",
    isPixelated ? "image-viewer__image--pixelated" : "",
  ]
    .filter((className) => className.length > 0)
    .join(" ");

  return (
    <div className="image-viewer">
      <div className="image-viewer__toolbar">
        <span className="image-viewer__info">
          {size === null ? "" : `${size.width} × ${size.height} px`}
        </span>

        <div className="image-viewer__controls">
          <button
            aria-label="Zoom out"
            className="image-viewer__button"
            disabled={!isReady}
            onClick={() => zoomByFactor(1 / BUTTON_ZOOM_FACTOR)}
            title="Zoom out (-)"
            type="button"
          >
            {"−"}
          </button>

          <span className="image-viewer__zoom">{isReady ? formatPercent(placement.scale) : "—"}</span>

          <button
            aria-label="Zoom in"
            className="image-viewer__button"
            disabled={!isReady}
            onClick={() => zoomByFactor(BUTTON_ZOOM_FACTOR)}
            title="Zoom in (+)"
            type="button"
          >
            {"+"}
          </button>

          <button
            aria-pressed={view.mode === "fit"}
            className="image-viewer__button image-viewer__button--text"
            disabled={!isReady}
            onClick={fit}
            title="Fit to pane (0)"
            type="button"
          >
            {"Fit"}
          </button>

          <button
            className="image-viewer__button image-viewer__button--text"
            disabled={!isReady}
            onClick={showActualSize}
            title="Actual size (1)"
            type="button"
          >
            {"1:1"}
          </button>
        </div>
      </div>

      <div
        className={`image-viewer__pane${isDragging ? " image-viewer__pane--dragging" : ""}`}
        onDoubleClick={() => (view.mode === "fit" ? showActualSize() : fit())}
        onKeyDown={onKeyDown}
        onLostPointerCapture={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        ref={paneRef}
        tabIndex={0}
      >
        {load.status === "error" ? (
          <p className="image-viewer__message image-viewer__message--error">
            {"This image cannot be shown: the file is not an image the browser can read."}
          </p>
        ) : null}

        {load.status === "loading" ? (
          <p className="image-viewer__message">{"Loading the image…"}</p>
        ) : null}

        {load.status === "error" ? null : (
          <img
            alt={name ?? ""}
            className={imageClassName}
            draggable={false}
            height={size?.height}
            key={src}
            onError={onError}
            onLoad={onLoad}
            src={src}
            style={
              placement === null
                ? undefined
                : { transform: `translate(${placement.x}px, ${placement.y}px) scale(${placement.scale})` }
            }
            width={size?.width}
          />
        )}
      </div>
    </div>
  );
};

export { ImageViewer };
