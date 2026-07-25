import type { Position } from "./sim/components";
import type { World } from "./sim/world";
import type { CommandDispatcher } from "./commands";
import type { Selection } from "./state/signals";

// The seam between core and whatever draws it. Core owns the world, the loop and
// the UI state; a view is handed the world every frame and is expected to project
// it — never to mutate it. Keeping the contract here (rather than importing the
// renderer) is what lets core stay free of pixi and of the DOM.

// What the cursor is over, as resolved by the engine: the view knows tiles, the
// engine knows what lives on them.
type HoverKind = "entity" | "tile" | null;

// Pointer events the view reports back. Picking needs the World, which the view
// does not have, so tile coordinates are all it sends.
interface PointerHandlers {
  // A plain left click (no pan), in tile coords.
  pick: (tile: Position) => void;
  // Where the cursor rests, in tile coords, or null once it leaves the world.
  hover: (tile: Position | null) => void;
}

interface GameView {
  // What a click would take right now. View-only feedback: it never reaches the
  // World and never goes into a signal.
  setHover(target: Selection | null): void;
  // `alpha` is the progress through the current tick, for interpolation.
  render(world: World, alpha: number): void;
}

// Everything a view needs from the engine at construction time.
interface ViewDeps {
  world: World;
  commands: CommandDispatcher;
  pointer: PointerHandlers;
}

type CreateView = (deps: ViewDeps) => GameView;

export type { CreateView, GameView, HoverKind, PointerHandlers, ViewDeps };
