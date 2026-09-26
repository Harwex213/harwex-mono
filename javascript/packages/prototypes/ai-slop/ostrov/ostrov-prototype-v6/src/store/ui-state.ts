import { signal } from "@preact/signals-react";
import type { TBuildingId, TResourceId } from "../core/types";

/**
 * Everything the shell shows that is not game truth: which building card is
 * armed, which hex the pointer is over, which modal is open.
 */

/** A point on screen: the popup anchor, a HUD icon, the end of a flight. */
type TPointerAnchor = {
  readonly x: number;
  readonly y: number;
};

/** Where the island layer sits, so the tax phase can find a hex on screen. */
type TCamera = {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
};

/**
 * One mote of resource or toxicity flying from a building to its HUD icon. The
 * tax phase creates them all at once with staggered delays, and each one is
 * dropped from the list when it lands and its effect is applied.
 */
type TFlight = {
  readonly id: string;
  readonly kind: "yield" | "toxicity" | "mad";
  readonly emoji: string;
  readonly amount: number;
  /** The hex the mote came from, for a toxicity mote that has to go back. */
  readonly hexId: string | null;
  readonly resource: TResourceId | null;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly delayMs: number;
};

const createUiState = () => ({
  /** The building card clicked in the buildings panel, waiting for a hex. */
  armedBuilding: signal<TBuildingId | null>(null),
  demolishMode: signal<boolean>(false),
  hoveredHexId: signal<string | null>(null),
  hoverAnchor: signal<TPointerAnchor | null>(null),
  /** The hex whose biome modal is open on the right. */
  selectedHexId: signal<string | null>(null),
  techModalOpen: signal<boolean>(false),
  /** The hex waiting for a "вы уверены?" answer. */
  demolishTargetHexId: signal<string | null>(null),
  /** The toggle inside that modal, remembered for the rest of the session. */
  skipDemolishConfirm: signal<boolean>(false),
  /** One-line feedback over the canvas: why the last click did nothing. */
  notice: signal<string | null>(null),
  /** The island layer's transform, mirrored here for the flight animation. */
  camera: signal<TCamera>({ x: 0, y: 0, scale: 1 }),
  /** Where each resource icon sits on screen, measured by the resources panel. */
  hudAnchors: signal<Readonly<Partial<Record<TResourceId, TPointerAnchor>>>>({}),
  flights: signal<readonly TFlight[]>([]),
  /** The turn is owned by an animation: end-turn is refused while this is set. */
  busy: signal<boolean>(false),
});

type TUiState = ReturnType<typeof createUiState>;

export type { TCamera, TFlight, TPointerAnchor, TUiState };
export { createUiState };
