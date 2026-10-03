import { useCallback, useEffect, useRef } from "react";
import { ARENA_HEIGHT, ARENA_WIDTH } from "../../domain/arena/hex";
import { archetypeOf } from "../../domain/battle/archetypes";
import { drawArena } from "../render/arena-renderer";
import { useStore } from "../../store/store";
import type { FC, PointerEvent } from "react";
import type {
  TAdvanceBattleAction,
  TBeginDragAction,
  TDragToAction,
  TEndDragAction,
  THoverUnitAction,
  TSelectUnitAction,
} from "../../domain/registry";
import type { TArchetypeId } from "../../domain/battle/archetypes";
import type { TTeam } from "../../domain/battle/types";

type TArenaCanvasRegistrySlice = {
  advanceBattleAction: TAdvanceBattleAction;
  beginDragAction: TBeginDragAction;
  dragToAction: TDragToAction;
  endDragAction: TEndDragAction;
  hoverUnitAction: THoverUnitAction;
  selectUnitAction: TSelectUnitAction;
};

type TArenaCanvasProps = {
  registry: TArenaCanvasRegistrySlice;
};

/** Anything on the field can be pointed at, whether it fights or waits. */
type TPickable = {
  id: string;
  team: TTeam;
  archetypeId: TArchetypeId;
  x: number;
  y: number;
};

const ArenaCanvas: FC<TArenaCanvasProps> = ({ registry }) => {
  const store = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const frame = canvas.parentElement;
    if (!frame) {
      return;
    }

    // The frame is measured, never the canvas itself: sizing the canvas from
    // its own box would feed its new size straight back into the observer.
    // One transform then absorbs both the CSS size and the device pixel ratio,
    // so the rest of the renderer only ever speaks in world units.
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const fit = Math.min(frame.clientWidth / ARENA_WIDTH, frame.clientHeight / ARENA_HEIGHT);
      const cssWidth = Math.max(240, Math.floor(ARENA_WIDTH * fit));
      const cssHeight = Math.max(216, Math.floor(ARENA_HEIGHT * fit));

      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(frame);
    resize();

    let animation = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;

      registry.advanceBattleAction(dt);

      const scale = canvas.width / ARENA_WIDTH;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      drawArena(ctx, {
        phase: store.metaState.phase.peek(),
        playerUnits: store.rosterState.player.peek(),
        enemyUnits: store.rosterState.enemy.peek(),
        sim: store.battleState.sim.peek(),
        selectedId: store.rosterState.selectedId.peek(),
        hoveredId: store.viewState.hoveredId.peek(),
        draggingId: store.viewState.draggingId.peek(),
        dragValid: store.viewState.dragValid.peek(),
        clock: now / 1000,
      });

      animation = window.requestAnimationFrame(loop);
    };

    animation = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(animation);
      observer.disconnect();
    };
  }, [registry, store]);

  const worldAt = useCallback((event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }

    const bounds = canvas.getBoundingClientRect();
    const scale = ARENA_WIDTH / bounds.width;

    return {
      x: (event.clientX - bounds.left) * scale,
      y: (event.clientY - bounds.top) * scale,
    };
  }, []);

  const unitAt = useCallback(
    (x: number, y: number): TPickable | null => {
      const sim = store.battleState.sim.peek();
      const candidates: TPickable[] = sim
        ? sim.fighters.filter((fighter) => !fighter.dead)
        : [...store.rosterState.player.peek(), ...store.rosterState.enemy.peek()];

      let best: TPickable | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (const unit of candidates) {
        const distance = Math.hypot(unit.x - x, unit.y - y);
        if (distance > archetypeOf(unit.archetypeId).radius + 6) {
          continue;
        }

        if (distance < bestDistance) {
          bestDistance = distance;
          best = unit;
        }
      }

      return best;
    },
    [store]
  );

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = worldAt(event);
    const unit = unitAt(point.x, point.y);

    registry.selectUnitAction(unit === null ? null : unit.id);

    if (!unit || unit.team !== "player") {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    registry.beginDragAction(unit.id);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = worldAt(event);

    if (store.viewState.draggingId.peek() !== null) {
      registry.dragToAction(point.x, point.y);

      return;
    }

    const unit = unitAt(point.x, point.y);
    registry.hoverUnitAction(unit === null ? null : unit.id);
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    registry.endDragAction();
  };

  const handlePointerLeave = () => {
    registry.hoverUnitAction(null);
  };

  return (
    <canvas
      ref={canvasRef}
      className="arena"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    />
  );
};

export { ArenaCanvas };
