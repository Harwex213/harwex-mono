import { effect } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import type { Axial } from "../hex/coords";
import { hexKey } from "../hex/coords";
import { WALL_DEPTH, hexToWorld, worldToHex } from "../hex/layout";
import type { IslandMap } from "../map/island";
import { Renderer } from "../render/renderer";
import type { Camera } from "../state/camera";
import { clampScale, screenToWorld, zoomAt } from "../state/camera";
import { camera, dragging, hovered, island, selected } from "../state/signals";

const DRAG_SLOP = 5;

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

function MapCanvas(): React.JSX.Element {
  useSignals();
  const ref = useRef<HTMLCanvasElement>(null);
  const grabbing = dragging.value;

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
    let pointerId: number | null = null;
    let travelled = 0;
    let lastX = 0;
    let lastY = 0;

    const stopWatching = effect(() => {
      // Reading the signals here subscribes the loop to every state change.
      camera.value;
      hovered.value;
      selected.value;
      island.value;
      dirty = true;
    });

    const pick = (event: PointerEvent | WheelEvent): Axial | null => {
      const rect = canvas.getBoundingClientRect();
      const point = screenToWorld(
        camera.peek(),
        rect.width,
        rect.height,
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      const hex = worldToHex(point.x, point.y);
      return island.peek().byKey.has(hexKey(hex.q, hex.r)) ? hex : null;
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) {
        return;
      }
      pointerId = event.pointerId;
      travelled = 0;
      lastX = event.clientX;
      lastY = event.clientY;
      dragging.value = true;
      canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (pointerId === event.pointerId) {
        const dx = event.clientX - lastX;
        const dy = event.clientY - lastY;
        lastX = event.clientX;
        lastY = event.clientY;
        travelled += Math.abs(dx) + Math.abs(dy);
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
      if (pointerId !== event.pointerId) {
        return;
      }
      pointerId = null;
      dragging.value = false;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      if (travelled > DRAG_SLOP) {
        return;
      }
      const hex = pick(event);
      selected.value = hex && sameHex(hex, selected.peek()) ? null : hex;
    };

    const onPointerLeave = (): void => {
      if (hovered.peek() !== null) {
        hovered.value = null;
      }
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      // A trackpad pinch arrives as a wheel event with `ctrlKey` set.
      const lines = event.deltaMode === 1 ? 16 : 1;
      const intensity = event.ctrlKey ? 0.02 : 0.0022;
      const factor = Math.exp(-event.deltaY * lines * intensity);
      camera.value = zoomAt(
        camera.peek(),
        rect.width,
        rect.height,
        event.clientX - rect.left,
        event.clientY - rect.top,
        factor,
      );
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

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    let frame = 0;
    const loop = (): void => {
      frame = requestAnimationFrame(loop);
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

  return <canvas ref={ref} className={grabbing ? "map-canvas grabbing" : "map-canvas"} />;
}

export { MapCanvas };
