import type { Application, Ticker } from "pixi.js";
import { effect } from "@preact/signals";
import { createRng, type Rng } from "@/sim/rng";
import { runSystems } from "@/sim/systems";
import { inBounds } from "@/sim/grid";
import { pickEntity } from "@/sim/picking";
import type { Position } from "@/sim/components";
import type { World } from "@/sim/world";
import { GameRenderer } from "@/render/renderer";
import { saveSnapshot } from "@/persistence/snapshot";
import type { ColonyDb } from "@/persistence/db";
import {
  colonistCount,
  resources,
  paused,
  speed,
  selection,
  selectionDetails,
  colonistsOpen,
  colonistRoster,
  type Selection,
} from "@/ui/signals";
import { describeSelection, listColonists } from "@/ui/inspect";
import { CommandDispatcher, type Command } from "@/commands";

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
  // Last cursor position in tile coords, kept as-is rather than resolved on the
  // spot: the cursor can sit still while an animal walks under it, so what is
  // hovered is re-picked every frame.
  private hoverTile: Position | null = null;

  constructor(world: World, app: Application, db: ColonyDb) {
    this.world = world;
    this.app = app;
    this.db = db;
    this.rng = createRng(world.seed ^ (world.tick * 0x9e3779b1));
    this.renderer = new GameRenderer(app, world, this.commands, { pick: this.selectAt, hover: this.hoverAt });
    colonistCount.value = world.needs.size;
    this.refreshResources();
    // Selection details are refreshed every tick for live needs, plus on every
    // selection change — a paused game runs no ticks but still repaints the panel.
    effect(() => this.refreshSelection());
    // Same for the roster: opening its panel must fill it immediately, without
    // waiting for the next tick (or forever, if the game is paused).
    effect(() => this.refreshColonists());
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

  // Canvas click → selection. Picking needs the World, so it lives here rather
  // than in the view; the camera only reports which tile was hit.
  private selectAt = (tile: Position): void => {
    this.commands.dispatch({ type: "select", selection: this.targetAt(tile) });
  };

  // Cursor moved. Only the position is stored — see `hoverTile`.
  private hoverAt = (tile: Position | null): void => {
    this.hoverTile = tile;
  };

  // What a click at this point would take. Ground is a valid target, so a point
  // over nothing still resolves to the tile under it; off-world resolves to
  // nothing, which as a click clears the selection.
  private targetAt(tile: Position | null): Selection | null {
    if (!tile) {
      return null;
    }
    const x = Math.floor(tile.x);
    const y = Math.floor(tile.y);
    if (!inBounds(this.world.grid, x, y)) {
      return null;
    }
    const id = pickEntity(this.world, tile.x, tile.y);
    return id === null ? { kind: "tile", x, y } : { kind: "entity", id };
  }

  // Read model for the HUD panel. Also drops a selection whose entity is gone,
  // so nothing keeps pointing at a despawned colonist.
  private refreshSelection(): void {
    const selected = selection.value;
    if (selected && selected.kind === "entity" && !this.world.entities.has(selected.id)) {
      selection.value = null;
      return;
    }
    selectionDetails.value = describeSelection(this.world, selected);
  }

  // Roster read model. A per-entity list in a signal is only affordable because
  // it is rebuilt while its panel is open and never otherwise.
  private refreshColonists(): void {
    colonistRoster.value = colonistsOpen.value ? listColonists(this.world) : [];
  }

  // Stock read model. Signals compare by identity, so handing over a fresh object
  // every tick would repaint the resources panel ten times a second for nothing.
  private refreshResources(): void {
    const stock = this.world.stock;
    const shown = resources.value;
    if (shown.wood === stock.wood && shown.stone === stock.stone && shown.food === stock.food) {
      return;
    }
    resources.value = { ...stock };
  }

  private onFrame = (ticker: Ticker): void => {
    const dt = ticker.deltaMS * (paused.value ? 0 : speed.value);
    this.accumulator += dt;
    while (this.accumulator >= TICK_MS) {
      this.step();
      this.accumulator -= TICK_MS;
    }
    const alpha = this.accumulator / TICK_MS;
    this.renderer.setHover(this.targetAt(this.hoverTile));
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

    colonistCount.value = this.world.needs.size;
    this.refreshResources();
    this.refreshSelection();
    if (colonistsOpen.value) {
      this.refreshColonists();
    }
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
