import { signal } from "@preact/signals-react";
import type { Signal } from "@preact/signals-react";
import type { TBuildingId, TTrailEvent } from "../core/exports";

/**
 * Transient interface state: what is armed, what the pointer is over, which
 * modal is open and where the island camera stands. Nothing here survives a
 * reload and nothing here belongs to the game rules.
 */

/** A point in CSS pixels, relative to the viewport. */
type TScreenPoint = {
  readonly x: number;
  readonly y: number;
};

/**
 * The island canvas camera. `x` and `y` are the world point at the centre of
 * the canvas, `scale` is pixels per world pixel. S4 owns the maths; the value
 * lives here so the panels and the dev hook can read it.
 */
type TCamera = {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
};

type TUiState = {
  /** The building card the player has armed, or null. */
  readonly armedBuilding: Signal<TBuildingId | null>;
  readonly demolishMode: Signal<boolean>;
  /** True while the purge cursor is armed: a click spends 💠 on one hex. S8. */
  readonly purgeMode: Signal<boolean>;
  readonly hoveredHexId: Signal<string | null>;
  /** Where to put the hex popup, in viewport pixels. */
  readonly hoverScreen: Signal<TScreenPoint | null>;
  readonly selectedHexId: Signal<string | null>;
  /** The world cell the exploration page has open in the cell panel. S6. */
  readonly selectedCellId: Signal<number | null>;
  /** True once the island has flown this exploration phase: one move per turn. S6. */
  readonly explorationMoved: Signal<boolean>;
  readonly techModalOpen: Signal<boolean>;
  readonly eventModal: Signal<TTrailEvent | null>;
  /** True when the clearing level ended on "Отступить" instead of on a clean sweep. S7. */
  readonly battleRetreated: Signal<boolean>;
  readonly toast: Signal<string | null>;
  readonly camera: Signal<TCamera>;
};

const INITIAL_CAMERA: TCamera = { x: 0, y: 0, scale: 1 };

const createUiState = (): TUiState => {
  return {
    armedBuilding: signal<TBuildingId | null>(null),
    demolishMode: signal<boolean>(false),
    purgeMode: signal<boolean>(false),
    hoveredHexId: signal<string | null>(null),
    hoverScreen: signal<TScreenPoint | null>(null),
    selectedHexId: signal<string | null>(null),
    selectedCellId: signal<number | null>(null),
    explorationMoved: signal<boolean>(false),
    techModalOpen: signal<boolean>(false),
    eventModal: signal<TTrailEvent | null>(null),
    battleRetreated: signal<boolean>(false),
    toast: signal<string | null>(null),
    camera: signal<TCamera>(INITIAL_CAMERA),
  };
};

export type { TCamera, TScreenPoint, TUiState };
export { INITIAL_CAMERA, createUiState };
