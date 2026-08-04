import { useEffect, useRef } from "react";
import { useSignalEffect, useSignals } from "@preact/signals-react/runtime";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { drawOverlay, drawScene } from "./render";
import { getMapAssets, loadPhase, mapSize, provinceAt, provinceById } from "../state/map-store";
import {
  cursorMap,
  dpr,
  mapPixelAt,
  panTo,
  panning,
  setCursor,
  setDpr,
  setViewport,
  syncView,
  view,
  viewport,
  zoomAtPoint,
} from "../state/view-store";
import styles from "./map-canvas.module.css";

// `deltaMode` 0 = pixel, 1 = line, 2 = page. The conversion is not optional:
// Firefox reports one wheel notch as `deltaY: 3, deltaMode: 1`, and treating
// that as 3 pixels makes each notch a 0.45 % zoom — a visually dead wheel.
const DELTA_TO_PIXELS = [1, 16, 100];
const WHEEL_STEP = 1.0015;
const DOUBLE_CLICK_FACTOR = 2;
const DRAG_THRESHOLD = 3;

type Gesture =
  | { kind: "idle" }
  | {
      kind: "pan";
      pointerId: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
      moved: boolean;
    };

const IDLE: Gesture = { kind: "idle" };

// T03 VERIFICATION UI — T08 replaces this with the real selection panels. It
// exists to prove the screen->map transform has not drifted: at 8x, map pixel
// (1382, 1329) must report province 1000.
function Hud() {
  useSignals();

  const current = view.value;
  const cursor = cursorMap.value;
  const id = cursor ? provinceAt(cursor.x, cursor.y) : null;
  const province = id === null ? null : provinceById(id);

  return (
    <div className={styles.hud}>
      <span>
        zoom <span className={styles.hudValue}>
          {current ? Math.round(current.scale * 100) + "%" : "—"}
        </span>
      </span>
      <span>
        px <span className={styles.hudValue}>
          {cursor ? cursor.x + ", " + cursor.y : "—"}
        </span>
      </span>
      <span>
        province <span className={styles.hudProvince}>
          {id === null ? "—" : id + (province ? " " + province.name : "")}
        </span>
      </span>
    </div>
  );
}

