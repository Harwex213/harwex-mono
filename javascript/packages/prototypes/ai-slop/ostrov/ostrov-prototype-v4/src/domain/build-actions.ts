import { showToastAction } from "./game-actions";
import {
  BUILDINGS,
  DEAD_HEX_TOXICITY,
  MIN_ISLAND_HEX_COUNT,
  canAfford,
  legalHexesFor,
  removeHex,
  setBuilding,
} from "../core/exports";
import type { TBuildingId, TIsland, TResources } from "../core/exports";
import type { TLogEntry } from "../store/game-state";
import type { TCamera, TScreenPoint } from "../store/ui-state";
import type { TStore } from "../store/store";

/**
 * The build phase: arming a card, placing a building, demolishing a building or
 * a whole hex, and the three pieces of pointer state the island canvas writes
 * (hover, selection, camera). Plan §3.2.
 *
 * Every body reads with `.peek()` and writes with `.value =`, and every value
 * written is a fresh immutable one.
 */

/** Demolishing a building gives back this share of its stone and wood, floored. */
const REFUND_RATIO = 0.5;

/** Hammers it costs to throw a hex off the island, and the discount for a dead one. */
const HEX_DEMOLITION_HAMMERS = 2;
const DEAD_HEX_DEMOLITION_HAMMERS = 1;

const BUILD_PHASE_ONLY_RU = "Строить и сносить можно только в фазе строительства";
const FOREIGN_ISLAND_RU = "Это чужой остров";
const NOT_AFFORDABLE_RU = "Не хватает ресурсов";
const ILLEGAL_HEX_RU = "Здесь это здание не поставить";
const TOO_FEW_HEXES_RU = `Остров не может быть меньше ${MIN_ISLAND_HEX_COUNT} гексов`;

const appendLogEntry = (store: TStore, textRu: string): void => {
  const entry: TLogEntry = {
    turn: store.game.turn.peek(),
    phase: store.game.phase.peek(),
    textRu,
  };

  store.game.log.value = [...store.game.log.peek(), entry];
};

/** True when the player may change the island right now; raises the toast itself. */
const canEditIsland = (store: TStore): boolean => {
  if (store.derived.isReadonly.peek() === true) {
    showToastAction(store, FOREIGN_ISLAND_RU);

    return false;
  }

  if (store.game.phase.peek() !== "build") {
    showToastAction(store, BUILD_PHASE_ONLY_RU);

    return false;
  }

  return true;
};

const writeIsland = (store: TStore, island: TIsland): void => {
  store.game.islands.value = {
    ...store.game.islands.peek(),
    [island.ownerId]: island,
  };
};

/** Arms a building card, or disarms when the same card is armed again. */
const armBuildingAction = (store: TStore, building: TBuildingId | null): void => {
  if (building !== null && canEditIsland(store) === false) {
    return;
  }

  const armed = store.ui.armedBuilding.peek();
  store.ui.armedBuilding.value = armed === building ? null : building;
  store.ui.demolishMode.value = false;
  store.ui.purgeMode.value = false;
};

const toggleDemolishAction = (store: TStore): void => {
  const active = store.ui.demolishMode.peek();
  if (active === false && canEditIsland(store) === false) {
    return;
  }

  store.ui.demolishMode.value = !active;
  store.ui.armedBuilding.value = null;
  store.ui.purgeMode.value = false;
};

const selectHexAction = (store: TStore, hexId: string | null): void => {
  store.ui.selectedHexId.value = hexId;
};

const hoverHexAction = (store: TStore, hexId: string | null, screen: TScreenPoint | null): void => {
  store.ui.hoveredHexId.value = hexId;
  store.ui.hoverScreen.value = hexId === null ? null : screen;
};

const setCameraAction = (store: TStore, camera: TCamera): void => {
  store.ui.camera.value = camera;
};

const payBuildingCost = (resources: TResources, building: TBuildingId): TResources => {
  const cost = BUILDINGS[building].cost;

  return {
    ...resources,
    stone: resources.stone - cost.stone,
    wood: resources.wood - cost.wood,
    hammers: resources.hammers - cost.hammers,
  };
};

const placeBuildingAction = (store: TStore, hexId: string, building: TBuildingId): void => {
  if (canEditIsland(store) === false) {
    return;
  }

  const island = store.derived.viewedIsland.peek();
  if (island === null) {
    return;
  }

  if (legalHexesFor(island, building).includes(hexId) === false) {
    showToastAction(store, ILLEGAL_HEX_RU);

    return;
  }

  const resources = store.game.resources.peek();
  if (canAfford(resources, building) === false) {
    showToastAction(store, NOT_AFFORDABLE_RU);

    return;
  }

  store.game.resources.value = payBuildingCost(resources, building);
  writeIsland(store, setBuilding(island, hexId, building));
  store.ui.armedBuilding.value = null;
  appendLogEntry(store, `Построено: ${BUILDINGS[building].nameRu} на гексе ${hexId}`);
};

const demolishBuilding = (store: TStore, island: TIsland, hexId: string, building: TBuildingId): void => {
  const cost = BUILDINGS[building].cost;
  const resources = store.game.resources.peek();

  store.game.resources.value = {
    ...resources,
    stone: resources.stone + Math.floor(cost.stone * REFUND_RATIO),
    wood: resources.wood + Math.floor(cost.wood * REFUND_RATIO),
  };
  writeIsland(store, setBuilding(island, hexId, null));
  appendLogEntry(store, `Снесено: ${BUILDINGS[building].nameRu} на гексе ${hexId}`);
};

const demolishHex = (store: TStore, island: TIsland, hexId: string, toxicity: number): void => {
  if (Object.keys(island.hexes).length <= MIN_ISLAND_HEX_COUNT) {
    showToastAction(store, TOO_FEW_HEXES_RU);

    return;
  }

  const price = toxicity >= DEAD_HEX_TOXICITY ? DEAD_HEX_DEMOLITION_HAMMERS : HEX_DEMOLITION_HAMMERS;
  const resources = store.game.resources.peek();
  if (resources.hammers < price) {
    showToastAction(store, `${NOT_AFFORDABLE_RU}: нужно ${price} ⚒️`);

    return;
  }

  store.game.resources.value = { ...resources, hammers: resources.hammers - price };
  writeIsland(store, removeHex(island, hexId));
  store.ui.selectedHexId.value = null;
  store.ui.hoveredHexId.value = null;
  appendLogEntry(store, `Гекс ${hexId} сброшен с острова за ${price} ⚒️`);
};

/**
 * A hex with a building loses the building and refunds half its stone and wood.
 * An empty hex leaves the island altogether, taking its toxicity with it.
 */
const demolishAction = (store: TStore, hexId: string): void => {
  if (canEditIsland(store) === false) {
    return;
  }

  const island = store.derived.viewedIsland.peek();
  if (island === null) {
    return;
  }

  const hex = island.hexes[hexId];
  if (hex === undefined) {
    return;
  }

  if (hex.building !== null) {
    demolishBuilding(store, island, hexId, hex.building);

    return;
  }

  demolishHex(store, island, hexId, hex.toxicity);
};

export {
  DEAD_HEX_DEMOLITION_HAMMERS,
  HEX_DEMOLITION_HAMMERS,
  REFUND_RATIO,
  armBuildingAction,
  demolishAction,
  hoverHexAction,
  placeBuildingAction,
  selectHexAction,
  setCameraAction,
  toggleDemolishAction,
};
