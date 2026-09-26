import { effect } from "@preact/signals-react";
import { useEffect, useRef } from "react";
import { clampCamera, fitIsland, islandBounds, screenToWorld, zoomAt } from "./camera";
import { drawIsland, subscribeBuildingArt } from "./draw-island";
import { hexIdAtWorldPoint } from "./hit-test";
import { PALETTE } from "../palette";
import { useStore } from "../../store/store";
import type { FC, PointerEvent as TReactPointerEvent } from "react";
import type { TViewport } from "./camera";
import type {
  TArmBuildingAction,
  TDemolishAction,
  THoverHexAction,
  TPlaceBuildingAction,
  TPurgeHexAction,
  TSelectHexAction,
  TSetCameraAction,
  TToggleDemolishAction,
  TTogglePurgeAction,
} from "../../domain/registry";

/**
 * The hero object of the island page. React only mounts the element; every
 * repaint is driven straight from the signals, and the camera is the only thing
 * pan and zoom ever touch (plan §7).
 */

type TIslandCanvasRegistrySlice = {
  armBuilding: TArmBuildingAction;
  toggleDemolish: TToggleDemolishAction;
  togglePurge: TTogglePurgeAction;
  selectHex: TSelectHexAction;
  hoverHex: THoverHexAction;
  setCamera: TSetCameraAction;
  placeBuilding: TPlaceBuildingAction;
  demolish: TDemolishAction;
  purgeHex: TPurgeHexAction;
};

type TIslandCanvasProps = {
  registry: TIslandCanvasRegistrySlice;
};

type TDrag = {
  lastX: number;
  lastY: number;
  startX: number;
  startY: number;
  startedAtMs: number;
  moved: number;
};

/** Pointer travel below this many pixels still counts as a click, not a drag. */
const CLICK_SLOP_PX = 4;

/** A press held longer than this is a drag even when the pointer never moved. */
const CLICK_MAX_MS = 300;

/** The browser reports a touchpad pinch as a wheel event with `ctrlKey`. */
const PINCH_ZOOM_RATE = 0.01;

/** One mouse-wheel notch. */
const WHEEL_ZOOM_STEP = 1.1;

const CANVAS_LABEL_RU = "Остров";
const DEFAULT_DPR = 1;
const MIN_CANVAS_PX = 1;

