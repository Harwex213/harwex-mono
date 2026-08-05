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
import { getLastLabelStats } from "./label-layer";
import {
  countryContainsPoint,
  countryLabelSources,
  showLabels,
  toggleLabels,
} from "../state/label-store";
import { samplePathPixels } from "../map/paint-path";
import {
  hoveredProvinceId,
  selectCountryOfProvince,
  selectProvince,
  selectedProvinceId,
  selectionScope,
  setHoveredProvince,
} from "../state/selection-store";
import {
  cursorMap,
  dpr,
  mapPixelAt,
  panTo,
  panning,
  resetView,
  setCursor,
  setDpr,
  setViewport,
  syncView,
  view,
  viewFitted,
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

// A CONTEXT PRESS: button 2 everywhere, plus a ctrl+left press, which is the
// right click of macOS. There the button stays 0 and `ctrlKey` is the only
// thing that tells the two apart, so a press that is only checked against
// `button === 2` starts a pan or a paint stroke and the country selection never
// happens.
//
// Applied on every platform on purpose. Windows and Linux fire no `contextmenu`
// for a ctrl+click, so `onPointerUp` runs the selection there instead; making
// the press mean the same thing everywhere is cheaper than sniffing the
// platform and getting it wrong on one.
function isContextPress(event: { button: number; ctrlKey: boolean }): boolean {
  return event.button === 2 || (event.button === 0 && event.ctrlKey);
}

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

// A keydown inside a text field is TEXT, not a shortcut. `CountryPanel` and
// every T09-T12 field would otherwise blank the map or jump the view mid-word.
// Shared by every map shortcut, so there is one answer to "is the user typing".
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

// VERIFICATION UI, kept deliberately. The shell now carries the product-facing
// readouts, but this instrument is what proves the screen->map transform has not
// drifted (at 8x, map pixel (1382, 1329) must report province 1000), that the
// scan runs off the main thread, and that the country recompute is cheap. The
// `country` readout is the instrument for the "no freeze while painting" check.
// It sits bottom-LEFT so it never lands under the shell's button bar.
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
  // A plain module variable, one frame stale by construction. That is fine for
  // an instrument: `Hud` re-renders on every `cursorMap` change, so the number
  // is live while anyone is looking at it.
  const labelStats = getLastLabelStats();
  const labelsOn = showLabels.value;

  return (
    <>
      <div className={styles.hud}>
        <span>
          zoom <span className={styles.hudValue}>
            {current ? Math.round(current.scale * 100) + "%" : "—"}
          </span>
        </span>
        {/* The instrument for the resize policy: resize the window and watch
            whether this stays `yes`. A fitted view re-fits on a resize; a
            deliberate zoom reads `no` and keeps its scale. */}
        <span>
          fit <span className={styles.hudValue}>{viewFitted.value ? "yes" : "no"}</span>
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
          scope <span className={styles.hudValue}>{selectionScope.value}</span>
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
        <span>
          labels <span className={styles.hudValue}>{labelsOn ? "on" : "off"}</span>
        </span>
        <span>
          placed <span className={styles.hudValue}>
            {labelStats.drawn + "/" + labelStats.candidates}
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
      // Read fresh inside `draw`, like every other input here. `draw` runs from
      // a requestAnimationFrame callback, outside any tracking context.
      labelSources: countryLabelSources.value,
      countryContains: countryContainsPoint,
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
    // Without this a rename repaints nothing: no other signal in this effect
    // changes when only `country.name` changes.
    void countryLabelSources.value;
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

  // THE ONE window keydown listener for map keys. `L` toggles the country
  // labels — the verification instrument for "the label is not in the sea",
  // press it and see what is underneath. `0` resets the view to the fit scale,
  // the same action as the shell's `Reset view` button, and the escape hatch
  // from any deep zoom. `Escape` belongs to `Shell` and is not handled here.
  //
  // No `preventDefault`: neither key has a default action outside a text field,
  // and `isTypingTarget` has already turned those away.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      if (event.key === "l" || event.key === "L") {
        toggleLabels();
        return;
      }
      if (event.key === "0") {
        resetView();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
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

  // Screen point -> map pixel -> province id. `provinceAt` returns `null` for
  // the sea and for bare canvas alike, so "clicking empty sea clears the
  // selection" needs no separate branch at any call site.
  function provinceAtClient(host: HTMLDivElement, clientX: number, clientY: number): number | null {
    const rect = host.getBoundingClientRect();
    const pixel = mapPixelAt(clientX - rect.left, clientY - rect.top);
    return pixel ? provinceAt(pixel.x, pixel.y) : null;
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
    // A context press starts no gesture at all: it is handled in
    // `onContextMenu`, or in `onPointerUp` on the platforms that fire no
    // `contextmenu` for a ctrl+click. Declining it HERE is what keeps a
    // ctrl+click from painting — `beginStroke` assigns the pressed province
    // immediately, so a stroke started here could not be taken back later.
    //
    // The return is BEFORE the `preventDefault` below on purpose: preventing a
    // pointerdown's default suppresses the compatibility mouse events, and an
    // engine that derives `contextmenu` from `mousedown` would then never fire
    // it. Nothing about a context press needs the text-selection or drag
    // suppression that call gives.
    if (isContextPress(event)) {
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

  // The province is read from the pointer position rather than from
  // `cursorMap`, so a click with no preceding move still selects. A drag past the
  // 3 px threshold deliberately does not.
  //
  // WHICH MODE OWNS THE LEFT CLICK. The paint tool owns the left button whenever
  // it can actually paint — assign mode on AND a country active. The paint
  // branch below returns before the selection branch, so painting never moves
  // the selection. With no active country `onPointerDown` already falls through
  // to a pan, and the click at the end of that fall-through selects, so the map
  // is never a dead surface. A ctrl+left click belongs to NEITHER: it is a
  // context press, and it selects the country in both modes.
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

    // A CTRL+CLICK, on a platform that fires no `contextmenu` for one. The
    // gesture is idle because `onPointerDown` declined the press, so the pan
    // branch below cannot fire and there is nothing to end. On macOS
    // `onContextMenu` has already run this exact intent and `sameSelection`
    // swallows the repeat, so the click means the same thing everywhere.
    if (event.button === 0 && event.ctrlKey && gesture.kind === "idle") {
      selectCountryOfProvince(
        provinceAtClient(event.currentTarget, event.clientX, event.clientY),
      );
      return;
    }

    if (
      event.button === 0 &&
      gesture.kind === "pan" &&
      gesture.pointerId === event.pointerId &&
      !gesture.moved
    ) {
      selectProvince(provinceAtClient(event.currentTarget, event.clientX, event.clientY));
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

  // RIGHT CLICK SELECTS THE PROVINCE'S COUNTRY, in both modes. `contextmenu` is
  // the one event that means "the user asked for the context action" on every
  // platform, including macOS ctrl+click where the pointer button is 0 — and it
  // is the handler that must `preventDefault` anyway.
  //
  // `contextmenu` is derived from `mousedown`, which follows `pointerdown`, so
  // by the time this runs `onPointerDown` has already decided what the press
  // was. A ctrl+click therefore arrives with an IDLE gesture only because
  // `onPointerDown` declines a ctrl+left press exactly as it declines button 2.
  // The guard below then turns away what it is actually for: a genuine right
  // press made DURING a left pan or a paint stroke, which inspects nothing.
  function onContextMenu(event: ReactMouseEvent<HTMLDivElement>): void {
    // Unconditional, and first: the browser menu must not pop even when the
    // press is declined below, and not on a right-drag either.
    event.preventDefault();
    if (isHudControl(event.target)) {
      return;
    }
    if (gestureRef.current.kind !== "idle") {
      return;
    }
    selectCountryOfProvince(provinceAtClient(event.currentTarget, event.clientX, event.clientY));
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
