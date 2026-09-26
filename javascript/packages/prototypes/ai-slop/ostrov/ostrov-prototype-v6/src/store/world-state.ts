import { signal } from "@preact/signals-react";
import type { TWorld } from "../core/world-gen";
import type { TTrailEvent } from "../core/trail-events";

/**
 * The global map: the sphere of cells, what the player has selected on it and
 * whether they have already flown this turn.
 */
const createWorldState = () => ({
  world: signal<TWorld | null>(null),
  selectedCellId: signal<string | null>(null),
  /** Staying in a cell dumps toxicity into it, so a move has to be remembered. */
  movedThisTurn: signal<boolean>(false),
  /** The event the trail threw this turn, shown in a modal. */
  trailEvent: signal<TTrailEvent | null>(null),
});

type TWorldState = ReturnType<typeof createWorldState>;

export type { TWorldState };
export { createWorldState };
