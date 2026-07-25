import type { BuildOrder, EntityId, PlayerId, Position } from "./sim/components";
import { buildOrder, colonistsOpen, paused, selection, type Selection, speed } from "./state/signals";

// What a command may put into the world. A spawn without a tile is not an error:
// the caller (a debug button, a hotkey) knows what to create, and the engine is
// the one that can tell which tiles are free.
type SpawnKind = "colonist" | "tree" | "rock" | "chicken" | "wood" | "stone" | "food";

// UI commands land in signals and take effect at once — nothing in the sim reads
// them mid-tick.
type UiCommand =
  | { type: "setSpeed"; value: number }
  | { type: "togglePause" }
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

// World commands mutate the world instead, so they cannot be applied where they
// are sent: a click arrives mid-tick, and a system that already ran this tick
// would then see a different world than the one after it. They queue here and the
// engine drains them on a tick boundary.
// `destroy` names the entity, not the tile: what is being removed was picked, and
// by the time the queue drains something else may be standing on that tile.
// `owner` is nullable for the same reason `tile` is — a tree belongs to nobody, and
// for the kinds that do belong to someone the sim falls back to the default player
// rather than putting an unowned colonist on the map.
// `build`, unlike a spawn, always names its tile: the player aimed at it, and
// "anywhere free" is not something anyone asks a builder for. A tile that will not
// take the building is not an error either — the ghost said so before the click, and
// the sim drops the command.
type WorldCommand =
  | { type: "spawn"; kind: SpawnKind; tile: Position | null; owner: PlayerId | null }
  | { type: "destroy"; id: EntityId }
  | { type: "build"; order: BuildOrder; tile: Position; owner: PlayerId | null };

type Command = UiCommand | WorldCommand;

// What every input source is narrowed to before it can touch state. The HUD and
// the camera hold this type rather than the engine class: a button needs to be
// able to send commands, not to reach the world behind them.
interface Dispatcher {
  dispatch(command: Command): void;
}

// The single write path into UI state: every input source (HUD, camera hotkeys, the
// build menu) goes through dispatch instead of poking signals directly. Keeps the
// set of legal state changes enumerable in one place.
class CommandDispatcher implements Dispatcher {
  private pending: WorldCommand[] = [];

  dispatch(command: Command): void {
    if (command.type === "spawn" || command.type === "destroy" || command.type === "build") {
      this.pending.push(command);
    } else if (command.type === "setSpeed") {
      speed.value = command.value;
    } else if (command.type === "togglePause") {
      paused.value = !paused.value;
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

  // Hands the queue over to whoever owns the world, and empties it: a command is
  // applied once, and a caller that drops the result drops the command with it.
  takePending(): WorldCommand[] {
    const pending = this.pending;
    this.pending = [];
    return pending;
  }
}

export type { Command, Dispatcher, SpawnKind, WorldCommand };
export { CommandDispatcher };
