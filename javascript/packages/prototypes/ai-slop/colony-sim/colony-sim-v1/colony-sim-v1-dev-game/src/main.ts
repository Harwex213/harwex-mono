import "./styles/reset.css";
import {
  DEFAULT_MAP_GEN,
  DEFAULT_PLAYER,
  GameEngine,
  MAP_GENERATORS,
  type MapGenId,
  newGame,
  type World,
} from "@hw/colony-sim-v1-core";
import { createGameStage } from "@hw/colony-sim-v1-game-render";
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

// Dev boot: the same core, the same renderer, the same HUD — minus IndexedDB. The
// autosave is what makes iteration here slow and confusing: it outlives an edit to
// the world's shape and then hands the systems yesterday's data, and with HMR
// reloading constantly that is the normal case rather than the rare one. So the dev
// app always starts from a freshly generated world, and `?seed=N` / `?map=ID` is
// how you leave the defaults.
//
// One colony, not one per player: what is being watched here is a single crew's
// behaviour, and a second crew only adds colonists that move on their own in the
// middle of it. The map is still generated for all of them, so a seed draws the
// same terrain as in the shipped game.
async function boot(): Promise<void> {
  const world = newGame(seedFromUrl(), mapGenFromUrl(), [DEFAULT_PLAYER]);

  const stage = await createGameStage();
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
