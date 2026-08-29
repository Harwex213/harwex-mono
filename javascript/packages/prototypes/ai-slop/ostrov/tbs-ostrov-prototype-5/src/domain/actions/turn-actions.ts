import { resolveTurn } from "../game/economy";
import { createInitialGame } from "../game/setup";
import { generateIsland } from "../world/island-generator";
import { appendLog } from "./log-actions";
import { MAP_HEIGHT, MAP_WIDTH, randomSeed } from "../../store/store";
import type { TGameSnapshot } from "../game/types";
import type { TStore } from "../../store/store";

const endTurnAction = (store: TStore): void => {
  if (store.gameState.victory.peek()) {
    return;
  }

  const snapshot: TGameSnapshot = {
    turn: store.gameState.turn.peek(),
    resources: store.gameState.resources.peek(),
    population: store.gameState.population.peek(),
    buildings: store.gameState.buildings.peek(),
  };

  const outcome = resolveTurn(snapshot);

  store.gameState.turn.value = outcome.snapshot.turn;
  store.gameState.resources.value = outcome.snapshot.resources;
  store.gameState.population.value = outcome.snapshot.population;
  store.gameState.buildings.value = outcome.snapshot.buildings;
  store.gameState.victory.value = outcome.victory;

  appendLog(store, outcome.entries);
};

/** New island, new colony. The seed is thrown away, so every run is a new map. */
const restartAction = (store: TStore): void => {
  const world = generateIsland({ width: MAP_WIDTH, height: MAP_HEIGHT, seed: randomSeed() });
  const initial = createInitialGame(world);

  store.worldState.world.value = world;
  store.gameState.turn.value = initial.turn;
  store.gameState.resources.value = initial.resources;
  store.gameState.population.value = initial.population;
  store.gameState.buildings.value = initial.buildings;
  store.gameState.nextOrder.value = 1;
  store.gameState.victory.value = false;

  store.viewState.hoveredIndex.value = -1;
  store.viewState.selectedIndex.value = world.startIndex;
  store.viewState.pendingKind.value = null;
  store.viewState.log.value = [];
  store.viewState.nextLogId.value = 0;

  appendLog(store, [{ turn: 1, tone: "info", text: "Новый остров. Колонисты высадились на берег." }]);
};

export { endTurnAction, restartAction };
