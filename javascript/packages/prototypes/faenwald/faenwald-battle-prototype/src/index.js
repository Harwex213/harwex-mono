import { renderBattleCreation } from "./pages/battle-creation.js";
import { renderModifiersCollections } from "./pages/modifiers-collection.js";
import { renderModifiersTable } from "./pages/modifiers-table.js";
import { renderMapsStore } from "./pages/maps-store.js";
import { renderMapEditor } from "./pages/map-editor.js";
import { renderBattle } from "./pages/battle/battle.js";
import { Router } from "./modules/router.js";
import { ROUTES } from "./data/routing.js";

const voidFn = () => void 0;

const PAGES = [
  [ROUTES.BATTLE_CREATION, renderBattleCreation],
  [ROUTES.BATTLE, renderBattle],
  [ROUTES.MODIFIERS_COLLECTIONS, renderModifiersCollections],
  [ROUTES.MODIFIERS, renderModifiersTable],
  [ROUTES.MAPS, renderMapsStore],
  [ROUTES.MAP_EDITOR, renderMapEditor],
];

const registerAllPages = (root, router) => {
  let finalizePage = voidFn;

  const registerPage = (pageRoute, pageHandler) => {
    router.registerRoute(pageRoute, (params) => {
      finalizePage();
      finalizePage = pageHandler({ root, params, router });
    });
  };

  for (const [pageRoute, pageHandler] of PAGES) {
    registerPage(pageRoute, pageHandler);
  }

  router.registerRoute(ROUTES.ROOT, () => {
    router.replace(ROUTES.BATTLE_CREATION);
  });
};

const main = () => {
  const root = document.querySelector("main");
  const router = new Router();

  registerAllPages(root, router);
};

main();
