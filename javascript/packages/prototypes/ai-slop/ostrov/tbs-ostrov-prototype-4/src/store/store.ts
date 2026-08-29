import { signal } from "@preact/signals-react";
import { createContext, useContext } from "react";
import { randomSeed } from "../domain/world/rng";
import type { TArmy, TFactionId, TFactionState, TLogEntry, TOutcome, TStructure, TWorld } from "../domain/world/types";

/** Which side is allowed to act. Input is refused while the enemy is moving. */
type TPhase = "player" | "enemy";

/**
 * A move already applied to the game state, replayed on screen so the piece
 * slides instead of teleporting. Nothing here can change the outcome of a turn.
 */
type TMoveAnimation = {
  armyId: number;
  fromKey: string;
  path: readonly string[];
  startedAt: number;
  stepMs: number;
};

/** A hit marker, scheduled for the moment the attacker arrives. */
type TStrikeFlash = {
  key: string;
  startAt: number;
  damage: number;
  fatal: boolean;
};

const DEFAULT_BOARD_SIZE = 5;

const createWorldState = () => ({
  seed: signal(randomSeed()),
  boardSize: signal(DEFAULT_BOARD_SIZE),
  world: signal<TWorld | null>(null),
});

const createGameState = () => ({
  turn: signal(1),
  phase: signal<TPhase>("player"),
  outcome: signal<TOutcome>("playing"),
  armies: signal<readonly TArmy[]>([]),
  structures: signal<readonly TStructure[]>([]),
  factions: signal<Record<TFactionId, TFactionState>>({
    player: { id: "player", name: "Приморье", gold: 0, hiredThisTurn: false },
    enemy: { id: "enemy", name: "Багровый клан", gold: 0, hiredThisTurn: false },
  }),
  /** Tiles the player has ever seen, and the ones in sight right now. */
  explored: signal<ReadonlySet<string>>(new Set<string>()),
  visible: signal<ReadonlySet<string>>(new Set<string>()),
  log: signal<readonly TLogEntry[]>([]),
  /** Hands out army, structure and log ids from one counter. */
  nextId: signal(1),
  /** Advanced once per fight, so a reload replays the same battles. */
  rollCount: signal(0),
});

const createSelectionState = () => ({
  selectedArmyId: signal(-1),
  hoveredKey: signal(""),
});

const createViewState = () => ({
  hexSize: signal(48),
  showGrid: signal(true),
  showFog: signal(true),
  showCoords: signal(false),
});

const createAnimationState = () => ({
  move: signal<TMoveAnimation | null>(null),
  strike: signal<TStrikeFlash | null>(null),
});

const createStore = () => ({
  worldState: createWorldState(),
  gameState: createGameState(),
  selectionState: createSelectionState(),
  viewState: createViewState(),
  animationState: createAnimationState(),
});

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => useContext(StoreProvider);

export type { TMoveAnimation, TPhase, TStore, TStrikeFlash };
export { DEFAULT_BOARD_SIZE, StoreProvider, createStore, useStore };
