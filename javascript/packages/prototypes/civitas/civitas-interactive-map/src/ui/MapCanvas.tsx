import { useEffect, useRef } from "react";
import { useSignalEffect, useSignals } from "@preact/signals-react/runtime";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { drawOverlay, drawScene } from "./render";
import { disposeTintLayer, getTintCanvas, syncTintLayer } from "./tint-layer";
import { getMapAssets, loadPhase, mapSize, provinceAt, provinceById } from "../state/map-store";
import {
  borderError,
  borderPhase,
  borderStats,
  bordersVersion,
  countryBorderStats,
  disposeBorders,
  ensureBordersScanned,
  getCountryBorderPaths,
  getProvinceBorderPaths,
} from "../state/borders-store";
import {
  activeCountryId,
  assignMode,
  beginStroke,
  cancelStroke,
  endStroke,
  extendStroke,
  painting,
} from "../state/assign-store";
import { countryTintWords } from "../state/country-store";
import { countryById } from "../state/world-store";
import { samplePathPixels } from "../map/paint-path";
import {
  hoveredProvinceId,
  selectedProvinceId,
  setHoveredProvince,
  setSelectedProvince,
} from "../state/selection-store";
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
import type { HighlightRequest } from "./highlight-layer";
import type { View } from "../map/view";
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
    }
  // `lastX` / `lastY` are MAP pixels: the start point of the next line walk.
  | { kind: "paint"; pointerId: number; lastX: number; lastY: number };

const IDLE: Gesture = { kind: "idle" };

// T06 moved the country controls out to `CountryPanel`, a SIBLING of the host,
// so nothing inside the host takes pointer events today. The guard stays for the
// next control that does: a pointerdown on a descendant button bubbles to the
// host, and without it the host would `preventDefault` and `setPointerCapture`
// on the press. Pointer capture retargets the compatibility mouse events and
// `click` to the capture element, so the button's `onClick` would never run and
// `onPointerUp` would read the press as a click on the map. Mark such a control
// with `data-hud-control`. Every handler that starts or ends a gesture checks it.
function isHudControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-hud-control]") !== null;
}

