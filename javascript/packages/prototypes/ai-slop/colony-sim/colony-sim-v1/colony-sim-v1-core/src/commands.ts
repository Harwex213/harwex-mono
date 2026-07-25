import type { EntityId, PlayerId, Position } from "./sim/components";
import { colonistsOpen, paused, selection, type Selection, speed } from "./state/signals";

// What a command may put into the world. A spawn without a tile is not an error:
// the caller (a debug button, a hotkey) knows what to create, and the engine is
// the one that can tell which tiles are free.
type SpawnKind = "colonist" | "tree" | "rock" | "chicken" | "wood" | "stone";

// UI commands land in signals and take effect at once — nothing in the sim reads
// them mid-tick.
type UiCommand =
  | { type: "setSpeed"; value: number }
  | { type: "togglePause" }
  | { type: "select"; selection: Selection | null }
  | { type: "toggleColonists" };

// World commands mutate the world instead, so they cannot be applied where they
// are sent: a click arrives mid-tick, and a system that already ran this tick
// would then see a different world than the one after it. They queue here and the
// engine drains them on a tick boundary.
// `destroy` names the entity, not the tile: what is being removed was picked, and
// by the time the queue drains something else may be standing on that tile.
// `owner` is nullable for the same reason `tile` is — a tree belongs to nobody, and
// for the kinds that do belong to someone the sim falls back to the default player
// rather than putting an unowned colonist on the map.
type WorldCommand =
  | { type: "spawn"; kind: SpawnKind; tile: Position | null; owner: PlayerId | null }
  | { type: "destroy"; id: EntityId };

type Command = UiCommand | WorldCommand;

// What every input source is narrowed to before it can touch state. The HUD and
// the camera hold this type rather than the engine class: a button needs to be
// able to send commands, not to reach the world behind them.
interface Dispatcher {
  dispatch(command: Command): void;
}

// The single write path into UI state: every input source (HUD, camera hotkeys,
// later the build mode) goes through dispatch instead of poking signals
// directly. Keeps the set of legal state changes enumerable in one place.
class CommandDispatcher implements Dispatcher {
  private pending: WorldCommand[] = [];

  dispatch(command: Command): void {
    if (command.type === "spawn" || command.type === "destroy") {
      this.pending.push(command);
    } else if (command.type === "setSpeed") {
      speed.value = command.value;
    } else if (command.type === "togglePause") {
      paused.value = !paused.value;
    } else if (command.type === "select") {
      selection.value = command.selection;
    } else if (command.type === "toggleColonists") {
      colonistsOpen.value = !colonistsOpen.value;
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
