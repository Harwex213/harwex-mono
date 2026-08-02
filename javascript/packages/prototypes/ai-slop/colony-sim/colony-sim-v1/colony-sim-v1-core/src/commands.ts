import type { BuildOrder, EntityId, PlayerId, Position } from "./sim/components";
import { buildOrder, colonistsOpen, selection, type Selection } from "./state/signals";

// What a command may put into the world. A spawn without a tile is not an error:
// the caller (a debug button, a hotkey) knows what to create, and the engine is
// the one that can tell which tiles are free.
//
// The list is the runtime one and the type is read off it, not the other way round: a
// command arriving over the wire has to be checked against these names, and a second
// copy of them to check against is a copy that will one day be missing the newest kind.
const SPAWN_KINDS = ["colonist", "tree", "rock", "chicken", "wood", "stone", "food"] as const;

type SpawnKind = (typeof SPAWN_KINDS)[number];

// UI commands land in signals and take effect at once — nothing in the sim reads
// them mid-tick, and nobody else has to be told: what this client has selected is not
// part of the world, so it is not part of what a networked game agrees on.
type UiCommand =
  | { type: "select"; selection: Selection | null }
  | { type: "toggleColonists" }
  // Arms (or disarms) the build cursor. The order carries everything about the
  // building that is decided before it has a tile — for a store, which resource it
  // will hold.
  | { type: "setBuild"; order: BuildOrder | null }
  // One command for "never mind", innermost first: it drops the armed build order
  // if there is one, otherwise the selection. Escape has to mean this, and the
  // sender cannot be the one to decide which of the two states is live — a button
  // and a hotkey would answer that differently.
  | { type: "cancel" };

// Clock commands are neither: they change how fast the world runs, so they belong to
// whoever owns the clock (see TurnSource). Locally that is these two signals. In a
// networked game it cannot be — a client that paused alone would not be playing the
// same game as the others a second later — so there the command goes to the host and
// the signals are written from the turn stream instead.
type ClockCommand = { type: "setSpeed"; value: number } | { type: "togglePause" };

// World commands mutate the world instead, so they cannot be applied where they
// are sent: a click arrives mid-tick, and a system that already ran this tick
// would then see a different world than the one after it. They go to the clock, which
// puts them on a tick boundary — the next one locally, the one the server names in a
// networked game.
// `destroy` names the entity, not the tile: what is being removed was picked, and
// by the time the command is applied something else may be standing on that tile.
// `owner` is nullable for the same reason `tile` is — a tree belongs to nobody, and
// for the kinds that do belong to someone the sim falls back to the sender's seat
// rather than putting an unowned colonist on the map.
// `build`, unlike a spawn, always names its tile: the player aimed at it, and
// "anywhere free" is not something anyone asks a builder for. A tile that will not
// take the building is not an error either — the ghost said so before the click, and
// the sim drops the command.
type WorldCommand =
  | { type: "spawn"; kind: SpawnKind; tile: Position | null; owner: PlayerId | null }
  | { type: "destroy"; id: EntityId }
  | { type: "build"; order: BuildOrder; tile: Position; owner: PlayerId | null };

type Command = UiCommand | ClockCommand | WorldCommand;

// What every input source is narrowed to before it can touch state. The HUD and
// the camera hold this type rather than the engine class: a button needs to be
// able to send commands, not to reach the world behind them.
interface Dispatcher {
  dispatch(command: Command): void;
}

// The half of a clock a dispatcher needs: somewhere to put the commands it cannot
// apply itself. Declared here rather than imported from `turns` so the dependency runs
// one way — a dispatcher knows it is handing work off, not who to.
interface CommandSink {
  submit(command: WorldCommand): void;
  setClock(command: ClockCommand): void;
}

// The single write path into state: every input source (HUD, camera hotkeys, the
// build menu) goes through dispatch instead of poking signals directly. Keeps the
// set of legal state changes enumerable in one place — and keeps the split between
// "this client's view" and "the shared world" in one place too, which is what makes
// the same HUD work in a networked game.
class CommandDispatcher implements Dispatcher {
  private sink: CommandSink;

  constructor(sink: CommandSink) {
    this.sink = sink;
  }

  dispatch(command: Command): void {
    if (command.type === "spawn" || command.type === "destroy" || command.type === "build") {
      this.sink.submit(command);
    } else if (command.type === "setSpeed" || command.type === "togglePause") {
      this.sink.setClock(command);
    } else if (command.type === "select") {
      selection.value = command.selection;
    } else if (command.type === "toggleColonists") {
      colonistsOpen.value = !colonistsOpen.value;
    } else if (command.type === "setBuild") {
      buildOrder.value = command.order;
    } else if (command.type === "cancel") {
      if (buildOrder.value) {
        buildOrder.value = null;
      } else {
        selection.value = null;
      }
    }
  }
}

export type { ClockCommand, Command, CommandSink, Dispatcher, SpawnKind, UiCommand, WorldCommand };
export { CommandDispatcher, SPAWN_KINDS };