// T03/T04/T06 VERIFICATION UI — T08 replaces this with the real selection
// panels. It exists to prove the screen->map transform has not drifted (at 8x,
// map pixel (1382, 1329) must report province 1000), that the scan runs off the
// main thread, and that the country recompute is cheap. The `country` readout
// is the instrument for the "no freeze while painting" check.
function Hud() {
  useSignals();

  const current = view.value;
  const cursor = cursorMap.value;
  const id = cursor ? provinceAt(cursor.x, cursor.y) : null;
  const province = id === null ? null : provinceById(id);
  const scan = borderStats.value;
  const country = countryBorderStats.value;
  const selected = selectedProvinceId.value;
  // Without the message a failed scan is indistinguishable from a slow one.
  const failure = borderError.value;
  const activeId = activeCountryId.value;
  const activeCountry = activeId === null ? null : countryById.value.get(activeId);

  return (
    <>
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
        <span>
          selected <span className={styles.hudProvince}>{selected === null ? "—" : selected}</span>
        </span>
        <span>
          border <span className={styles.hudValue}>{borderPhase.value}</span>
        </span>
        {failure === null ? null : (
          <span>
            reason <span className={styles.hudValue}>{failure}</span>
          </span>
        )}
        <span>
          scan <span className={styles.hudValue}>
            {scan ? Math.round(scan.elapsedMs) + " ms" : "—"}
          </span>
        </span>
        <span>
          segs <span className={styles.hudValue}>{scan ? scan.segments : "—"}</span>
        </span>
        <span>
          country <span className={styles.hudValue}>
            {country ? Math.round(country.elapsedMs) + " ms / " + country.segments : "—"}
          </span>
        </span>
        <span>
          mode <span className={styles.hudValue}>{assignMode.value ? "assign" : "pan"}</span>
        </span>
        <span>
          active <span className={styles.hudProvince}>
            {activeCountry ? activeCountry.name : "—"}
          </span>
        </span>
      </div>
    </>
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

    // Hover is skipped when it names the selected province, so the two fills
    // never stack. "select" goes last, so it wins if a future role overlaps.
    const highlights: HighlightRequest[] = [];
    const hovered = hoveredProvinceId.value;
    const selected = selectedProvinceId.value;
    if (hovered !== null && hovered !== selected) {
      const province = provinceById(hovered);
      if (province) {
        highlights.push({ province, role: "hover" });
      }
    }
    if (selected !== null) {
      const province = provinceById(selected);
      if (province) {
        highlights.push({ province, role: "select" });
      }
    }

    drawOverlay({
      ctx: overlayCtx,
      view: current,
      viewport: port,
      dpr: ratio,
      mapSize: size,
      provinceBorders: getProvinceBorderPaths(),
      countryBorders: getCountryBorderPaths(),
      highlights,
      provinceIndex: assets.index,
      // Read fresh inside `draw`, exactly as `getProvinceBorderPaths()` is, so
      // no signal carries the canvas. `null` while nothing is tinted, and the
      // overlay then costs exactly what T04's did.
      tint: getTintCanvas(),
      // The MAP size, never the art's 3652.
      tintSize: size,
    });
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
  //
  // ONE draw path on purpose. A hover change repaints the scene canvas too,
  // which is one `drawImage` (0.8-4 ms measured). Both selection setters
  // deduplicate, so a repaint only happens when the cursor actually crosses a
  // province boundary — a handful of times a second at most. Two rAF handles and
  // two effects would not pay for themselves.
  useSignalEffect(() => {
    void view.value;
    void viewport.value;
    void dpr.value;
    void loadPhase.value;
    void hoveredProvinceId.value;
    void selectedProvinceId.value;
    // The Path2D sets are plain module variables — identity-only objects a signal
    // would gain nothing from — so the draw subscribes to their version counter.
    void bordersVersion.value;
    scheduleDraw();
  });

  // Writes no signal, so it is legal inside `useSignalEffect`. `void
  // loadPhase.value` is required for the same reason `maxProvinceId` reads it —
  // `getMapAssets()` is a plain module variable and notifies nobody.
  useSignalEffect(() => {
    const words = countryTintWords.value;
    void loadPhase.value;
    const assets = getMapAssets();
    if (!assets) {
      return;
    }
    syncTintLayer(assets.index, words, provinceById);
    scheduleDraw();
  });

  useEffect(() => {
    return () => {
      if (frameRef.current !== 0) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      disposeBorders();
      disposeTintLayer();
    };
  }, []);

  // The map size and the viewport arrive from two independent async sources.
  // `syncView` is the single initialisation point and is called from both paths.
  useEffect(() => {
    syncView();
  }, [phase]);

  // A plain effect, not a `useSignalEffect`: it writes signals. Idempotent, and
  // it returns immediately while the map is still loading.
  useEffect(() => {
    ensureBordersScanned();
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

  function startPan(event: ReactPointerEvent<HTMLDivElement>, current: View): void {
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

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (isHudControl(event.target)) {
      return;
    }
    const current = view.value;
    if (!current) {
      return;
    }
    // Stops text selection, the native image drag, and Chrome's middle-button
    // autoscroll.
    event.preventDefault();

    // The middle button always pans, which is what keeps the map navigable
    // while assignment mode holds the left button.
    if (event.button === 1) {
      startPan(event, current);
      return;
    }
    if (event.button !== 0) {
      return;
    }

    if (assignMode.value) {
      const rect = event.currentTarget.getBoundingClientRect();
      const pixel = mapPixelAt(event.clientX - rect.left, event.clientY - rect.top);
      // A press outside the map bounds starts no stroke; it falls through to a
      // pan.
      if (pixel) {
        const id = provinceAt(pixel.x, pixel.y);
        if (beginStroke(id, event.altKey) !== null) {
          event.currentTarget.setPointerCapture(event.pointerId);
          gestureRef.current = {
            kind: "paint",
            pointerId: event.pointerId,
            lastX: pixel.x,
            lastY: pixel.y,
          };
          return;
        }
      }
      // No active country, so the map stays usable: fall through to a pan.
    }

    startPan(event, current);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const rect = event.currentTarget.getBoundingClientRect();
    const pixel = mapPixelAt(event.clientX - rect.left, event.clientY - rect.top);
    setCursor(pixel);
    setHoveredProvince(pixel ? provinceAt(pixel.x, pixel.y) : null);

    const gesture = gestureRef.current;

    if (gesture.kind === "paint" && gesture.pointerId === event.pointerId) {
      // The pointer left the map. The stroke waits rather than painting a line
      // to a clamped edge pixel.
      if (!pixel) {
        return;
      }
      // The line walk, not the event's own pixel: a 60 Hz pointermove during a
      // flick jumps hundreds of map pixels and would leave holes.
      const ids: number[] = [];
      samplePathPixels(gesture.lastX, gesture.lastY, pixel.x, pixel.y, (x, y) => {
        const id = provinceAt(x, y);
        if (id !== null) {
          ids.push(id);
        }
      });
      // One `assignProvinces` per event, not per province. `extendStroke`
      // dedupes, so pushing the same id many times along one line costs a
      // `Set.has` each.
      extendStroke(ids);
      gesture.lastX = pixel.x;
      gesture.lastY = pixel.y;
      return;
    }

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

  // T04 PLACEHOLDER — T08 owns selection semantics (right click selects the
  // country, selection drives the panels). This is here to prove the highlight
  // path works. The province is read from the pointer position rather than from
  // `cursorMap`, so a click with no preceding move still selects. A drag past the
  // 3 px threshold deliberately does not.
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    // While a pan holds pointer capture the pointerup retargets to the host, so
    // `event.target` is only a HUD control when the press started on one and
    // `onPointerDown` already declined it. Nothing to end in that case.
    if (isHudControl(event.target)) {
      return;
    }
    const gesture = gestureRef.current;

    if (gesture.kind === "paint" && gesture.pointerId === event.pointerId) {
      // Flushes the debounced border push, so releasing the mouse updates the
      // country outline within one worker round trip.
      endStroke();
      endGesture(event.currentTarget, event.pointerId);
      return;
    }

    if (
      event.button === 0 &&
      gesture.kind === "pan" &&
      gesture.pointerId === event.pointerId &&
      !gesture.moved
    ) {
      const rect = event.currentTarget.getBoundingClientRect();
      const pixel = mapPixelAt(event.clientX - rect.left, event.clientY - rect.top);
      setSelectedProvince(pixel ? provinceAt(pixel.x, pixel.y) : null);
    }
    endGesture(event.currentTarget, event.pointerId);
  }

  // A cancelled pointer is not a click, so it must not select. A cancelled
  // stroke keeps whatever it already applied — those writes are in the store —
  // but forces no extra worker round trip.
  function onPointerCancel(event: ReactPointerEvent<HTMLDivElement>): void {
    cancelStroke();
    endGesture(event.currentTarget, event.pointerId);
  }

  // Pointer capture normally keeps the events coming, so the `cancelStroke`
  // here is belt and braces.
  function onPointerLeave(event: ReactPointerEvent<HTMLDivElement>): void {
    setCursor(null);
    setHoveredProvince(null);
    if (gestureRef.current.kind === "paint") {
      cancelStroke();
    }
    endGesture(event.currentTarget, event.pointerId);
  }

  function onLostPointerCapture(): void {
    if (gestureRef.current.kind === "paint") {
      cancelStroke();
    }
    gestureRef.current = IDLE;
    if (panning.value) {
      panning.value = false;
    }
  }

  // Chrome pops the autoscroll widget on a middle click otherwise.
  function onAuxClick(event: ReactMouseEvent<HTMLDivElement>): void {
    event.preventDefault();
  }

  function onDoubleClick(event: ReactMouseEvent<HTMLDivElement>): void {
    // Two fast presses on a control must not zoom the map.
    if (isHudControl(event.target)) {
      return;
    }
    // In assign mode the left button is the paint tool. A double click there is
    // two strokes, and zooming under them would move the map out from under the
    // second one. The wheel and the middle drag still work.
    if (assignMode.value) {
      return;
    }
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
      data-mode={assignMode.value ? "assign" : "pan"}
      data-painting={painting.value ? "true" : "false"}
      data-panning={panning.value ? "true" : "false"}
      ref={hostRef}
      onAuxClick={onAuxClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
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
