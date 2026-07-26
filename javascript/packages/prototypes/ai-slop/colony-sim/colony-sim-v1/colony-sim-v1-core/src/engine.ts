import { effect } from "@preact/signals";
import { type Rng, stateRng } from "./sim/rng";
import { runSystems } from "./sim/systems";
import { inBounds } from "./sim/grid";
import { pickEntity } from "./sim/picking";
import type { EntityId, PlayerId, Position } from "./sim/components";
import { DEFAULT_PLAYER } from "./data/defs";
import {
  buildAt,
  destroyObject,
  randomFreeTile,
  spawnChicken,
  spawnColonist,
  spawnItem,
  spawnRock,
  spawnTree,
  type World,
} from "./sim/world";
import { saveSnapshot } from "./persistence/snapshot";
import type { ColonyDb } from "./persistence/db";
import {
  buildOrder,
  colonistCount,
  colonistRoster,
  colonistsOpen,
  resources,
  selection,
  type Selection,
  selectionDetails,
} from "./state/signals";
import { countColonists, countStock, describeSelection, listColonists } from "./state/inspect";
import { type Command, CommandDispatcher, type Dispatcher, type SpawnKind, type WorldCommand } from "./commands";
import { LocalTurnSource, type TurnSource } from "./turns";
import type { CreateView, GameView } from "./view";

const AUTOSAVE_MS = 10000;

// How big a hand-spawned resource pile is. Destruction drops come from the
// object's def instead (see destroyObject) — this is only the size of a stack
// conjured out of nothing.
const SPAWNED_STACK = 5;

// The one place a spawn command's kind is turned into a spawner. A command names
// what to create; how it is created stays in the sim. Every spawner is handed the
// owner even though only a colonist has one — the alternative is two kinds of
// spawner and a table that says which is which.
const SPAWNERS: Record<SpawnKind, (world: World, pos: Position, owner: PlayerId) => EntityId> = {
  colonist: spawnColonist,
  tree: spawnTree,
  rock: spawnRock,
  chicken: spawnChicken,
  wood: (world, pos) => spawnItem(world, pos, "wood", SPAWNED_STACK),
  stone: (world, pos) => spawnItem(world, pos, "stone", SPAWNED_STACK),
  food: (world, pos) => spawnItem(world, pos, "food", SPAWNED_STACK),
};

interface GameEngineOptions {
  world: World;
  // The view is built here rather than handed over ready-made: it needs the
  // dispatcher and the pointer handlers, and those are the engine's to give out.
  createView: CreateView;
  // Optional on purpose — the dev app runs the very same engine with no
  // persistence at all, which is also what keeps stale saves out of its loop.
  db?: ColonyDb | null;
  // Whose client this is. Not world state: every client builds the same world from
  // the same seed and differs only in who is looking at it, so a snapshot must not
  // carry a seat. It is what the read models are filtered by (the HUD speaks for one
  // colony) and what an ownerless spawn command belongs to.
  player?: PlayerId;
  // Who says when a tick happens. Left out, the clock is local and the game is a
  // single-player one; a networked game passes the turn stream instead. The engine
  // never learns which it got — see turns.ts.
  turns?: TurnSource;
}

// Owns the world, the fixed-timestep loop, the view and persistence. The HUD gets
// a reference through context and talks to it only through dispatch().
class GameEngine implements Dispatcher {
  private turns: TurnSource;
  private commands: CommandDispatcher;
  private db: ColonyDb | null;
  private world: World;
  private player: PlayerId;
  private rng: Rng;
  private view: GameView;
  private autosaveTimer = 0;
  // Last cursor position in tile coords, kept as-is rather than resolved on the
  // spot: the cursor can sit still while an animal walks under it, so what is
  // hovered is re-picked every frame.
  private hoverTile: Position | null = null;

