import { signal } from "@preact/signals";
import type { BuildOrder, EntityId } from "../sim/components";
import type { ColonistRow, SelectionDetails, Stock } from "./inspect";
import { zeroStock } from "./inspect";

// What the player has clicked. A tile is always a valid selection, so a click on
// bare ground picks the tile rather than clearing the selection.
type Selection = { kind: "entity"; id: EntityId } | { kind: "tile"; x: number; y: number };

// The reactivity boundary: ONLY what the DOM HUD renders. Per-entity hot data
// (positions, needs of hundreds of colonists) stays in plain Maps on the World
// and is read directly by the renderer — never mirrored into signals.
// One headcount: the HUD speaks for the colony it belongs to and says nothing about
// anyone else's, so a per-player breakdown has no reader on this boundary.
const colonistCount = signal(0);
const resources = signal<Stock>(zeroStock());
const speed = signal(1);
const paused = signal(false);
// The armed build order, or null when the cursor is just a cursor. It lives on this
// boundary because all three sides of building read it: the menu highlights it, the
// renderer draws its ghost under the cursor, and the engine spends it on a click —
// which is what makes a click mean "build here" instead of "select this".
const buildOrder = signal<BuildOrder | null>(null);
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
  buildOrder,
  colonistCount,
  resources,
  speed,
  paused,
  selection,
  selectionDetails,
  colonistsOpen,
  colonistRoster,
};
