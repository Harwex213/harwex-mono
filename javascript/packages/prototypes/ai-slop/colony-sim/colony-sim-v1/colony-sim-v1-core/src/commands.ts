import { colonistsOpen, paused, selection, type Selection, speed } from "./state/signals";

type Command =
  | { type: "setSpeed"; value: number }
  | { type: "togglePause" }
  | { type: "select"; selection: Selection | null }
  | { type: "toggleColonists" };

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
  dispatch(command: Command): void {
    if (command.type === "setSpeed") {
      speed.value = command.value;
    } else if (command.type === "togglePause") {
      paused.value = !paused.value;
    } else if (command.type === "select") {
      selection.value = command.selection;
    } else if (command.type === "toggleColonists") {
      colonistsOpen.value = !colonistsOpen.value;
    }
  }
}

export type { Command, Dispatcher };
export { CommandDispatcher };
