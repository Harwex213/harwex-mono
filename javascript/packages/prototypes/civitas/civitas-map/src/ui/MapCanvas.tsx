import { signal, useSignalEffect } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { buildMask } from "../map/brush";
import { screenToMap, zoomAt } from "../map/view";
import {
  activeProvince,
  brushShape,
  brushSize,
  commitStroke,
  error,
  getBitmap,
  getLayer,
  hoverColor,
  hoverPixel,
  layerOpacity,
  layerRevision,
  layerVisible,
  mapInfo,
  markLayerChanged,
  measureViewport,
  selectProvinceByColor,
  showBaseMap,
  tool,
  view,
  viewport,
} from "../state/editor-state";
import { drawPreview, drawScene } from "./render";
import styles from "./map-canvas.module.css";

type Gesture =
  | { kind: "idle" }
  | { kind: "pan"; pointerId: number; startX: number; startY: number; originX: number; originY: number }
  | { kind: "paint"; pointerId: number; erasing: boolean; lastX: number; lastY: number };

const WHEEL_STEP = 1.0015;

// Wheel deltas come in three units depending on the browser and the device, and
// treating a 3-line notch as 3 pixels makes Firefox zoom in imperceptible steps.
const DELTA_TO_PIXELS = [1, 16, 100];

// Held space pans with any tool, the way it does in every paint program. A signal
// rather than component state, so the pointer handlers and the cursor style read
// the same value without a prop.
const spaceHeld = signal(false);

