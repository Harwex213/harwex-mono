import { effect } from "@preact/signals";
import { createRng, type Rng } from "./sim/rng";
import { runSystems } from "./sim/systems";
import { inBounds } from "./sim/grid";
import { pickEntity } from "./sim/picking";
import type { Position } from "./sim/components";
import type { World } from "./sim/world";
import { saveSnapshot } from "./persistence/snapshot";
import type { ColonyDb } from "./persistence/db";
import {
  colonistCount,
  colonistRoster,
  colonistsOpen,
  paused,
  resources,
  selection,
  type Selection,
  selectionDetails,
  speed,
} from "./state/signals";
import { describeSelection, listColonists } from "./state/inspect";
import { type Command, CommandDispatcher, type Dispatcher } from "./commands";
import type { CreateView, GameView } from "./view";

const TICK_MS = 100; // 10 logical ticks per second
const AUTOSAVE_MS = 10000;

interface GameEngineOptions {
  world: World;
  // The view is built here rather than handed over ready-made: it needs the
  // dispatcher and the pointer handlers, and those are the engine's to give out.
  createView: CreateView;
  // Optional on purpose — the dev app runs the very same engine with no
  // persistence at all, which is also what keeps stale saves out of its loop.
  db?: ColonyDb | null;
}

// Owns the world, the fixed-timestep loop, the view and persistence. The HUD gets
// a reference through context and talks to it only through dispatch().
class GameEngine implements Dispatcher {
  private commands = new CommandDispatcher();
  private db: ColonyDb | null;
  private world: World;
  private rng: Rng;
  private view: GameView;
  private accumulator = 0;
  private autosaveTimer = 0;
  // Last cursor position in tile coords, kept as-is rather than resolved on the
  // spot: the cursor can sit still while an animal walks under it, so what is
  // hovered is re-picked every frame.
  private hoverTile: Position | null = null;

  constructor(options: GameEngineOptions) {
    this.world = options.world;
    this.db = options.db ?? null;
    this.rng = createRng(this.world.seed ^ (this.world.tick * 0x9e3779b1));
    this.view = options.createView({
      world: this.world,
      commands: this.commands,
      pointer: { pick: this.selectAt, hover: this.hoverAt },
    });
    colonistCount.value = this.world.needs.size;
    this.refreshResources();
    // Selection details are refreshed every tick for live needs, plus on every
    // selection change — a paused game runs no ticks but still repaints the panel.
    effect(() => this.refreshSelection());
    // Same for the roster: opening its panel must fill it immediately, without
    // waiting for the next tick (or forever, if the game is paused).
    effect(() => this.refreshColonists());
  }

  // Only persistence needs the page lifecycle, so without a db there is nothing
  // to hook: the loop itself is driven from the outside by frame().
  start(): void {
    if (!this.db) {
      return;
    }
    globalThis.addEventListener("visibilitychange", this.onVisibilityChange);
    globalThis.addEventListener("beforeunload", this.onBeforeUnload);
  }

  stop(): void {
    globalThis.removeEventListener("visibilitychange", this.onVisibilityChange);
    globalThis.removeEventListener("beforeunload", this.onBeforeUnload);
  }

  // One rendered frame, driven by the host's clock (the pixi ticker) rather than
  // by a ticker of the engine's own: core must not know what draws it. Real time
  // in, so pause and speed stay a multiplier on the accumulator — the view keeps
  // getting every frame either way.
  frame(deltaMs: number): void {
    this.accumulator += deltaMs * (paused.value ? 0 : speed.value);
    while (this.accumulator >= TICK_MS) {
      this.step();
      this.accumulator -= TICK_MS;
    }
    const alpha = this.accumulator / TICK_MS;
    this.view.setHover(this.targetAt(this.hoverTile));
    this.view.render(this.world, alpha);

    this.autosaveTimer += deltaMs;
    if (this.autosaveTimer >= AUTOSAVE_MS) {
      this.autosaveTimer = 0;
      void this.save();
    }
  }

  // The HUD's only entry point into the engine; the camera holds the same
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

  private step(): void {
    // Snapshot positions so the view can interpolate this tick → next.
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

  private async save(): Promise<void> {
    if (!this.db) {
      return;
    }
    await saveSnapshot(this.db, this.world);
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

export type { GameEngineOptions };
export { GameEngine, TICK_MS };
