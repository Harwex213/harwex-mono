import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import { drainEvents, summarizeCleanup, TICK_SECONDS } from "../../../core/cleanup-sim";
import { useStore } from "../../../store/store";
import { absorbEvents, drawScene, pruneEffects } from "./cleanup-render";
import { bakeIsland, releaseSprite } from "./island-sprites";
import { createSkyRenderer } from "./sky-gl";
import type { FC } from "react";
import type { TCleanupSim } from "../../../core/cleanup-sim";
import type {
  TSetCleanupInputAction,
  TSetCleanupSpeedAction,
  TStepCleanupAction,
  TToggleCleanupPauseAction,
} from "../../../domain/registry";
import type { TCamera, TScene } from "./cleanup-render";

/** WASD and the arrows both steer the island. */
const KEY_DIRECTIONS: Readonly<Record<string, readonly [number, number]>> = {
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.8;
const ZOOM_STEP = 1.12;
/** The view shows about this many world units across its short side. */
const DEFAULT_VIEW_SPAN = 1250;
/** How fast the camera catches up with the island and with the wheel, per second. */
const CAMERA_FOLLOW = 4.5;
const ZOOM_FOLLOW = 8;
/** The camera looks ahead of a moving island by this many seconds of travel. */
const LOOK_AHEAD = 0.45;
/** A frame longer than this was a stall; the sim does not try to catch up. */
const MAX_FRAME_SECONDS = 0.25;
const MAX_TICKS_PER_FRAME = 8;
/** The scene draws at most 1.5 device pixels per CSS pixel: the paper look hides the rest. */
const MAX_PIXEL_RATIO = 1.5;

type TCleanupCanvasRegistrySlice = {
  setCleanupInputAction: TSetCleanupInputAction;
  stepCleanupAction: TStepCleanupAction;
  setCleanupSpeedAction: TSetCleanupSpeedAction;
  toggleCleanupPauseAction: TToggleCleanupPauseAction;
};

type TCleanupCanvasProps = {
  registry: TCleanupCanvasRegistrySlice;
};

/** A test handle: `window.__ostrovCleanup.step(300)` runs 300 ticks at once. */
type TCleanupDevHook = {
  readonly step: (ticks: number) => void;
  readonly steer: (x: number, y: number) => void;
  readonly snapshot: () => unknown;
  readonly sim: () => TCleanupSim | null;
};

declare global {
  interface Window {
    __ostrovCleanup?: TCleanupDevHook;
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A sky layer, or `null` without WebGL2 or when a shader fails: the scene still plays. */
const createSky = (canvas: HTMLCanvasElement | null, mode: "under" | "over", seed: number) => {
  if (!canvas) {
    return null;
  }

  try {
    return createSkyRenderer(canvas, mode, seed);
  } catch (error: unknown) {
    console.error(error);

    return null;
  }
};

const playerCenter = (sim: TCleanupSim) => {
  const island = sim.islands[0];
  if (!island) {
    return { x: 0, y: 0, vx: 0, vy: 0 };
  }

  return {
    x: island.body.x + island.body.centerX,
    y: island.body.y + island.body.centerY,
    vx: island.body.vx,
    vy: island.body.vy,
  };
};

/**
 * The cleanup scene. It owns the frame loop: the sim ticks at a fixed 30 Hz
 * from an accumulator, and every frame draws between the last two ticks. The
 * loop stops while the tab is hidden, and a long stall is not caught up.
 */
const CleanupCanvas: FC<TCleanupCanvasProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const sim = store.battle.sim.value;
  const stageRef = useRef<HTMLDivElement>(null);
  const skyRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const veilRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!stage || !canvas || !context || !sim) {
      return;
    }

    let cancelled = false;
    const scene: TScene = {
      sprites: sim.islands.map(() => null),
      effects: [],
      hatch: null,
    };
    // Without WebGL2 the sky is the plain slate of the stage's CSS background.
    const sky = createSky(skyRef.current, "under", sim.seed);
    const veil = createSky(veilRef.current, "over", sim.seed + 1);
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const clockStart = performance.now();
    const playerId = store.derived.humanPlayer.peek()?.id ?? "human";

    sim.islands.forEach((island) => {
      const seedKey = island.side === "player" ? playerId : `${sim.seed}:${island.id}`;
      bakeIsland(island.hexes, island.side, seedKey)
        .then((sprite) => {
          if (cancelled) {
            releaseSprite(sprite);

            return;
          }

          scene.sprites[island.index] = sprite;
        })
        .catch((error: unknown) => {
          console.error(error);
        });
    });

    const start = playerCenter(sim);
    const baseZoom = () => clamp(Math.min(canvas.clientWidth, canvas.clientHeight) / DEFAULT_VIEW_SPAN, MIN_ZOOM, MAX_ZOOM);
    const camera: TCamera = { x: start.x, y: start.y, zoom: baseZoom() };
    let zoomTarget = camera.zoom;

    const pressed = new Set<string>();
    const pushInput = () => {
      let x = 0;
      let y = 0;
      for (const code of pressed) {
        const direction = KEY_DIRECTIONS[code];
        if (direction) {
          x += direction[0];
          y += direction[1];
        }
      }

      registry.setCleanupInputAction(clamp(x, -1, 1), clamp(y, -1, 1));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (KEY_DIRECTIONS[event.code]) {
        event.preventDefault();
        if (!pressed.has(event.code)) {
          pressed.add(event.code);
          pushInput();
        }

        return;
      }

      if (event.code === "Space" && !event.repeat) {
        event.preventDefault();
        registry.toggleCleanupPauseAction();
      } else if (event.code === "Digit1") {
        registry.setCleanupSpeedAction(1);
      } else if (event.code === "Digit2") {
        registry.setCleanupSpeedAction(2);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (pressed.delete(event.code)) {
        pushInput();
      }
    };

    const onBlur = () => {
      pressed.clear();
      pushInput();
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomTarget = clamp(zoomTarget * Math.pow(ZOOM_STEP, -event.deltaY / 100), MIN_ZOOM, MAX_ZOOM);
    };

    let last = performance.now();
    let accumulator = 0;
    let frameHandle = 0;

    const onVisibility = () => {
      // A hidden tab gets no frames. On return the clock restarts, so the
      // time away is not played back.
      last = performance.now();
      if (document.hidden) {
        pressed.clear();
        pushInput();
      }
    };

    const frame = (now: number) => {
      frameHandle = requestAnimationFrame(frame);
      const seconds = Math.min(MAX_FRAME_SECONDS, Math.max(0, (now - last) / 1000));
      last = now;

      const running = sim.status === "running" && !store.battle.paused.peek() && !document.hidden;
      if (running) {
        accumulator += seconds * store.battle.speed.peek();
        const ticks = Math.min(MAX_TICKS_PER_FRAME, Math.floor(accumulator / TICK_SECONDS));
        accumulator -= ticks * TICK_SECONDS;
        accumulator = Math.min(accumulator, TICK_SECONDS);
        if (ticks > 0) {
          registry.stepCleanupAction(ticks);
        }
      }

      const alpha = sim.status === "running" ? clamp(accumulator / TICK_SECONDS, 0, 1) : 1;
      const simTime = sim.tick * TICK_SECONDS;
      absorbEvents(scene, sim, drainEvents(sim), simTime);
      pruneEffects(scene, simTime);

      const target = playerCenter(sim);
      const follow = 1 - Math.exp(-CAMERA_FOLLOW * seconds);
      camera.x += (target.x + target.vx * LOOK_AHEAD - camera.x) * follow;
      camera.y += (target.y + target.vy * LOOK_AHEAD - camera.y) * follow;
      camera.zoom += (zoomTarget - camera.zoom) * (1 - Math.exp(-ZOOM_FOLLOW * seconds));

      const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }

      const motion = !motionQuery.matches;
      const clock = (now - clockStart) / 1000;
      const player = sim.islands[0];
      const skyFrame = {
        width,
        height,
        ratio,
        cameraX: camera.x,
        cameraY: camera.y,
        zoom: camera.zoom,
        time: motion ? clock : 0,
        focusX: width / 2 + ((player ? player.body.x + player.body.centerX : 0) - camera.x) * camera.zoom,
        focusY: height / 2 + ((player ? player.body.y + player.body.centerY : 0) - camera.y) * camera.zoom,
        focusRadius: ((player?.body.radius ?? 300) + 80) * camera.zoom,
      };

      sky?.render(skyFrame);
      drawScene(context, sim, scene, { width, height, ratio, alpha, camera, clock, motion });
      veil?.render(skyFrame);
    };

    frameHandle = requestAnimationFrame(frame);

    window.__ostrovCleanup = {
      step: (ticks) => registry.stepCleanupAction(ticks),
      steer: (x, y) => registry.setCleanupInputAction(x, y),
      snapshot: () => ({
        tick: sim.tick,
        status: sim.status,
        player: playerCenter(sim),
        bridges: sim.bridgeLinks.reduce((sum, links) => sum + links.length, 0) / 2,
        islands: sim.islands.map((island) => ({
          id: island.id,
          state: island.state,
          x: Math.round(island.body.x + island.body.centerX),
          y: Math.round(island.body.y + island.body.centerY),
        })),
        hud: summarizeCleanup(sim),
      }),
      sim: () => store.battle.sim.peek(),
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    stage.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameHandle);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      stage.removeEventListener("wheel", onWheel);
      sky?.dispose();
      veil?.dispose();
      registry.setCleanupInputAction(0, 0);
      delete window.__ostrovCleanup;

      for (const sprite of scene.sprites) {
        if (sprite) {
          releaseSprite(sprite);
        }
      }
    };
  }, [sim, registry, store]);

  return (
    <div className="cleanup-stage" ref={stageRef}>
      <canvas className="cleanup-stage__layer" ref={skyRef} />
      <canvas className="cleanup-stage__layer" ref={canvasRef} />
      <canvas className="cleanup-stage__layer cleanup-stage__layer--veil" ref={veilRef} />
    </div>
  );
};

export { CleanupCanvas };
