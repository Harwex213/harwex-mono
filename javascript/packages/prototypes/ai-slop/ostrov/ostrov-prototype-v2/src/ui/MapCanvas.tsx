import { config } from "@hw/ostrov-prototype-v2-config";
import { effect } from "@preact/signals-react";
import { useEffect, useRef } from "react";
import type { Axial } from "../hex/coords";
import { hexKey } from "../hex/coords";
import { WALL_DEPTH, hexToWorld, worldToHex } from "../hex/layout";
import type { IslandMap } from "../map/island";
import { Renderer } from "../render/renderer";
import type { Camera } from "../state/camera";
import { clampScale, screenToWorld, zoomAt } from "../state/camera";
import { IdleFloat } from "../state/float";
import { PanGlide, PanVelocity } from "../state/inertia";
import { camera, dragging, hovered, island, selected } from "../state/signals";
import { ZoomEase } from "../state/zoom";

const DRAG_SLOP = config.camera.dragSlop;

/** Camera that shows the whole island with a margin, used on first layout. */
function fitCamera(map: IslandMap, width: number, height: number): Camera {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const tile of map.tiles) {
    const centre = hexToWorld(tile);
    minX = Math.min(minX, centre.x - 70);
    maxX = Math.max(maxX, centre.x + 70);
    minY = Math.min(minY, centre.y - 45);
    maxY = Math.max(maxY, centre.y + 45 + WALL_DEPTH);
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    scale: clampScale(Math.min(width / (spanX + 160), height / (spanY + 160))),
  };
}

function sameHex(left: Axial | null, right: Axial | null): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.q === right.q && left.r === right.r;
}

/** Client-space position of one finger or the mouse. */
type PointerSpot = {
  x: number;
  y: number;
};

/** Geometry of the two fingers that own a pinch, kept as the baseline for the next frame. */
type Pinch = {
  distance: number;
  x: number;
  y: number;
};

