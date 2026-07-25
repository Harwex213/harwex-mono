import type { Application, Ticker } from "pixi.js";
import { createRng, type Rng } from "./sim/rng";
import { runSystems } from "./sim/systems";
import type { World } from "./sim/world";
import { GameRenderer } from "./render/renderer";
import { saveSnapshot } from "./persistence/snapshot";
import type { ColonyDb } from "./persistence/db";
import { colonistCount, gameTick, paused, speed, storedWood } from "./ui/signals";
import { type Command, CommandDispatcher } from "./commands";

const TICK_MS = 100; // 10 logical ticks per second
const AUTOSAVE_MS = 10000;

// Owns the world, the fixed-timestep loop, the renderer and persistence. React
// gets a reference via context and talks to it only through dispatch().
class GameEngine {
  private app: Application;
  private commands = new CommandDispatcher();
  private db: ColonyDb;
  private world: World;
  private rng: Rng;
  private renderer: GameRenderer;
  private accumulator = 0;
  private autosaveTimer = 0;

  constructor(world: World, app: Application, db: ColonyDb) {
    this.world = world;
    this.app = app;
    this.db = db;
    this.rng = createRng(world.seed ^ (world.tick * 0x9e3779b1));
    this.renderer = new GameRenderer(app, world, this.commands);
    colonistCount.value = world.needs.size;
    storedWood.value = world.storedWood;
    gameTick.value = world.tick;
  }

  start(): void {
    this.app.ticker.add(this.onFrame);
    globalThis.addEventListener("visibilitychange", this.onVisibilityChange);
    globalThis.addEventListener("beforeunload", this.onBeforeUnload);
  }

  // React's only entry point into the engine; the camera holds the same
  // dispatcher for its hotkeys.
  dispatch(command: Command): void {
    this.commands.dispatch(command);
  }

  private onFrame = (ticker: Ticker): void => {
    const dt = ticker.deltaMS * (paused.value ? 0 : speed.value);
    this.accumulator += dt;
    while (this.accumulator >= TICK_MS) {
      this.step();
      this.accumulator -= TICK_MS;
    }
    const alpha = this.accumulator / TICK_MS;
    this.renderer.render(this.world, alpha);

    this.autosaveTimer += ticker.deltaMS;
    if (this.autosaveTimer >= AUTOSAVE_MS) {
      this.autosaveTimer = 0;
      void this.save();
    }
  };

  private step(): void {
    // Snapshot positions so the renderer can interpolate this tick → next.
    for (const [id, pos] of this.world.positions) {
      const prev = this.world.prevPositions.get(id);
      if (prev) {
        prev.x = pos.x;
        prev.y = pos.y;
      } else {
        this.world.prevPositions.set(id, { x: pos.x, y: pos.y });
      }
    }

    runSystems(this.world, { rng: this.rng });
    this.world.tick += 1;

    gameTick.value = this.world.tick;
    colonistCount.value = this.world.needs.size;
    storedWood.value = this.world.storedWood;
  }

  private save(): Promise<void> {
    return saveSnapshot(this.db, this.world);
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      void this.save();
    }
  };

  private onBeforeUnload = (): void => {
    void this.save();
  };
}

export { GameEngine, TICK_MS };