  constructor(options: GameEngineOptions) {
    this.world = options.world;
    this.db = options.db ?? null;
    this.player = options.player ?? DEFAULT_PLAYER;
    this.turns = options.turns ?? new LocalTurnSource();
    this.commands = new CommandDispatcher(this.turns);
    // The stream's position is the world's, not this object's: an engine built for a
    // world in progress has to draw the numbers that world would have drawn next, or
    // a reload — and every client that started its engine a second later than another
    // — is a different game from here on.
    this.rng = stateRng(this.world);
    this.view = options.createView({
      world: this.world,
      commands: this.commands,
      pointer: { pick: this.selectAt, hover: this.hoverAt },
      player: this.player,
    });
    this.refreshColonistCount();
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
  // by a ticker of the engine's own: core must not know what draws it. Real time in,
  // and out of it the turn source says how much of that time the *sim* is allowed to
  // spend — none while paused, one tick per turn over a network. The view keeps
  // getting every frame either way.
  frame(deltaMs: number): void {
    for (const step of this.turns.pump(deltaMs)) {
      this.applyWorldCommands(step.commands);
      if (step.advance) {
        this.step();
      }
    }
    this.view.setHover(this.targetAt(this.hoverTile));
    this.view.render(this.world, this.turns.alpha());

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

  // World commands land here, between ticks — never inside one, where half the
  // systems would have run against the old world. Which orders arrive together, and on
  // which tick, is the clock's answer: locally the next tick (or none at all, on a
  // paused world, so a spawn still lands), over a network the turn every client
  // applies at this same tick.
  private applyWorldCommands(pending: readonly WorldCommand[]): void {
    if (pending.length === 0) {
      return;
    }
    for (const command of pending) {
      if (command.type === "destroy") {
        // Not a destructible object → nothing happens. The sim owns that rule:
        // a caller holding an entity id has no business knowing which ids drop
        // loot and which are colonists.
        destroyObject(this.world, command.id);
        continue;
      }
      if (command.type === "build") {
        // A tile that cannot take the building drops the command: the ghost already
        // said so, and there is no second-best tile worth guessing at.
        buildAt(this.world, command.order, command.tile, command.owner ?? this.player);
        continue;
      }
      // No tile given → the sim finds one; a full map yields nothing and the
      // command is dropped rather than stacking entities on an occupied tile.
      const tile = command.tile ?? randomFreeTile(this.world, this.rng);
      if (!tile) {
        continue;
      }
      SPAWNERS[command.kind](this.world, tile, command.owner ?? this.player);
    }
    // A paused game runs no tick to rebuild the read models, and what a command
    // just put into (or took out of) the world must not wait for one: the entity a
    // destroy removed cannot linger in the inspector, a spawned colonist has to
    // show up in the headcount and in an open roster right away, and a demolished
    // warehouse takes its contents out of the readout with it.
    this.refreshSelection();
    this.refreshColonistCount();
    this.refreshColonists();
    this.refreshResources();
  }

  // Canvas click → selection, or a building where the build cursor is armed. What a
  // click means is the engine's call: the view reports the tile it hit and nothing
  // else, and picking needs the World anyway.
  private selectAt = (tile: Position): void => {
    const order = buildOrder.value;
    if (order) {
      // Owner stays null: whose building it is follows from whose client this is,
      // and the menu that sent this has no business naming a player.
      this.commands.dispatch({ type: "build", order, tile, owner: null });
      return;
    }
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
    // With the build cursor armed the click lands on the tile, so the tile is what
    // the hover has to point at too — the ghost is drawn on it, and whatever stands
    // there is an obstacle rather than a target.
    if (buildOrder.value) {
      return { kind: "tile", x, y };
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
    colonistRoster.value = colonistsOpen.value ? listColonists(this.world, this.player) : [];
  }

  // Headcount read model. A number compares by value, so the signal itself drops
  // the writes that would repaint the bar with the number already on it.
  private refreshColonistCount(): void {
    colonistCount.value = countColonists(this.world, this.player);
  }

  // Stock read model, summed out of the viewer's stores. Signals compare by identity,
  // so handing over a fresh object every tick would repaint the resources panel ten
  // times a second for nothing.
  private refreshResources(): void {
    const stock = countStock(this.world, this.player);
    const shown = resources.value;
    if (shown.wood === stock.wood && shown.stone === stock.stone && shown.food === stock.food) {
      return;
    }
    resources.value = stock;
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

    this.refreshColonistCount();
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
export { GameEngine };
