import { getBiome } from "../core/biomes";
import { canAfford, canBuildOn, effectiveCost, getBuilding } from "../core/buildings";
import { updateHex } from "./player-updates";
import { showNotice } from "./ui-actions";
import type { TStore } from "../store/store";
import type { TBuildingId } from "../core/types";

/**
 * The build phase: arm a building card, click a hex, pay for it. Demolishing
 * is the same gesture in a different mode, and it wipes the hex's toxicity —
 * that is the spec's "уменьшение токсичности через уничтожение".
 */

/** Outside the build phase the island is look-only, as is a rival's island. */
const isBuildingAllowed = (store: TStore) => {
  return store.game.phase.peek() === "build" && !store.ui.busy.peek();
};

/** Clicking the armed card again disarms it, which is how the player cancels. */
const armBuildingAction = (store: TStore, buildingId: TBuildingId) => {
  if (!isBuildingAllowed(store)) {
    return;
  }

  const armed = store.ui.armedBuilding.peek();
  store.ui.armedBuilding.value = armed === buildingId ? null : buildingId;
  store.ui.demolishMode.value = false;
};

const disarmAction = (store: TStore) => {
  store.ui.armedBuilding.value = null;
  store.ui.demolishMode.value = false;
};

/** Arming a building and arming the wrecking ball are mutually exclusive. */
const toggleDemolishModeAction = (store: TStore) => {
  if (!isBuildingAllowed(store)) {
    return;
  }

  const next = !store.ui.demolishMode.peek();
  store.ui.demolishMode.value = next;

  if (next) {
    store.ui.armedBuilding.value = null;
  }
};

const buildOnHexAction = (store: TStore, hexId: string) => {
  if (!isBuildingAllowed(store)) {
    return;
  }

  const player = store.derived.humanPlayer.peek();
  const armedId = store.ui.armedBuilding.peek();
  if (!player || !armedId) {
    return;
  }

  const hex = player.island.hexes.find((candidate) => candidate.id === hexId);
  if (!hex) {
    return;
  }

  const building = getBuilding(armedId);

  if (hex.building !== null) {
    showNotice(store, "Гекс уже занят");

    return;
  }

  if (!canBuildOn(building, hex.biome)) {
    showNotice(store, `«${building.label}» нельзя строить на биоме «${getBiome(hex.biome).label}»`);

    return;
  }

  const discount = store.derived.techEffects.peek().stoneDiscount;
  if (!canAfford(player.resources, building, discount)) {
    showNotice(store, `Не хватает ресурсов на «${building.label}»`);

    return;
  }

  const cost = effectiveCost(building, discount);
  const paid = {
    ...player,
    resources: {
      ...player.resources,
      stone: player.resources.stone - cost.stone,
      wood: player.resources.wood - cost.wood,
      hammers: player.resources.hammers - cost.hammers,
    },
  };

  updateHex(store, paid, hexId, (target) => ({ ...target, building: building.id }));

  // The card stays armed for the next hex, unless the player just spent the
  // last of what it costs.
  const next = store.derived.humanPlayer.peek();
  if (next && !canAfford(next.resources, building, discount)) {
    store.ui.armedBuilding.value = null;
  }
};

const demolishHex = (store: TStore, hexId: string) => {
  const player = store.derived.humanPlayer.peek();
  if (!player) {
    return;
  }

  updateHex(store, player, hexId, (target) => ({ ...target, building: null, toxicity: 0 }));
  store.ui.demolishTargetHexId.value = null;
};

/** Step one of the demolish flow: refuse, ask, or go straight through. */
const requestDemolishAction = (store: TStore, hexId: string) => {
  if (!isBuildingAllowed(store)) {
    return;
  }

  const player = store.derived.humanPlayer.peek();
  if (!player) {
    return;
  }

  const hex = player.island.hexes.find((candidate) => candidate.id === hexId);
  if (!hex) {
    return;
  }

  if (hex.building === null) {
    showNotice(store, "Здесь нечего сносить");

    return;
  }

  if (store.ui.skipDemolishConfirm.peek()) {
    demolishHex(store, hexId);

    return;
  }

  store.ui.demolishTargetHexId.value = hexId;
};

/** Step two: the answer from the "вы уверены?" modal. */
const confirmDemolishAction = (store: TStore, skipNextTime: boolean) => {
  const hexId = store.ui.demolishTargetHexId.peek();
  if (!hexId) {
    return;
  }

  store.ui.skipDemolishConfirm.value = skipNextTime;
  demolishHex(store, hexId);
};

const cancelDemolishAction = (store: TStore) => {
  store.ui.demolishTargetHexId.value = null;
};

export {
  armBuildingAction,
  buildOnHexAction,
  cancelDemolishAction,
  confirmDemolishAction,
  disarmAction,
  requestDemolishAction,
  toggleDemolishModeAction,
};
