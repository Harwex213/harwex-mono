import { render } from "preact";
import { Application } from "pixi.js";
import "@/styles/reset.css";
import { openColonyDb } from "@/persistence/db";
import { loadSnapshot } from "@/persistence/snapshot";
import { newGame } from "@/sim/world";
import { GameEngine } from "@/engine";
import { loadTextures } from "@/render/textures";
import { EngineProvider } from "@/ui/engine-context";
import { App } from "@/ui/App";

// Bootstrap: DB → load|newGame → pixi App → GameEngine (owns the loop) → mount
// the React HUD on top of the canvas.
async function boot(): Promise<void> {
  const db = await openColonyDb();
  let world = await loadSnapshot(db);
  if (!world) {
    world = newGame(Date.now() >>> 0);
  }

  const app = new Application();
  await app.init({
    background: "#12160f",
    resizeTo: window,
    antialias: false,
    // Our own shaders are GLSL only, so the backend is pinned rather than
    // auto-detected — a WebGPU context would silently drop them.
    preference: "webgl",
  });
  // Before the engine: the renderer creates sprites synchronously on frame one.
  await loadTextures();
  document.body.appendChild(app.canvas);

  const engine = new GameEngine(world, app, db);
  engine.start();

  const mount = document.getElementById("app");
  if (!mount) {
    throw new Error("#app mount point missing");
  }
  render(
    <EngineProvider value={engine}>
      <App />
    </EngineProvider>,
    mount,
  );
}

void boot();