/** Reads the pinch geometry of the two oldest pointers, or null while fewer than two are down. */
function readPinch(pointers: Map<number, PointerSpot>): Pinch | null {
  if (pointers.size < 2) {
    return null;
  }
  const [first, second] = [...pointers.values()];
  return {
    // A floor of one pixel keeps the frame-to-frame ratio finite when the fingers touch.
    distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

function MapCanvas(): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) {
      return;
    }
    const renderer = new Renderer(canvas);

    let dirty = true;
    let fitted = false;
    let cssWidth = canvas.clientWidth;
    let cssHeight = canvas.clientHeight;
    const pointers = new Map<number, PointerSpot>();
    let dragId: number | null = null;
    let pinch: Pinch | null = null;
    let pinched = false;
    let travelled = 0;
    let lastX = 0;
    let lastY = 0;
    const velocity = new PanVelocity();
    const glide = new PanGlide();
    const float = new IdleFloat();
    const zoom = new ZoomEase();
    // The float offset the last drawn frame used, in screen pixels. Picking and
    // every zoom anchor subtract it, so they read the picture that is on screen
    // rather than the one the camera alone would describe.
    let floatX = 0;
    let floatY = 0;
    // Where the cursor sits right now, so a glide can keep the hover honest.
    let cursorX = 0;
    let cursorY = 0;
    let cursorInside = false;

    const stopWatching = effect(() => {
      // Reading the signals here subscribes the loop to every state change.
      camera.value;
      hovered.value;
      selected.value;
      island.value;
      dirty = true;
    });

    const pickAt = (clientX: number, clientY: number): Axial | null => {
      const rect = canvas.getBoundingClientRect();
      // The island is drawn at `float`, so the same offset comes off the cursor
      // before the inverse transform. Skip it and every pick drifts by a few pixels.
      const point = screenToWorld(
        camera.peek(),
        rect.width,
        rect.height,
        clientX - rect.left - floatX,
        clientY - rect.top - floatY,
      );
      const hex = worldToHex(point.x, point.y);
      return island.peek().byKey.has(hexKey(hex.q, hex.r)) ? hex : null;
    };

    const pick = (event: PointerEvent | WheelEvent): Axial | null => {
      cursorX = event.clientX;
      cursorY = event.clientY;
      cursorInside = true;
      return pickAt(event.clientX, event.clientY);
    };

    /** Re-reads the hex under the cursor. Used after the camera moved on its own. */
    const refreshHover = (): void => {
      if (!cursorInside) {
        return;
      }
      const hex = pickAt(cursorX, cursorY);
      if (!sameHex(hex, hovered.peek())) {
        hovered.value = hex;
      }
    };

    /**
     * Rebuilds the gesture baselines after the pointer count changed. Two pointers own the
     * camera as a pinch, one owns it as a drag anchored at its current position, so neither
     * adding nor lifting a finger makes the map jump.
     */
    const rebaseGesture = (): void => {
      pinch = readPinch(pointers);
      if (pinch) {
        dragId = null;
        dragging.value = false;
        if (hovered.peek() !== null) {
          hovered.value = null;
        }
        return;
      }
      const entries = [...pointers.entries()];
      if (entries.length === 1) {
        const [id, spot] = entries[0];
        dragId = id;
        lastX = spot.x;
        lastY = spot.y;
        velocity.reset(performance.now());
        dragging.value = true;
        return;
      }
      dragId = null;
      dragging.value = false;
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) {
        return;
      }
      // Keeps the browser from turning the touch into a scroll or a text selection.
      event.preventDefault();
      // Touching the map takes the camera back, wherever the glide or the eased
      // wheel zoom had got to.
      glide.stop();
      zoom.stop();
      cursorX = event.clientX;
      cursorY = event.clientY;
      cursorInside = true;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
      if (pointers.size === 1) {
        travelled = 0;
      } else {
        // A second finger turns the gesture into a pinch, and a pinch never selects a tile.
        pinched = true;
      }
      rebaseGesture();
    };

    const onPointerMove = (event: PointerEvent): void => {
      const spot = pointers.get(event.pointerId);
      if (spot) {
        spot.x = event.clientX;
        spot.y = event.clientY;
      }
      if (pinch) {
        event.preventDefault();
        const next = readPinch(pointers);
        if (!next) {
          return;
        }
        const rect = canvas.getBoundingClientRect();
        const current = camera.peek();
        // The midpoint pans the map first, then the change in finger spread zooms around it.
        const panned: Camera = {
          x: current.x - (next.x - pinch.x) / current.scale,
          y: current.y - (next.y - pinch.y) / current.scale,
          scale: current.scale,
        };
        camera.value = zoomAt(
          panned,
          rect.width,
          rect.height,
          next.x - rect.left - floatX,
          next.y - rect.top - floatY,
          next.distance / pinch.distance,
        );
        pinch = next;
        return;
      }
      if (dragId === event.pointerId) {
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        lastX = event.clientX;
        lastY = event.clientY;
        travelled += Math.abs(dx) + Math.abs(dy);
        velocity.sample(dx, dy, performance.now());
        const current = camera.peek();
        camera.value = {
          x: current.x - dx / current.scale,
          y: current.y - dy / current.scale,
          scale: current.scale,
        };
      }
      const hex = pick(event);
      if (!sameHex(hex, hovered.peek())) {
        hovered.value = hex;
      }
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (!pointers.delete(event.pointerId)) {
        return;
      }
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      const wasDrag = dragId === event.pointerId;
      const wasPinch = pinched;
      if (pointers.size === 0) {
        pinched = false;
      }
      rebaseGesture();
      if (!wasDrag || wasPinch || event.type === "pointercancel") {
        return;
      }
      if (travelled > DRAG_SLOP) {
        // Only a real drag hands the camera over to the glide; a click never does.
        if (pointers.size === 0) {
          glide.launch(velocity.release(performance.now()));
        }
        return;
      }
      const hex = pick(event);
      selected.value = hex && sameHex(hex, selected.peek()) ? null : hex;
    };

    const onPointerLeave = (): void => {
      cursorInside = false;
      if (hovered.peek() !== null) {
        hovered.value = null;
      }
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      // Zooming takes the camera back too, so the glide never fights the wheel.
      glide.stop();
      const rect = canvas.getBoundingClientRect();
      // A trackpad pinch arrives as a wheel event with `ctrlKey` set.
      const trackpadPinch = event.ctrlKey;
      const lines = event.deltaMode === 1 ? 16 : 1;
      const intensity = trackpadPinch ? config.camera.pinchZoomSensitivity : config.camera.wheelZoomSensitivity;
      const factor = Math.exp(-event.deltaY * lines * intensity);
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      if (trackpadPinch) {
        // A pinch follows the fingers, so it applies straight away. Easing it
        // would put the picture behind the hands.
        zoom.stop();
        camera.value = zoomAt(camera.peek(), rect.width, rect.height, px - floatX, py - floatY, factor);
      } else {
        // A wheel notch is a discrete step, so it rides there over a few frames.
        zoom.retarget(camera.peek(), rect.width, rect.height, px, py, floatX, floatY, factor);
      }
      const hex = pick(event);
      if (!sameHex(hex, hovered.peek())) {
        hovered.value = hex;
      }
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      cssWidth = entry.contentRect.width;
      cssHeight = entry.contentRect.height;
      dirty = true;
    });
    observer.observe(canvas);

    // `passive: false` on the two handlers that call `preventDefault` to block browser gestures.
    canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
    canvas.addEventListener("pointermove", onPointerMove, { passive: false });
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    let frame = 0;
    let lastStamp = 0;
    const loop = (stamp: number): void => {
      frame = requestAnimationFrame(loop);
      // A long frame is clamped once, here, so a stalled tab cannot jump anything.
      const delta = lastStamp === 0 ? 0 : Math.min((stamp - lastStamp) / 1000, 0.1);
      lastStamp = stamp;
      // The drift only shows while nothing else owns the camera: no finger down,
      // no glide still running, no wheel zoom on its way to a new scale.
      const atRest = pointers.size === 0 && !glide.active && !zoom.active;
      float.update(delta, atRest);
      const offset = float.offset();
      if (offset.x !== floatX || offset.y !== floatY) {
        // Drawing is driven by the offset changing, not by the drift being on.
        // The frame that lands the fade back on zero repaints too, and once the
        // offset stops moving the loop goes quiet again.
        floatX = offset.x;
        floatY = offset.y;
        dirty = true;
      }
      if (zoom.active) {
        const next = zoom.step(delta, cssWidth, cssHeight, floatX, floatY);
        if (next) {
          camera.value = next;
          refreshHover();
        }
      }
      if (glide.active) {
        const step = glide.step(delta);
        if (step) {
          const current = camera.peek();
          camera.value = {
            x: current.x - step.x / current.scale,
            y: current.y - step.y / current.scale,
            scale: current.scale,
          };
          refreshHover();
        }
      }
      if (renderer.resize(cssWidth, cssHeight, window.devicePixelRatio || 1)) {
        dirty = true;
      }
      if (!fitted && renderer.viewportWidth > 1) {
        fitted = true;
        camera.value = fitCamera(island.peek(), renderer.viewportWidth, renderer.viewportHeight);
      }
      if (!dirty) {
        return;
      }
      dirty = false;
      renderer.draw({
        island: island.peek(),
        camera: camera.peek(),
        hovered: hovered.peek(),
        selected: selected.peek(),
        float: { x: floatX, y: floatY },
      });
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      stopWatching();
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  return <canvas ref={ref} className="map-canvas" />;
}

export { MapCanvas };
