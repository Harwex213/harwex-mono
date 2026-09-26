import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import { drawBattle } from "./draw-battle";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TBattleInput } from "../../core/exports";
import type { TBattleTickAction } from "../../domain/registry";
import type { TViewport } from "./draw-battle";

/**
 * The clearing level (plan §3.8). React mounts the canvas and nothing else: the
 * frame loop reads the battle straight off the signal, hands the elapsed time to
 * `battleTick`, and paints. The loop and both key listeners are cancelled on
 * unmount, because a forgotten teardown leaves a second loop running (plan §7).
 */

type TBattleCanvasRegistrySlice = {
  battleTick: TBattleTickAction;
};

type TBattleCanvasProps = {
  registry: TBattleCanvasRegistrySlice;
};

type TMutableInput = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
};

/** Which key codes drive which direction. Arrows do the same as WASD. */
const KEY_DIRECTIONS: Readonly<Record<string, keyof TMutableInput>> = {
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
};

const CANVAS_LABEL_RU = "Зачистка";
const DEFAULT_DPR = 1;
const MIN_CANVAS_PX = 1;
const HUD_HINT_RU = "WASD — управление, Отступить — выйти";

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
};

const BattleCanvas: FC<TBattleCanvasProps> = ({ registry }) => {
  const store = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    let frame = 0;
    let lastMs = performance.now();
    let viewport: TViewport = { width: 0, height: 0 };
    const input: TMutableInput = { up: false, down: false, left: false, right: false };

    const measure = (): void => {
      const rect = canvas.getBoundingClientRect();
      viewport = { width: rect.width, height: rect.height };
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

    const paint = (nowMs: number): void => {
      const ctx = canvas.getContext("2d");
      if (ctx === null) {
        return;
      }

      const dpr = window.devicePixelRatio || DEFAULT_DPR;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, viewport.width, viewport.height);

      const battle = store.game.battle.peek();
      if (battle === null) {
        return;
      }

      drawBattle(ctx, { battle, viewport, nowMs });
    };

    /**
     * The loop stops once the level is finished, and the finished frame stays on
     * screen. `stepBattle` is what decides that; nothing here simulates.
     */
    const loop = (nowMs: number): void => {
      const dtMs = nowMs - lastMs;
      lastMs = nowMs;

      const battle = store.game.battle.peek();
      if (battle !== null && battle.finished === false) {
        const snapshot: TBattleInput = {
          up: input.up,
          down: input.down,
          left: input.left,
          right: input.right,
        };
        registry.battleTick(dtMs, snapshot);
      }

      paint(nowMs);

      if (battle !== null && battle.finished === true) {
        return;
      }

      frame = requestAnimationFrame(loop);
    };

    const applyKey = (event: KeyboardEvent, pressed: boolean): void => {
      if (isTypingTarget(event.target)) {
        return;
      }

      const direction = KEY_DIRECTIONS[event.code];
      if (direction === undefined) {
        return;
      }

      event.preventDefault();
      input[direction] = pressed;
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      applyKey(event, true);
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      applyKey(event, false);
    };

    /** A lost focus never sends the matching `keyup`, so the island would fly on forever. */
    const onBlur = (): void => {
      input.up = false;
      input.down = false;
      input.left = false;
      input.right = false;
    };

    measure();
    const observer = new ResizeObserver(() => {
      measure();
      paint(performance.now());
    });
    observer.observe(canvas);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [registry, store]);

  return (
    <canvas
      ref={canvasRef}
      className="battle-canvas"
      aria-label={CANVAS_LABEL_RU}
    />
  );
};

/**
 * The level readout, in DOM rather than on the canvas so the probe can read it.
 * `data-player-x` is the island's world x, rounded: the movement check reads it.
 */
const BattleHud: FC = () => {
  useSignals();

  const store = useStore();
  const battle = store.game.battle.value;

  if (battle === null) {
    return null;
  }

  const playerUnits = battle.units.filter((unit) => unit.side === "player").length;
  const enemyUnits = battle.units.filter((unit) => unit.side === "enemy").length;
  const islandsLeft = battle.enemyIslands.filter((island) => island.absorbed === false).length;

  return (
    <div className="battle-hud" data-player-x={Math.round(battle.playerIsland.x)}>
      <div className="battle-hud__row">
        {`Свои юниты: ${playerUnits}`}
      </div>

      <div className="battle-hud__row">
        {`Враги: ${enemyUnits}`}
      </div>

      <div className="battle-hud__row">
        {`Вражеских островов: ${islandsLeft}`}
      </div>

      <div className="battle-hud__hint">
        {HUD_HINT_RU}
      </div>
    </div>
  );
};

/** The centred end-of-level banner. It only appears once the level is finished. */
const BattleBanner: FC = () => {
  useSignals();

  const store = useStore();
  const battle = store.game.battle.value;
  const retreated = store.ui.battleRetreated.value;

  if (battle === null || battle.finished === false) {
    return null;
  }

  return (
    <div className="battle-banner">
      {retreated ? "Отступление — нажмите Следующий ход" : "Уровень зачищен — нажмите Следующий ход"}
    </div>
  );
};

export type { TBattleCanvasRegistrySlice };

export { BattleBanner, BattleCanvas, BattleHud };
