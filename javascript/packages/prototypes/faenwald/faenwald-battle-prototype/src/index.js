import { renderMainPage } from "./pages/main-page.js";
import { renderBattleCreation } from "./pages/battle-creation.js";
import { renderBattle } from "./pages/battle.js";
import { renderModifiersCollections } from "./pages/modifiers-collection.js";
import { renderModifiersTable } from "./pages/modifiers-table.js";
import { Router } from "./modules/router.js";
import { ROUTES } from "./data/routing.js";

const voidFn = () => void 0;

const PAGES = [
  [ROUTES.ROOT, renderMainPage],
  [ROUTES.GAME, renderBattleCreation],
  [ROUTES.BATTLE, renderBattle],
  [ROUTES.MODIFIERS_COLLECTIONS, renderModifiersCollections],
  [ROUTES.MODIFIERS, renderModifiersTable],
];

const registerAllPages = (router) => {
  let finalizePage = voidFn;

  for (const [pageRoute, pageHandler] of PAGES) {
    router.registerRoute(pageRoute, (params) => {
      finalizePage();
      finalizePage = pageHandler(params);
    });
  }
};

const main = () => {
  const router = new Router();

  registerAllPages(router);
};

main();