function MapCanvas() {
  useSignals();

  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<Gesture>({ kind: "idle" });

  const info = mapInfo.value;

  useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return;
    }

    const observer = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect();

      measureViewport(rect.width, rect.height);
    });

    observer.observe(host);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        spaceHeld.value = event.type === "keydown";
      }
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  // React registers `wheel` as a passive listener, so `preventDefault` there is
  // ignored and the page scrolls while zooming. Hence a native listener.
  useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();

      const rect = host.getBoundingClientRect();
      const delta = event.deltaY * (DELTA_TO_PIXELS[event.deltaMode] ?? 1);

      view.value = zoomAt(
        view.value,
        event.clientX - rect.left,
        event.clientY - rect.top,
        WHEEL_STEP ** -delta,
      );
    };

    host.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      host.removeEventListener("wheel", onWheel);
    };
  }, []);

  useSignalEffect(() => {
    const canvas = sceneRef.current;
    const size = viewport.value;
    const currentView = view.value;
    const showMap = showBaseMap.value;
    const showLayer = layerVisible.value;
    const opacity = layerOpacity.value;

    // Read for the dependency: the pixels changed, the reference did not.
    void layerRevision.value;

    if (!canvas) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.round(size.width * dpr);
      canvas.height = Math.round(size.height * dpr);
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;

      const ctx = canvas.getContext("2d");

      if (!ctx) {
        return;
      }

      drawScene({
        ctx,
        cssWidth: size.width,
        cssHeight: size.height,
        dpr,
        view: currentView,
        bitmap: getBitmap(),
        layer: getLayer(),
        showBaseMap: showMap,
        showLayer,
        layerOpacity: opacity,
      });
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  });

  useSignalEffect(() => {
    const canvas = overlayRef.current;
    const size = viewport.value;
    const currentView = view.value;
    const cursor = hoverPixel.value;
    const currentTool = tool.value;
    const mask = buildMask(brushSize.value, brushShape.value);
    const province = activeProvince.value;

    if (!canvas) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.round(size.width * dpr);
      canvas.height = Math.round(size.height * dpr);
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;

      const ctx = canvas.getContext("2d");

      if (!ctx) {
        return;
      }

      drawPreview({
        ctx,
        cssWidth: size.width,
        cssHeight: size.height,
        dpr,
        view: currentView,
        mask,
        cursor,
        color: province?.color ?? 0,
        erasing: currentTool === "eraser",
        // Bucket and picker act on one pixel, so a brush footprint would
        // overstate what a click does.
        crosshairOnly: currentTool === "bucket" || currentTool === "picker",
      });
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  });

  function pointerToPixel(event: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = screenToMap(view.value, event.clientX - rect.left, event.clientY - rect.top);

    return { x: Math.floor(point.x), y: Math.floor(point.y) };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    const layer = getLayer();

    if (!layer) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    const panning = spaceHeld.value || event.button === 1;

    if (panning) {
      gestureRef.current = {
        kind: "pan",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: view.value.x,
        originY: view.value.y,
      };

      return;
    }

    if (event.button !== 0 && event.button !== 2) {
      return;
    }

    const pixel = pointerToPixel(event);

    if (!layer.contains(pixel.x, pixel.y)) {
      return;
    }

    if (tool.value === "picker") {
      const picked = layer.pixelAt(pixel.x, pixel.y);

      if (!selectProvinceByColor(picked)) {
        error.value = "No province is painted at that pixel";
      }

      return;
    }

    // The right button erases whatever the active tool is, the same convention a
    // pixel editor uses for its secondary colour.
    const erasing = event.button === 2 || tool.value === "eraser";
    const province = activeProvince.value;

    if (!erasing && !province) {
      error.value = "Add a province before painting";

      return;
    }

    const value = erasing ? 0 : (province?.color ?? 0);

    layer.beginStroke();

    if (tool.value === "bucket") {
      layer.floodFill(pixel.x, pixel.y, value);
      layer.flushDirty();
      commitStroke();

      return;
    }

    layer.stamp(pixel.x, pixel.y, buildMask(brushSize.value, brushShape.value), value);
    layer.flushDirty();
    markLayerChanged();

    gestureRef.current = {
      kind: "paint",
      pointerId: event.pointerId,
      erasing,
      lastX: pixel.x,
      lastY: pixel.y,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const layer = getLayer();

    if (!layer) {
      return;
    }

    const pixel = pointerToPixel(event);
    const gesture = gestureRef.current;

    if (gesture.kind !== "pan") {
      hoverPixel.value = layer.contains(pixel.x, pixel.y) ? pixel : null;
      hoverColor.value = layer.pixelAt(pixel.x, pixel.y);
    }

    if (gesture.kind === "pan" && gesture.pointerId === event.pointerId) {
      view.value = {
        scale: view.value.scale,
        x: gesture.originX + (event.clientX - gesture.startX),
        y: gesture.originY + (event.clientY - gesture.startY),
      };

      return;
    }

    if (gesture.kind !== "paint" || gesture.pointerId !== event.pointerId) {
      return;
    }

    const province = activeProvince.value;
    const value = gesture.erasing ? 0 : (province?.color ?? 0);

    // Pointer samples skip pixels on a fast drag, so the segment between the
    // last sample and this one is filled rather than the sample alone.
    layer.strokeSegment(
      gesture.lastX,
      gesture.lastY,
      pixel.x,
      pixel.y,
      buildMask(brushSize.value, brushShape.value),
      value,
    );
    layer.flushDirty();
    markLayerChanged();

    gesture.lastX = pixel.x;
    gesture.lastY = pixel.y;
  }

  function endGesture(event: ReactPointerEvent<HTMLDivElement>): void {
    const gesture = gestureRef.current;

    if (gesture.kind === "idle" || gesture.pointerId !== event.pointerId) {
      return;
    }

    if (gesture.kind === "paint") {
      commitStroke();
    }

    gestureRef.current = { kind: "idle" };
  }

  function onPointerLeave(): void {
    hoverPixel.value = null;
    hoverColor.value = 0;
  }

  const cursorClass = (() => {
    if (spaceHeld.value) {
      return styles.cursorPan;
    }
    if (tool.value === "picker") {
      return styles.cursorPicker;
    }

    return styles.cursorPaint;
  })();

  return (
    <div
      className={`${styles.host} ${cursorClass}`}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      onPointerCancel={endGesture}
      onPointerDown={onPointerDown}
      onPointerLeave={onPointerLeave}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      ref={hostRef}
    >
      <canvas className={styles.canvas} ref={sceneRef} />
      <canvas className={styles.canvas} ref={overlayRef} />
      {!info && <p className={styles.empty}>Load a map image to start</p>}
    </div>
  );
}

export { MapCanvas };
