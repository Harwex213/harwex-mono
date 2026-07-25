import { Application } from "pixi.js";
import type { CreateView, ViewDeps } from "@hw/colony-sim-v1-core";
import { GameRenderer } from "./renderer";
import { loadTextures } from "./textures";

const BACKGROUND = "#12160f";

// Everything pixi, in one handle: the Application, the preloaded sheets, the
// canvas in the page, and the frame source the engine is driven from. Apps get a
// loop without importing pixi themselves, so which renderer draws the game stays a
// decision of this package alone.
interface GameStage {
  // Hand this to the engine: it decides when the view is built, and with what.
  createView: CreateView;
  // The pixi ticker, reduced to elapsed real milliseconds — pause and speed are
  // the engine's business, not the clock's.
  onFrame(callback: (deltaMs: number) => void): void;
  destroy(): void;
}

async function createGameStage(mount: HTMLElement = document.body): Promise<GameStage> {
  const app = new Application();
  await app.init({
    background: BACKGROUND,
    resizeTo: window,
    antialias: false,
    // Our own shaders are GLSL only, so the backend is pinned rather than
    // auto-detected — a WebGPU context would silently drop them.
    preference: "webgl",
  });
  // Before any view exists: reconcile() creates sprites synchronously on frame one
  // and cannot await a texture.
  await loadTextures();
  mount.appendChild(app.canvas);

  return {
    createView: (deps: ViewDeps) => new GameRenderer(app, deps.world, deps.commands, deps.pointer),
    onFrame: (callback: (deltaMs: number) => void) => {
      app.ticker.add((ticker) => callback(ticker.deltaMS));
    },
    destroy: () => {
      app.destroy(true, { children: true });
    },
  };
}

export type { GameStage };
export { createGameStage };
