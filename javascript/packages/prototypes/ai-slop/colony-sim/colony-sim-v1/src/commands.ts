import { colonistsOpen, paused, selection, type Selection, speed } from "./ui/signals";

type Command =
  | { type: "setSpeed"; value: number }
  | { type: "togglePause" }
  | { type: "select"; selection: Selection | null }
  | { type: "toggleColonists" };

// The single write path into UI state: every input source (React HUD, camera
// hotkeys, later the build mode) goes through dispatch instead of poking signals
// directly. Keeps the set of legal state changes enumerable in one place.
class CommandDispatcher {
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

export type { Command };
export { CommandDispatcher };
