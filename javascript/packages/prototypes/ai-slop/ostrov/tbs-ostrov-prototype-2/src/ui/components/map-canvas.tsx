import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useMemo, useRef } from "react";
import { cellAtScreen } from "../../domain/hex/camera";
import { useStore } from "../../store/store";
import { buildOverview, drawViewport } from "../render/map-renderer";
import type {
  THoverHexAction,
  TPanAction,
  TSelectIslandAction,
  TSetViewportAction,
  TZoomAtAction,
} from "../../domain/registry";
import type { FC, PointerEvent, WheelEvent } from "react";

type TMapCanvasRegistrySlice = {
  hoverHexAction: THoverHexAction;
  selectIslandAction: TSelectIslandAction;
  setViewportAction: TSetViewportAction;
  panAction: TPanAction;
  zoomAtAction: TZoomAtAction;
};

type TMapCanvasProps = {
  registry: TMapCanvasRegistrySlice;
};

/** A drag shorter than this counts as a click, so selection survives a shaky hand. */
const CLICK_SLOP = 4;

const ZOOM_PER_WHEEL_NOTCH = 1.0015;

const MapCanvas: FC<TMapCanvasProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ pointerId: -1, lastX: 0, lastY: 0, travelled: 0 });

  const map = store.generatorState.map.value;
  const zoom = store.viewState.zoom.value;
  const cameraX = store.viewState.cameraX.value;
  const cameraY = store.viewState.cameraY.value;
  const viewportWidth = store.viewState.viewportWidth.value;
  const viewportHeight = store.viewState.viewportHeight.value;
  const hoveredIndex = store.viewState.hoveredIndex.value;
  const selectedIslandId = store.viewState.selectedIslandId.value;
  const showGrid = store.viewState.showGrid.value;
  const showIslandOutlines = store.viewState.showIslandOutlines.value;
  const showElevationShading = store.viewState.showElevationShading.value;

  // Redrawing the whole map takes a few hundred milliseconds, so it is rendered
  // once into an offscreen canvas and only rebuilt when what it shows changes.
  const overview = useMemo(() => {
    if (!map) {
      return null;
    }

    return buildOverview(map, { showGrid: false, showIslandOutlines, showElevationShading });
  }, [map, showIslandOutlines, showElevationShading]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }
      registry.setViewportAction(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(stage);

    return () => observer.disconnect();
  }, [registry]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map) {
      return;
    }

    drawViewport(canvas, {
      map,
      overview,
      camera: { x: cameraX, y: cameraY, zoom },
      viewport: { width: viewportWidth, height: viewportHeight },
      hoveredIndex,
      selectedIslandId,
      flags: { showGrid, showIslandOutlines, showElevationShading },
    });
  }, [
    map,
    overview,
    cameraX,
    cameraY,
    zoom,
    viewportWidth,
    viewportHeight,
    hoveredIndex,
    selectedIslandId,
    showGrid,
    showIslandOutlines,
    showElevationShading,
  ]);

  /** Pointer position to a cell index, or `-1` when it is off the map. */
  const indexAt = (event: PointerEvent<HTMLCanvasElement> | WheelEvent<HTMLCanvasElement>): number => {
    const canvas = canvasRef.current;
    if (!canvas || !map) {
      return -1;
    }

    const bounds = canvas.getBoundingClientRect();
    const offset = cellAtScreen(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      { x: cameraX, y: cameraY, zoom },
      { width: viewportWidth, height: viewportHeight },
      map.width,
      map.height
    );

    return offset === null ? -1 : offset.row * map.width + offset.col;
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, travelled: 0 };
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) {
      registry.hoverHexAction(indexAt(event));

      return;
    }

    const deltaX = event.clientX - drag.lastX;
    const deltaY = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.travelled += Math.abs(deltaX) + Math.abs(deltaY);

    registry.panAction(deltaX, deltaY);
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const wasClick = drag.pointerId === event.pointerId && drag.travelled < CLICK_SLOP;
    dragRef.current = { pointerId: -1, lastX: 0, lastY: 0, travelled: 0 };

    if (!wasClick || !map) {
      return;
    }

    const index = indexAt(event);
    const islandId = index === -1 ? -1 : map.cells.islandId[index]!;
    registry.selectIslandAction(islandId);
  };

  const handlePointerLeave = () => {
    registry.hoverHexAction(-1);
  };

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const bounds = canvas.getBoundingClientRect();
    registry.zoomAtAction(
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      Math.pow(ZOOM_PER_WHEEL_NOTCH, -event.deltaY)
    );
  };

  return (
    <div className="map-canvas" ref={stageRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onWheel={handleWheel}
      />
      {map ? null : <p className="map-canvas__empty">{"No map generated yet."}</p>}
    </div>
  );
};

export { MapCanvas };