const IslandCanvas: FC<TIslandCanvasProps> = ({ registry }) => {
  const store = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<TViewport>({ width: 0, height: 0 });
  const dragRef = useRef<TDrag | null>(null);
  const fittedOwnerRef = useRef<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    let frame = 0;

    const measure = (): void => {
      const rect = canvas.getBoundingClientRect();
      viewportRef.current = { width: rect.width, height: rect.height };
      const dpr = window.devicePixelRatio || DEFAULT_DPR;
      const nextWidth = Math.max(MIN_CANVAS_PX, Math.round(rect.width * dpr));
      const nextHeight = Math.max(MIN_CANVAS_PX, Math.round(rect.height * dpr));
      if (canvas.width !== nextWidth) {
        canvas.width = nextWidth;
      }
      if (canvas.height !== nextHeight) {
        canvas.height = nextHeight;
      }
    };

    /**
     * The first measurement, and every change of island, re-frames the view.
     * The two signals are read with `.value`, so the effect below re-runs when
     * the route points at another player.
     */
    const fitOnce = (): void => {
      const island = store.derived.viewedIsland.value;
      const ownerId = store.derived.viewedPlayerId.value;
      const viewport = viewportRef.current;
      if (island === null || viewport.width === 0 || viewport.height === 0) {
        return;
      }
      if (fittedOwnerRef.current === ownerId) {
        return;
      }

      fittedOwnerRef.current = ownerId;
      registry.setCamera(fitIsland(island, viewport));
    };

    const paint = (): void => {
      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        return;
      }

      const dpr = window.devicePixelRatio || DEFAULT_DPR;
      const viewport = viewportRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, viewport.width, viewport.height);

      const island = store.derived.viewedIsland.value;
      const ownerId = store.derived.viewedPlayerId.value;
      const armed = store.ui.armedBuilding.value;
      const players = store.game.players.value;
      if (island === null) {
        return;
      }

      const owner = players.find((player) => player.id === ownerId);
      drawIsland(ctx, {
        island,
        camera: store.ui.camera.value,
        viewport,
        ownerColour: owner === undefined ? PALETTE.toxic : owner.colour,
        hoveredHexId: store.ui.hoveredHexId.value,
        selectedHexId: store.ui.selectedHexId.value,
        legalHexIds: armed === null ? null : store.derived.legalHexIds.value,
        demolishMode: store.ui.demolishMode.value,
        purgeMode: store.ui.purgeMode.value,
        nowMs: performance.now(),
      });

      // The pulse is the only animation, so the frame loop runs only while armed.
      cancelAnimationFrame(frame);
      if (armed !== null) {
        frame = requestAnimationFrame(paint);
      }
    };

    // React's `onWheel` prop is passive, so `preventDefault` there silently
    // fails and the page scrolls instead of zooming (plan §7).
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const viewport = viewportRef.current;
      const camera = store.ui.camera.peek();
      const island = store.derived.viewedIsland.peek();
      if (island === null) {
        return;
      }
      const bounds = islandBounds(island);

      if (event.ctrlKey === true) {
        registry.setCamera(zoomAt(camera, point, Math.exp(-event.deltaY * PINCH_ZOOM_RATE), viewport, bounds));

        return;
      }

      if (event.deltaX !== 0) {
        const panned = {
          x: camera.x + event.deltaX / camera.scale,
          y: camera.y + event.deltaY / camera.scale,
          scale: camera.scale,
        };
        registry.setCamera(clampCamera(panned, bounds, viewport));

        return;
      }

      const factor = event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
      registry.setCamera(zoomAt(camera, point, factor, viewport, bounds));
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }

      registry.armBuilding(null);
      if (store.ui.demolishMode.peek() === true) {
        registry.toggleDemolish();
      }
      if (store.ui.purgeMode.peek() === true) {
        registry.togglePurge();
      }
      registry.selectHex(null);
    };

    measure();
    const stopFit = effect(fitOnce);
    const stopPaint = effect(paint);
    const stopArtWatch = subscribeBuildingArt(paint);
    const observer = new ResizeObserver(() => {
      measure();
      fitOnce();
      paint();
    });
    observer.observe(canvas);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      stopFit();
      stopPaint();
      stopArtWatch();
      observer.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [registry, store]);

  const hexAt = (event: TReactPointerEvent<HTMLCanvasElement>): string | null => {
    const island = store.derived.viewedIsland.peek();
    if (island === null) {
      return null;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const world = screenToWorld(point, store.ui.camera.peek(), viewportRef.current);

    return hexIdAtWorldPoint(island, world);
  };

  const onClick = (event: TReactPointerEvent<HTMLCanvasElement>): void => {
    const hexId = hexAt(event);
    const armed = store.ui.armedBuilding.peek();
    if (armed !== null && hexId !== null) {
      registry.placeBuilding(hexId, armed);

      return;
    }

    if (store.ui.demolishMode.peek() === true && hexId !== null) {
      registry.demolish(hexId);

      return;
    }

    if (store.ui.purgeMode.peek() === true && hexId !== null) {
      registry.purgeHex(hexId);

      return;
    }

    registry.selectHex(hexId);
  };

  return (
    <canvas
      ref={canvasRef}
      className="island-canvas"
      aria-label={CANVAS_LABEL_RU}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          lastX: event.clientX,
          lastY: event.clientY,
          startX: event.clientX,
          startY: event.clientY,
          startedAtMs: performance.now(),
          moved: 0,
        };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (drag !== null && event.buttons === 1) {
          const deltaX = event.clientX - drag.lastX;
          const deltaY = event.clientY - drag.lastY;
          drag.lastX = event.clientX;
          drag.lastY = event.clientY;
          drag.moved += Math.abs(deltaX) + Math.abs(deltaY);

          const island = store.derived.viewedIsland.peek();
          if (island === null) {
            return;
          }
          const camera = store.ui.camera.peek();
          const panned = {
            x: camera.x - deltaX / camera.scale,
            y: camera.y - deltaY / camera.scale,
            scale: camera.scale,
          };
          registry.setCamera(clampCamera(panned, islandBounds(island), viewportRef.current));

          return;
        }

        registry.hoverHex(hexAt(event), { x: event.clientX, y: event.clientY });
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId) === true) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (drag === null) {
          return;
        }

        const travelled = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
        const elapsedMs = performance.now() - drag.startedAtMs;
        if (travelled > CLICK_SLOP_PX || drag.moved > CLICK_SLOP_PX || elapsedMs > CLICK_MAX_MS) {
          return;
        }

        onClick(event);
      }}
      onPointerLeave={() => {
        dragRef.current = null;
        registry.hoverHex(null, null);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        registry.armBuilding(null);
        if (store.ui.demolishMode.peek() === true) {
          registry.toggleDemolish();
        }
        if (store.ui.purgeMode.peek() === true) {
          registry.togglePurge();
        }
      }}
    />
  );
};

export type { TIslandCanvasRegistrySlice };
export { IslandCanvas };
