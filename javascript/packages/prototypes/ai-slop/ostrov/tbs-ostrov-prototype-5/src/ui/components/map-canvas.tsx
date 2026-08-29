import { useSignals } from "@preact/signals-react/runtime";
import { useCallback, useEffect, useRef } from "react";
import { pixelToOffset } from "../../domain/hex/layout";
import { useStore } from "../../store/store";
import { drawMap } from "../render/map-renderer";
import type { THoverTileAction, TSelectTileAction } from "../../domain/registry";
import type { FC, PointerEvent } from "react";

type TMapCanvasRegistrySlice = {
  hoverTileAction: THoverTileAction;
  selectTileAction: TSelectTileAction;
};

type TMapCanvasProps = {
  registry: TMapCanvasRegistrySlice;
};

const MapCanvas: FC<TMapCanvasProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const world = store.worldState.world.value;
  const buildings = store.gameState.buildings.value;
  const summary = store.gameState.summary.value;
  const hexSize = store.viewState.hexSize.value;
  const hoveredIndex = store.viewState.hoveredIndex.value;
  const selectedIndex = store.viewState.selectedIndex.value;
  const pendingKind = store.viewState.pendingKind.value;
  const showYields = store.viewState.showYields.value;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    drawMap(canvas, {
      world,
      buildings,
      hexSize,
      hoveredIndex,
      selectedIndex,
      pendingKind,
      working: summary.working,
      idle: summary.idle,
      showYields,
    });
  }, [world, buildings, summary, hexSize, hoveredIndex, selectedIndex, pendingKind, showYields]);

  /** Pointer position to a tile index, or `-1` when it is off the rectangle. */
  const indexAt = useCallback(
    (event: PointerEvent<HTMLCanvasElement>): number => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return -1;
      }

      const bounds = canvas.getBoundingClientRect();
      const offset = pixelToOffset(event.clientX - bounds.left, event.clientY - bounds.top, hexSize);
      if (offset.col < 0 || offset.col >= world.width) {
        return -1;
      }
      if (offset.row < 0 || offset.row >= world.height) {
        return -1;
      }

      return offset.row * world.width + offset.col;
    },
    [world, hexSize]
  );

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    registry.hoverTileAction(indexAt(event));
  };

  const handlePointerLeave = () => {
    registry.hoverTileAction(-1);
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    registry.selectTileAction(indexAt(event));
  };

  return (
    <div className="map-canvas">
      <canvas
        ref={canvasRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
      />
    </div>
  );
};

export { MapCanvas };
