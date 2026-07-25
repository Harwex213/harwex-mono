import { signal } from "@preact/signals";
import type { EntityId, Stock } from "../sim/components";
import type { ColonistRow, SelectionDetails } from "./inspect";

// What the player has clicked. A tile is always a valid selection, so a click on
// bare ground picks the tile rather than clearing the selection.
type Selection = { kind: "entity"; id: EntityId } | { kind: "tile"; x: number; y: number };

// The reactivity boundary: ONLY what the DOM HUD renders. Per-entity hot data
// (positions, needs of hundreds of colonists) stays in plain Maps on the World
// and is read directly by the renderer — never mirrored into signals.
const colonistCount = signal(0);
const resources = signal<Stock>({ wood: 0, stone: 0, food: 0 });
const speed = signal(1);
const paused = signal(false);
// `selection` is read by both the HUD panel and the canvas selection marker;
// `selectionDetails` is the flattened read model the engine refreshes for the
// panel, so the HUD still never touches the World itself.
const selection = signal<Selection | null>(null);
const selectionDetails = signal<SelectionDetails | null>(null);
// Which bottom-bar panel is open. It lives here rather than in component state
// because the engine reads it too: `colonistRoster` is a per-entity list, and the
// one thing that keeps it affordable is not rebuilding it for a closed panel.
const colonistsOpen = signal(false);
const colonistRoster = signal<ColonistRow[]>([]);

export type { Selection };
export {
  colonistCount,
  resources,
  speed,
  paused,
  selection,
  selectionDetails,
  colonistsOpen,
  colonistRoster,
};
