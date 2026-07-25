import "./styles/reset.css";
import { GameEngine, loadSnapshot, newGame, openColonyDb } from "@hw/colony-sim-v1-core";
import { createGameStage } from "@hw/colony-sim-v1-game-render";
import { mountHud } from "@hw/colony-sim-v1-hud";

// The shipped game: DB → load|newGame → pixi stage → engine (owns the loop) → HUD
// over the canvas. This is the build with persistence, and the one that will grow
// navigation and a backend connection around this boot.
async function boot(): Promise<void> {
  const db = await openColonyDb();
  const world = (await loadSnapshot(db)) ?? newGame(Date.now() >>> 0);

  const stage = await createGameStage();
  const engine = new GameEngine({ world, db, createView: stage.createView });
  // The stage owns the clock, the engine owns what a frame means.
  stage.onFrame((deltaMs) => engine.frame(deltaMs));
  engine.start();

  const mount = document.getElementById("app");
  if (!mount) {
    throw new Error("#app mount point missing");
  }
  mountHud(engine, mount);
}

void boot();
