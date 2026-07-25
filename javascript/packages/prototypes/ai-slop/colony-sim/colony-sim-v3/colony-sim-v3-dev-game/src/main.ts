import "./styles/reset.css";
import {
  DEFAULT_MAP_GEN,
  GameEngine,
  MAP_GENERATORS,
  type MapGenId,
  newGame,
  type World
} from "@hw/colony-sim-v3-core";
import { createGameStage, DEFAULT_RENDER_FLAGS, type RenderFlags } from "@hw/colony-sim-v3-game-render";
import { mountDevHud } from "./hud/mount";

// A fixed seed, so every reload generates the same world and a change to a system
// can be judged against the previous run instead of against fresh terrain.
const DEFAULT_SEED = 1;

function seedFromUrl(): number {
  const raw = new URLSearchParams(globalThis.location.search).get("seed");
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed >>> 0 : DEFAULT_SEED;
}

// Which map generator to run, `?map=<id>`. Comparing two map styles on one seed
// is a dev-loop thing, so the switch lives here and not in the shipped game.
function mapGenFromUrl(): MapGenId {
  const raw = new URLSearchParams(globalThis.location.search).get("map");
  return raw !== null && raw in MAP_GENERATORS ? (raw as MapGenId) : DEFAULT_MAP_GEN;
}

// Optional render passes, `?shadows=0` to turn the shadows off. Same reason `?map`
// lives here and not in the renderer: judging a pass means seeing the frame with
// and without it, which is a dev-loop need, and the shipped game just takes the
// defaults.
function renderFlagsFromUrl(): RenderFlags {
  const raw = new URLSearchParams(globalThis.location.search).get("shadows");
  if (raw === null) {
    return DEFAULT_RENDER_FLAGS;
  }
  return { ...DEFAULT_RENDER_FLAGS, shadows: raw !== "0" };
}

// Dev boot: the same core, the same renderer, the same HUD — minus IndexedDB. The
// autosave is what makes iteration here slow and confusing: it outlives an edit to
// the world's shape and then hands the systems yesterday's data, and with HMR
// reloading constantly that is the normal case rather than the rare one. So the dev
// app always starts from a freshly generated world, and `?seed=N` / `?map=ID` is
// how you leave the defaults.
async function boot(): Promise<void> {
  const world = newGame(seedFromUrl(), mapGenFromUrl());

  const stage = await createGameStage(document.body, renderFlagsFromUrl());
  const engine = new GameEngine({ world, createView: stage.createView });
  stage.onFrame((deltaMs) => engine.frame(deltaMs));
  engine.start();

  const mount = document.getElementById("app");
  if (!mount) {
    throw new Error("#app mount point missing");
  }
  mountDevHud(engine, mount);

  expose({ world, engine });
}

// The live world on the console, for poking at state the HUD does not show yet.
// Read-only by convention; mutating it from here bypasses the command path and the
// tick boundary, so anything found this way belongs back in a command.
function expose(handles: { world: World; engine: GameEngine }): void {
  Object.assign(globalThis, { colony: handles });
}

void boot();
