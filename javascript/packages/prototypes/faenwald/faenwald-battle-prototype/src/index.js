import { renderBattleCreation } from "./pages/battle-creation.js";
import { renderBattleDisposition } from "./pages/battle-disposition.js";
import { renderBattleActive } from "./pages/battle-active.js";
import { renderBattleFinished } from "./pages/battle-finished.js";
import { renderModifiersCollections } from "./pages/modifiers-collection.js";
import { renderModifiersTable } from "./pages/modifiers-table.js";
import { renderMapsStore } from "./pages/maps-store.js";
import { renderMapEditor } from "./pages/map-editor.js";
import { BATTLE_PHASE, activeBattle } from "./modules/active-battle.js";
import { Router } from "./modules/router.js";
import { ROUTES } from "./data/routing.js";

const voidFn = () => void 0;

const PAGES = [
  [ROUTES.GAME, renderBattleCreation],
  [ROUTES.BATTLE_DISPOSITION, renderBattleDisposition],
  [ROUTES.BATTLE_ACTIVE, renderBattleActive],
  [ROUTES.BATTLE_FINISHED, renderBattleFinished],
  [ROUTES.MODIFIERS_COLLECTIONS, renderModifiersCollections],
  [ROUTES.MODIFIERS, renderModifiersTable],
  [ROUTES.MAPS, renderMapsStore],
  [ROUTES.MAP_EDITOR, renderMapEditor],
];

const BATTLE_PHASE_ROUTES = {
  [BATTLE_PHASE.DISPOSITION]: ROUTES.BATTLE_DISPOSITION,
  [BATTLE_PHASE.ACTIVE]: ROUTES.BATTLE_ACTIVE,
  [BATTLE_PHASE.FINISHED]: ROUTES.BATTLE_FINISHED,
};

const registerAllPages = (router) => {
  let finalizePage = voidFn;

  for (const [pageRoute, pageHandler] of PAGES) {
    router.registerRoute(pageRoute, (params) => {
      finalizePage();
      finalizePage = pageHandler(params);
    });
  }

  // "/" is a redirect, not a page: the top nav replaced the landing screen.
  // Registered outside the teardown handshake — it renders nothing, and the
  // target route's handler finalizes whatever page came before.
  router.registerRoute(ROUTES.ROOT, () => {
    router.replace(ROUTES.GAME);
  });

  // "/battle" is a redirect too: it forwards to the subpage for the current
  // battle phase, or back to setup when no battle has been started
  router.registerRoute(ROUTES.BATTLE, () => {
    router.replace(BATTLE_PHASE_ROUTES[activeBattle.phase] ?? ROUTES.GAME);
  });
};

const main = () => {
  const router = new Router();

  registerAllPages(router);
};

main();
