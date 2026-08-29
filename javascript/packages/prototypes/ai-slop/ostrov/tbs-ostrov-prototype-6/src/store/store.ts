import { signal } from "@preact/signals-react";
import { createContext, useContext } from "react";
import { createRng } from "../domain/battle/rng";
import { createStartingRoster, generateEnemyRoster, rollShopOffers } from "../domain/game/roster";
import type { TArchetypeId } from "../domain/battle/archetypes";
import type { TOutcome, TRosterUnit, TSimulation } from "../domain/battle/types";

/** Prep places units, battle runs itself, result waits for the next round. */
type TPhase = "prep" | "battle" | "result" | "over";

type TLogEntry = {
  id: number;
  round: number;
  text: string;
};

const START_GOLD = 12;
const START_LIVES = 12;

let logCounter = 0;

const createLogEntry = (round: number, text: string): TLogEntry => {
  logCounter += 1;

  return { id: logCounter, round, text };
};

const createStore = () => {
  const rng = createRng(Date.now() >>> 0);

  return {
    rng,
    metaState: {
      phase: signal<TPhase>("prep"),
      round: signal(1),
      gold: signal(START_GOLD),
      lives: signal(START_LIVES),
      wins: signal(0),
      speed: signal(1),
      paused: signal(false),
      log: signal<TLogEntry[]>([createLogEntry(1, "Раунд 1: расставьте отряд и начните бой")]),
    },
    rosterState: {
      player: signal<TRosterUnit[]>(createStartingRoster(rng)),
      enemy: signal<TRosterUnit[]>(generateEnemyRoster(rng, 1)),
      selectedId: signal<string | null>(null),
    },
    shopState: {
      offers: signal<TArchetypeId[]>(rollShopOffers(rng)),
    },
    battleState: {
      /** Mutable simulation: the canvas reads it every frame without React. */
      sim: signal<TSimulation | null>(null),
      /** Bumped a few times a second so the panels follow the fight. */
      tick: signal(0),
      outcome: signal<TOutcome | null>(null),
    },
    viewState: {
      draggingId: signal<string | null>(null),
      dragValid: signal(true),
      dragOriginX: signal(0),
      dragOriginY: signal(0),
      hoveredId: signal<string | null>(null),
    },
  };
};

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => useContext(StoreProvider);

export type { TLogEntry, TPhase, TStore };
export { START_GOLD, START_LIVES, StoreProvider, createLogEntry, createStore, useStore };
