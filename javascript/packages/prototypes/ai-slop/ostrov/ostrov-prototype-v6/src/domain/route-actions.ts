import type { TStore } from "../store/store";
import type { TPage } from "../store/route-state";

/**
 * A hash router. `#/island` is the player's own island, `#/island/<playerId>`
 * a rival's island read-only, `#/world` the global map and `#/battle` the level
 * of the clearing phase. Any other hash opens the player's own island.
 */

const ISLAND_PREFIX = "#/island";
const WORLD_HASH = "#/world";

const PAGE_BY_HASH: Readonly<Record<string, TPage>> = {
  [WORLD_HASH]: "world",
  "#/battle": "battle",
};

const navigateToIslandAction = (store: TStore, playerId: string | null) => {
  // The other phases own their own page, and the tax phase flies its motes to
  // the HUD of the player's own island. Before the game starts the players
  // list is locked on the player's own island.
  if (store.ui.busy.peek() || store.game.phase.peek() !== "build" || store.game.stage.peek() !== "play") {
    return;
  }

  window.location.hash = playerId ? `${ISLAND_PREFIX}/${playerId}` : ISLAND_PREFIX;
};

/** Reads the address bar into the store. Also runs once on a cold load. */
const syncRouteFromHash = (store: TStore) => {
  const hash = window.location.hash;

  // Leaving a page must not leave its popups and armed cards behind.
  store.ui.armedBuilding.value = null;
  store.ui.demolishMode.value = false;
  store.ui.selectedHexId.value = null;
  store.ui.hoveredHexId.value = null;
  store.ui.demolishTargetHexId.value = null;
  store.ui.taxPickHexId.value = null;

  // Strongholds are placed on the player's own island, whatever the link says.
  // The address bar is rewritten too. A stale rival link would otherwise stay
  // in it, and a click on that rival's row later would not change the hash.
  // The tax phase happens on the player's own island: the dice lie there and
  // the motes fly to its HUD. A back button or a typed link cannot leave it.
  const isLocked = store.game.stage.peek() !== "play" || store.game.phase.peek() === "tax";

  if (isLocked) {
    store.route.page.value = "island";
    store.route.islandPlayerId.value = null;

    if (hash !== ISLAND_PREFIX) {
      window.history.replaceState(null, "", ISLAND_PREFIX);
    }

    return;
  }

  // A skipped cleanup has no level to show: the player waits on the world map.
  if (store.derived.isCleanupSkipped.peek()) {
    store.route.page.value = "world";
    store.route.islandPlayerId.value = null;

    if (hash !== WORLD_HASH) {
      window.history.replaceState(null, "", WORLD_HASH);
    }

    return;
  }

  const fixedPage = PAGE_BY_HASH[hash];
  if (fixedPage) {
    store.route.page.value = fixedPage;
    store.route.islandPlayerId.value = null;

    return;
  }

  if (!hash.startsWith(ISLAND_PREFIX)) {
    store.route.page.value = "island";
    store.route.islandPlayerId.value = null;

    return;
  }

  const rest = hash.slice(ISLAND_PREFIX.length).replace(/^\//, "");

  store.route.page.value = "island";
  store.route.islandPlayerId.value = rest === "" ? null : rest;
};

export { navigateToIslandAction, syncRouteFromHash };
