import { computed, signal } from "@preact/signals-react";
import { createContext, useContext } from "react";
import { summariseEconomy } from "../domain/game/economy";
import { createInitialGame } from "../domain/game/setup";
import { generateIsland } from "../domain/world/island-generator";
import type { TBuildingKind, TLogEntry, TPlacedBuilding, TResources } from "../domain/game/types";
import type { TWorld } from "../domain/world/types";

const MAP_WIDTH = 21;
const MAP_HEIGHT = 15;

const randomSeed = (): number => Math.floor(Math.random() * 0xffffff) + 1;

const createWorldState = (world: TWorld) => ({
  world: signal<TWorld>(world),
});

const createGameState = (world: TWorld) => {
  const initial = createInitialGame(world);
  const turn = signal(initial.turn);
  const resources = signal<TResources>(initial.resources);
  const population = signal(initial.population);
  const buildings = signal<readonly (TPlacedBuilding | null)[]>(initial.buildings);

  return {
    turn,
    resources,
    population,
    buildings,
    /** Placement counter, so worker priority follows the order things were ordered in. */
    nextOrder: signal(1),
    victory: signal(false),
    /**
     * Housing, storage, staffing and next turn's production. Derived, so every
     * panel reads the same numbers the turn resolver will use.
     */
    summary: computed(() =>
      summariseEconomy({
        turn: turn.value,
        resources: resources.value,
        population: population.value,
        buildings: buildings.value,
      })
    ),
  };
};

const createViewState = (world: TWorld) => ({
  hexSize: signal(26),
  hoveredIndex: signal(-1),
  selectedIndex: signal(world.startIndex),
  /** Building the player picked in the menu, previewed on the map until placed. */
  pendingKind: signal<TBuildingKind | null>(null),
  showYields: signal(true),
  log: signal<readonly TLogEntry[]>([
    { id: 0, turn: 1, tone: "info", text: "Колонисты высадились на остров." },
  ]),
  nextLogId: signal(1),
});

const createStore = () => {
  const world = generateIsland({ width: MAP_WIDTH, height: MAP_HEIGHT, seed: randomSeed() });

  return {
    worldState: createWorldState(world),
    gameState: createGameState(world),
    viewState: createViewState(world),
  };
};

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => useContext(StoreProvider);

export type { TStore };
export { MAP_HEIGHT, MAP_WIDTH, StoreProvider, createStore, randomSeed, useStore };
