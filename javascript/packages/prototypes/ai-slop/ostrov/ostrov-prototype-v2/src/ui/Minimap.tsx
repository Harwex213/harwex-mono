import { config } from "@hw/ostrov-prototype-v2-config";
import { effect } from "@preact/signals-react";
import { useEffect, useRef } from "react";
import { drawMinimap, projectionFor, toWorld } from "../render/minimap";
import { clampCamera } from "../state/camera";
import { exploredDiscs, sampleFog } from "../state/fog";
import { camera, territoryVersion, viewport, world } from "../state/signals";

/**
 * Side of the minimap in CSS pixels. The canvas is square, so one number does.
 *
 * The world holds around eighty islands across three rings, and the number that
 * matters is how far apart two neighbouring marks of the outer ring land. At 190
 * that gap was about eight pixels and the ring read as one grainy band; the
 * designer's number lives in the config now, so the trade between a readable
 * ring and a corner of the screen is theirs.
 */
const MINIMAP_SIZE = config.ui.minimapSize;

/**
 * The overview map in the bottom-left corner.
 *
 * It draws on demand: an effect marks it dirty whenever the camera, the world or
 * the viewport changes and one animation frame is asked for, so nothing here
 * spins while the player sits still.
 *
 * It also owns its own pointer events. The canvas sits in the overlay, above the
 * map canvas, so a press here never reaches the map at all: no pan, no tile
 * selection and no building laid on whatever hex happened to be underneath.
 */
function Minimap(): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    let frame = 0;
    let ratio = 0;

    const paint = (): void => {
      frame = 0;
      const wanted = window.devicePixelRatio || 1;
      if (wanted !== ratio) {
        ratio = wanted;
        canvas.width = Math.round(MINIMAP_SIZE * ratio);
        canvas.height = Math.round(MINIMAP_SIZE * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const fog = sampleFog(performance.now());
      drawMinimap(ctx, MINIMAP_SIZE, {
        world: world.peek(),
        camera: camera.peek(),
        viewport: viewport.peek(),
        fog,
        known: exploredDiscs(),
      });
      // A region still fading in is the one thing here that moves on its own, so
      // the overview asks for another frame only while that is true.
      if (!fog.settled) {
        invalidate();
      }
    };

    const invalidate = (): void => {
      if (frame === 0) {
        frame = requestAnimationFrame(paint);
      }
    };

    const stopWatching = effect(() => {
      // Reading the four signals subscribes the redraw to them and to nothing else.
      camera.value;
      world.value;
      viewport.value;
      territoryVersion.value;
      invalidate();
    });

    /** Puts the camera on the world point under the pointer. */
    const jumpTo = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const current = world.peek();
      const projection = projectionFor(current, MINIMAP_SIZE);
      const point = toWorld(
        projection,
        ((event.clientX - rect.left) / rect.width) * MINIMAP_SIZE,
        ((event.clientY - rect.top) / rect.height) * MINIMAP_SIZE,
      );
      const next = camera.peek();
      camera.value = clampCamera({ x: point.x, y: point.y, scale: next.scale }, current.bounds, viewport.peek());
    };

    let scrubbing = false;

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      scrubbing = true;
      canvas.setPointerCapture(event.pointerId);
      jumpTo(event);
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!scrubbing) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      jumpTo(event);
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (!scrubbing) {
        return;
      }
      scrubbing = false;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      event.preventDefault();
      event.stopPropagation();
    };

    canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
    canvas.addEventListener("pointermove", onPointerMove, { passive: false });
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    return () => {
      stopWatching();
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="minimap"
      style={{ width: `${MINIMAP_SIZE}px`, height: `${MINIMAP_SIZE}px` }}
      aria-label="Карта мира"
    />
  );
}

export { MINIMAP_SIZE, Minimap };
