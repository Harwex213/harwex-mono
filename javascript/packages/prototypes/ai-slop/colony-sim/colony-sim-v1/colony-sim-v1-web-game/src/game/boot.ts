import { render } from "preact";
import { GameEngine, loadSnapshot, newGame, openColonyDb } from "@hw/colony-sim-v1-core";
import { createGameStage } from "@hw/colony-sim-v1-game-render";
import { mountHud } from "@hw/colony-sim-v1-hud";

// The shipped game, unchanged in substance: DB → load|newGame → pixi stage → engine
// (owns the loop) → HUD over the canvas. What routing added is an end: the boot now
// hands back a handle, because leaving the playing route has to stop the ticker and
// tear down the canvas instead of leaving a second one behind.
interface GameSession {
  destroy(): void;
}

async function bootGame(mount: HTMLElement, seed: number): Promise<GameSession> {
  const db = await openColonyDb();
  const saved = await loadSnapshot(db);
  // There is one autosave slot for the whole app, so a snapshot belongs to this game
  // only when the seeds agree — otherwise opening a second game would resume the
  // first one's colony under the second one's name. Per-game slots are a core
  // concern (the key is core's), and this check is what holds until they exist.
  const world = saved && saved.seed === seed ? saved : newGame(seed);

  const stage = await createGameStage(mount);
  const engine = new GameEngine({ world, db, createView: stage.createView });
  // The stage owns the clock, the engine owns what a frame means.
  stage.onFrame((deltaMs) => engine.frame(deltaMs));
  engine.start();

  // The HUD needs a container of its own: it renders a Preact tree into whatever it
  // is given, and the shell's tree already lives in #app.
  const hudRoot = document.createElement("div");
  mount.appendChild(hudRoot);
  mountHud(engine, hudRoot);

  return {
    destroy: () => {
      engine.stop();
      render(null, hudRoot);
      hudRoot.remove();
      stage.destroy();
    },
  };
}

export type { GameSession };
export { bootGame };
