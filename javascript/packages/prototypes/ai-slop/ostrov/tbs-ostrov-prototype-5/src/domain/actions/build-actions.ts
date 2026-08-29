import { BUILDING_DEFS, demolitionRefund } from "../game/buildings";
import { addResources, subtractResources } from "../game/economy";
import { buildRefusal } from "../game/rules";
import { appendLog } from "./log-actions";
import type { TBuildingKind, TPlacedBuilding } from "../game/types";
import type { TStore } from "../../store/store";

const buildAction = (store: TStore, tileIndex: number, kind: TBuildingKind): void => {
  const refusal = buildRefusal({
    tile: store.worldState.world.peek().tiles[tileIndex],
    occupant: store.gameState.buildings.peek()[tileIndex] ?? null,
    resources: store.gameState.resources.peek(),
    kind,
    victory: store.gameState.victory.peek(),
  });
  if (refusal !== null) {
    return;
  }

  const definition = BUILDING_DEFS[kind];
  const resources = { ...store.gameState.resources.peek() };
  subtractResources(resources, definition.cost);

  const order = store.gameState.nextOrder.peek();
  const placed: TPlacedBuilding = {
    kind,
    tileIndex,
    remaining: definition.buildTurns,
    order,
  };

  const buildings = [...store.gameState.buildings.peek()];
  buildings[tileIndex] = placed;

  store.gameState.resources.value = resources;
  store.gameState.buildings.value = buildings;
  store.gameState.nextOrder.value = order + 1;

  appendLog(store, [
    {
      turn: store.gameState.turn.peek(),
      tone: "info",
      text: `${definition.label}: заложена стройка на ${definition.buildTurns} х.`,
    },
  ]);
};

const demolishAction = (store: TStore, tileIndex: number): void => {
  const existing = store.gameState.buildings.peek()[tileIndex];
  if (!existing) {
    return;
  }

  const refund = demolitionRefund(existing.kind);
  const resources = { ...store.gameState.resources.peek() };
  addResources(resources, refund);

  const buildings = [...store.gameState.buildings.peek()];
  buildings[tileIndex] = null;

  store.gameState.resources.value = resources;
  store.gameState.buildings.value = buildings;

  appendLog(store, [
    {
      turn: store.gameState.turn.peek(),
      tone: "info",
      text: `${BUILDING_DEFS[existing.kind].label} разобрана, часть материалов вернулась.`,
    },
  ]);
};

export { buildAction, demolishAction };
