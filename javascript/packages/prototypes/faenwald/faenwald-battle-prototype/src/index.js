import { renderBattleCreation } from "./pages/battle-creation/battle-creation.js";
import { renderModifiersCollections } from "./pages/modifiers-collection.js";
import { renderModifiersTable } from "./pages/modifiers-table.js";
import { renderMapsStore } from "./pages/maps-store.js";
import { renderMapEditor } from "./pages/map-editor.js";
import { renderBattle } from "./pages/battle/battle.js";
import { renderBattleDisposition } from "./pages/battle/battle-disposition.js";
import { renderBattleActive } from "./pages/battle/battle-active.js";
import { renderBattleFinished } from "./pages/battle/battle-finished.js";
import { Router } from "./modules/router.js";
import { ROUTES } from "./data/routing.js";

const voidFn = () => void 0;

const PAGES = [
  [ROUTES.BATTLE_CREATION, renderBattleCreation],
  [ROUTES.BATTLE_DISPOSITION, renderBattleDisposition],
  [ROUTES.BATTLE_ACTIVE, renderBattleActive],
  [ROUTES.BATTLE_FINISHED, renderBattleFinished],
  [ROUTES.MODIFIERS_COLLECTIONS, renderModifiersCollections],
  [ROUTES.MODIFIERS, renderModifiersTable],
  [ROUTES.MAPS, renderMapsStore],
  [ROUTES.MAP_EDITOR, renderMapEditor],
];

const registerAllPages = (root, router) => {
  let finalizePage = voidFn;
  let navToken = 0;

  const registerPage = (pageRoute, pageHandler) => {
    router.registerRoute(pageRoute, (params) => {
      finalizePage();
      finalizePage = voidFn; // a re-entrant resolve must not re-run this teardown
      const myToken = ++navToken;
      const teardown = pageHandler({ root, params, router });
      if (myToken === navToken) {
        // a nested navigation replaced us — don't clobber its teardown
        finalizePage = teardown ?? voidFn;
      }
    });
  };

  for (const [pageRoute, pageHandler] of PAGES) {
    registerPage(pageRoute, pageHandler);
  }

  router.registerRoute(ROUTES.ROOT, () => {
    router.replace(ROUTES.BATTLE_CREATION);
  });

  router.registerRoute(ROUTES.BATTLE, () => {
    renderBattle({ router });
  });
};

const main = () => {
  const root = document.querySelector("main");
  const router = new Router();

  registerAllPages(root, router);
};

main();
