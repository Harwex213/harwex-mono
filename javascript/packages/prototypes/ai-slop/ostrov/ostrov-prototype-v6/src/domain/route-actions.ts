import type { TStore } from "../store/store";
import type { TPage } from "../store/route-state";

/**
 * A hash router. `#/` is the main menu, `#/island` the player's own island,
 * `#/island/<playerId>` a rival's island read-only, `#/world` the global map
 * and `#/battle` the level of the clearing phase.
 */

const ISLAND_PREFIX = "#/island";

const PAGE_BY_HASH: Readonly<Record<string, TPage>> = {
  "#/world": "world",
  "#/battle": "battle",
};

const navigateToIslandAction = (store: TStore, playerId: string | null) => {
  // The other phases own their own page, and the tax phase flies its motes to
  // the HUD of the player's own island.
  if (store.ui.busy.peek() || store.game.phase.peek() !== "build") {
    return;
  }

  window.location.hash = playerId ? `${ISLAND_PREFIX}/${playerId}` : ISLAND_PREFIX;
};

const navigateToMenuAction = (_store: TStore) => {
  window.location.hash = "#/";
};

/** Reads the address bar into the store. Also runs once on a cold load. */
const syncRouteFromHash = (store: TStore) => {
  const hash = window.location.hash || "#/";

  // Leaving a page must not leave its popups and armed cards behind.
  store.ui.armedBuilding.value = null;
  store.ui.demolishMode.value = false;
  store.ui.selectedHexId.value = null;
  store.ui.hoveredHexId.value = null;
  store.ui.demolishTargetHexId.value = null;

  if (!store.game.started.peek()) {
    store.route.page.value = "menu";
    store.route.islandPlayerId.value = null;

    return;
  }

  const fixedPage = PAGE_BY_HASH[hash];
  if (fixedPage) {
    store.route.page.value = fixedPage;
    store.route.islandPlayerId.value = null;

    return;
  }

  if (!hash.startsWith(ISLAND_PREFIX)) {
    store.route.page.value = "menu";
    store.route.islandPlayerId.value = null;

    return;
  }

  const rest = hash.slice(ISLAND_PREFIX.length).replace(/^\//, "");

  store.route.page.value = "island";
  store.route.islandPlayerId.value = rest === "" ? null : rest;
};

export { navigateToIslandAction, navigateToMenuAction, syncRouteFromHash };
