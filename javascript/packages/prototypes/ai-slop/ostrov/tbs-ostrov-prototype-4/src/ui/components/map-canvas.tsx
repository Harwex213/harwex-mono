import { useSignals } from "@preact/signals-react/runtime";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { axialKey } from "../../domain/hex/coords";
import { pixelToAxial } from "../../domain/hex/layout";
import { movementFor } from "../../domain/rules/board";
import { useStore } from "../../store/store";
import { STRIKE_DURATION_MS, boardBounds, drawMap } from "../render/map-renderer";
import type { TClickTileAction, THoverTileAction } from "../../domain/registry";
import type { TRenderInput } from "../render/map-renderer";
import type { FC, PointerEvent } from "react";

type TMapCanvasRegistrySlice = {
  clickTileAction: TClickTileAction;
  hoverTileAction: THoverTileAction;
};

type TMapCanvasProps = {
  registry: TMapCanvasRegistrySlice;
};

const MapCanvas: FC<TMapCanvasProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const world = store.worldState.world.value;
  const armies = store.gameState.armies.value;
  const structures = store.gameState.structures.value;
  const visible = store.gameState.visible.value;
  const explored = store.gameState.explored.value;
  const selectedArmyId = store.selectionState.selectedArmyId.value;
  const hoveredKey = store.selectionState.hoveredKey.value;
  const hexSize = store.viewState.hexSize.value;
  const showGrid = store.viewState.showGrid.value;
  const showFog = store.viewState.showFog.value;
  const showCoords = store.viewState.showCoords.value;
  const move = store.animationState.move.value;
  const strike = store.animationState.strike.value;
  const phase = store.gameState.phase.value;

  /** Only a player army with something left to spend gets an overlay. */
  const movement = useMemo(() => {
    const army = armies.find((candidate) => candidate.id === selectedArmyId);
    if (!world || !army || army.owner !== "player" || army.movementLeft <= 0 || army.hasAttacked) {
      return null;
    }

    return movementFor({ world, armies, structures }, army, army.movementLeft);
  }, [world, armies, structures, selectedArmyId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !world) {
      return;
    }

    const input: Omit<TRenderInput, "now"> = {
      world,
      armies,
      structures,
      visible,
      explored,
      selectedArmyId,
      movement,
      hoveredKey,
      hexSize,
      showGrid,
      showFog,
      showCoords,
      move,
      strike,
    };

    let frame = 0;
    const render = () => {
      const now = performance.now();
      drawMap(canvas, { ...input, now });

      const moving = move !== null && now < move.startedAt + move.path.length * move.stepMs;
      const striking = strike !== null && now < strike.startAt + STRIKE_DURATION_MS;
      if (moving || striking || selectedArmyId !== -1) {
        frame = requestAnimationFrame(render);
      }
    };

    render();

    return () => cancelAnimationFrame(frame);
  }, [
    world,
    armies,
    structures,
    visible,
    explored,
    selectedArmyId,
    movement,
    hoveredKey,
    hexSize,
    showGrid,
    showFog,
    showCoords,
    move,
    strike,
  ]);

  /** Pointer position to a tile key, or `""` when it is off the board. */
  const keyAt = useCallback(
    (event: PointerEvent<HTMLCanvasElement>): string => {
      const canvas = canvasRef.current;
      if (!canvas || !world) {
        return "";
      }

      const rect = canvas.getBoundingClientRect();
      const bounds = boardBounds(world, hexSize);
      const cell = pixelToAxial(
        event.clientX - rect.left + bounds.minX,
        event.clientY - rect.top + bounds.minY,
        hexSize
      );
      const key = axialKey(cell.q, cell.r);

      return world.tiles.has(key) ? key : "";
    },
    [world, hexSize]
  );

  if (!world) {
    return (
      <div className="map-canvas map-canvas--empty">
        {"Остров ещё не создан."}
      </div>
    );
  }

  return (
    <div className={`map-canvas${phase === "enemy" ? " map-canvas--waiting" : ""}`}>
      <canvas
        ref={canvasRef}
        onPointerMove={(event) => registry.hoverTileAction(keyAt(event))}
        onPointerLeave={() => registry.hoverTileAction("")}
        onPointerDown={(event) => registry.clickTileAction(keyAt(event))}
      />
    </div>
  );
};

export { MapCanvas };
