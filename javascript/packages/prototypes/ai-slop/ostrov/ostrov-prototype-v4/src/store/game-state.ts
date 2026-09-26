import { signal } from "@preact/signals-react";
import { INITIAL_RESOURCES } from "../core/exports";
import type { Signal } from "@preact/signals-react";
import type {
  TBattleState,
  TIsland,
  TPhase,
  TPlayer,
  TResources,
  TTechId,
  TWorldCell,
} from "../core/exports";

/**
 * Everything the game itself owns. The route lives in `route-state.ts`, the
 * transient interface state in `ui-state.ts`, and the animation queue arrives
 * with S5. Signal contents are immutable: an action replaces a whole value and
 * never mutates one in place.
 */

/** One line of the event log. The phase is the phase the line was written in. */
type TLogEntry = {
  readonly turn: number;
  readonly phase: TPhase;
  readonly textRu: string;
};

type TGameState = {
  /** False until `startGame` runs. Any non-menu route falls back to the menu while it is false. */
  readonly started: Signal<boolean>;
  /** Zero means "not chosen yet". `startGame` keeps a seed a dev hook has already written. */
  readonly seed: Signal<number>;
  readonly turn: Signal<number>;
  readonly phase: Signal<TPhase>;
  readonly players: Signal<readonly TPlayer[]>;
  /** Keyed by `ownerId`, one island per player. */
  readonly islands: Signal<Readonly<Record<string, TIsland>>>;
  readonly resources: Signal<TResources>;
  readonly worldCells: Signal<readonly TWorldCell[]>;
  /** The world cell the human island currently stands on. */
  readonly islandCellId: Signal<number>;
  readonly researching: Signal<TTechId | null>;
  readonly researched: Signal<readonly TTechId[]>;
  readonly researchProgress: Signal<Readonly<Partial<Record<TTechId, number>>>>;
  readonly log: Signal<readonly TLogEntry[]>;
  /** Extra enemies queued by riots and trail events for the next clearing phase. */
  readonly pendingEnemies: Signal<number>;
  readonly calmUsesThisTurn: Signal<number>;
  readonly battle: Signal<TBattleState | null>;
  /** True while an animation or a battle runs. End turn is refused while it is true. */
  readonly busy: Signal<boolean>;
};

/** The phase names as the turn pill, the log and the tech modal print them. */
const PHASE_NAMES_RU: Readonly<Record<TPhase, string>> = {
  build: "Строительство",
  tax: "Налоги",
  exploration: "Разведка",
  clearing: "Зачистка",
};

const FIRST_TURN = 1;

const NO_SEED = 0;

const createGameState = (): TGameState => {
  return {
    started: signal<boolean>(false),
    seed: signal<number>(NO_SEED),
    turn: signal<number>(FIRST_TURN),
    phase: signal<TPhase>("build"),
    players: signal<readonly TPlayer[]>([]),
    islands: signal<Readonly<Record<string, TIsland>>>({}),
    resources: signal<TResources>(INITIAL_RESOURCES),
    worldCells: signal<readonly TWorldCell[]>([]),
    islandCellId: signal<number>(0),
    researching: signal<TTechId | null>(null),
    researched: signal<readonly TTechId[]>([]),
    researchProgress: signal<Readonly<Partial<Record<TTechId, number>>>>({}),
    log: signal<readonly TLogEntry[]>([]),
    pendingEnemies: signal<number>(0),
    calmUsesThisTurn: signal<number>(0),
    battle: signal<TBattleState | null>(null),
    busy: signal<boolean>(false),
  };
};

export type { TGameState, TLogEntry };
export { FIRST_TURN, NO_SEED, PHASE_NAMES_RU, createGameState };
