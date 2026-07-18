import { renderBattleCreation } from "./pages/battle-creation.js";
import { renderBattle } from "./pages/battle.js";
import { renderModifiersCollections } from "./pages/modifiers-collection.js";
import { renderModifiersTable } from "./pages/modifiers-table.js";
import { renderMapsStore } from "./pages/maps-store.js";
import { renderMapEditor } from "./pages/map-editor.js";
import { Router } from "./modules/router.js";
import { ROUTES } from "./data/routing.js";

const voidFn = () => void 0;

const PAGES = [
  [ROUTES.GAME, renderBattleCreation],
  [ROUTES.BATTLE, renderBattle],
  [ROUTES.MODIFIERS_COLLECTIONS, renderModifiersCollections],
  [ROUTES.MODIFIERS, renderModifiersTable],
  [ROUTES.MAPS, renderMapsStore],
  [ROUTES.MAP_EDITOR, renderMapEditor],
];

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
};

const main = () => {
  const router = new Router();

  registerAllPages(router);
};

main();