function MapCanvas() {
  useSignals();

  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(0);
  const gestureRef = useRef<Gesture>(IDLE);

  const phase = loadPhase.value;

  // Reads every input fresh rather than closing over the values the effect saw,
  // so a coalesced frame always paints the newest state.
  function draw(): void {
    const scene = sceneRef.current;
    const overlay = overlayRef.current;
    if (!scene || !overlay) {
      return;
    }

    const port = viewport.value;
    const ratio = dpr.value;
    const width = Math.max(1, Math.round(port.width * ratio));
    const height = Math.max(1, Math.round(port.height * ratio));

    for (const canvas of [scene, overlay]) {
      // Assigning `canvas.width` reallocates and clears the backing store even
      // when the value is unchanged. Guard with `!==`.
      if (canvas.width !== width) {
        canvas.width = width;
      }
      if (canvas.height !== height) {
        canvas.height = height;
      }
      canvas.style.width = port.width + "px";
      canvas.style.height = port.height + "px";
    }

    const sceneCtx = scene.getContext("2d");
    const overlayCtx = overlay.getContext("2d");
    if (!sceneCtx || !overlayCtx) {
      return;
    }

    const current = view.value;
    const size = mapSize.value;
    const assets = getMapAssets();
    if (!current || !size || !assets) {
      sceneCtx.setTransform(1, 0, 0, 1, 0, 0);
      sceneCtx.clearRect(0, 0, scene.width, scene.height);
      overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
      overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
      return;
    }

    // Both layers painted in the SAME callback from the SAME view and dpr.
    // Splitting them across two frames reads as the overlay sliding against the
    // art during a pan.
    drawScene({
      ctx: sceneCtx,
      view: current,
      viewport: port,
      dpr: ratio,
      art: assets.art,
      mapSize: size,
    });
    drawOverlay({ ctx: overlayCtx, view: current, viewport: port, dpr: ratio, mapSize: size });
  }

  function scheduleDraw(): void {
    if (frameRef.current !== 0) {
      return;
    }
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      draw();
    });
  }

  // Reads the four inputs so the effect subscribes to them, then schedules.
  // It returns NO cleanup on purpose: cancelling the pending frame on every
  // signal change would mean a wheel burst repeatedly cancels the frame it just
  // scheduled. The single guarded handle already yields exactly one paint per
  // frame no matter how many events land.
  useSignalEffect(() => {
    void view.value;
    void viewport.value;
    void dpr.value;
    void loadPhase.value;
    scheduleDraw();
  });

  useEffect(() => {
    return () => {
      if (frameRef.current !== 0) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
    };
  }, []);

  // The map size and the viewport arrive from two independent async sources.
  // `syncView` is the single initialisation point and is called from both paths.
  useEffect(() => {
    syncView();
  }, [phase]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    // `getBoundingClientRect` rather than `entry.contentRect`: the host has no
    // border or padding, and this is the same number the pointer maths uses.
    const observer = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect();
      setViewport(rect.width, rect.height);
    });
    observer.observe(host);
    const initial = host.getBoundingClientRect();
    setViewport(initial.width, initial.height);
    return () => {
      observer.disconnect();
    };
  }, []);

  // A `resolution` media query only fires when the ratio LEAVES its current
  // value, so the listener has to be re-armed at the new ratio each time.
  useEffect(() => {
    let media: MediaQueryList | null = null;
    const update = () => {
      const next = window.devicePixelRatio || 1;
      setDpr(next);
      if (media) {
        media.removeEventListener("change", update);
      }
      media = window.matchMedia("(resolution: " + next + "dppx)");
      media.addEventListener("change", update);
    };
    update();
    return () => {
      if (media) {
        media.removeEventListener("change", update);
      }
    };
  }, []);

  // React's synthetic `onWheel` is registered passively, so `preventDefault`
  // there is ignored and the page scrolls behind the zoom. Native listener with
  // `{ passive: false }` only.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const delta = event.deltaY * (DELTA_TO_PIXELS[event.deltaMode] ?? 1);
      zoomAtPoint(event.clientX - rect.left, event.clientY - rect.top, WHEEL_STEP ** -delta);
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      host.removeEventListener("wheel", onWheel);
    };
  }, []);

  function endGesture(target: HTMLElement, pointerId: number): void {
    if (target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    gestureRef.current = IDLE;
    if (panning.value) {
      panning.value = false;
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }
    const current = view.value;
    if (!current) {
      return;
    }
    // Stops text selection and the native image drag.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      kind: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: current.x,
      originY: current.y,
      moved: false,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    setCursor(mapPixelAt(event.clientX - rect.left, event.clientY - rect.top));

    const gesture = gestureRef.current;
    if (gesture.kind !== "pan" || gesture.pointerId !== event.pointerId) {
      return;
    }

    let dx = event.clientX - gesture.startX;
    let dy = event.clientY - gesture.startY;
    if (!gesture.moved) {
      const distance = Math.hypot(dx, dy);
      if (distance < DRAG_THRESHOLD) {
        return;
      }
      // Re-base by exactly the threshold along the direction of travel, so the
      // map does not jump by the threshold distance AND no more than the
      // threshold is ever swallowed. Re-basing to the raw pointer position
      // instead would discard the whole first move, which is fine for a human
      // hand moving a pixel at a time but throws away a fast flick entirely.
      gesture.moved = true;
      gesture.startX += (dx / distance) * DRAG_THRESHOLD;
      gesture.startY += (dy / distance) * DRAG_THRESHOLD;
      dx = event.clientX - gesture.startX;
      dy = event.clientY - gesture.startY;
      panning.value = true;
    }

    // Always origin + total delta, never an accumulation of per-move deltas.
    // Accumulation drifts and fights the clamp: once the clamp bites, the
    // swallowed deltas mean the map stops following the pointer back.
    panTo(gesture.originX + dx, gesture.originY + dy);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    endGesture(event.currentTarget, event.pointerId);
  }

  function onPointerLeave(event: ReactPointerEvent<HTMLDivElement>): void {
    setCursor(null);
    endGesture(event.currentTarget, event.pointerId);
  }

  function onLostPointerCapture(): void {
    gestureRef.current = IDLE;
    if (panning.value) {
      panning.value = false;
    }
  }

  function onDoubleClick(event: ReactMouseEvent<HTMLDivElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    zoomAtPoint(event.clientX - rect.left, event.clientY - rect.top, DOUBLE_CLICK_FACTOR);
  }

  function onContextMenu(event: ReactMouseEvent<HTMLDivElement>): void {
    // T08 puts right-click country selection here; the browser menu must not
    // pop for it or for a right-drag.
    event.preventDefault();
  }

  return (
    <div
      className={styles.host}
      data-panning={panning.value ? "true" : "false"}
      ref={hostRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <canvas className={styles.canvas} ref={sceneRef} />
      <canvas className={styles.canvas} ref={overlayRef} />
      <Hud />
    </div>
  );
}

export { MapCanvas };
