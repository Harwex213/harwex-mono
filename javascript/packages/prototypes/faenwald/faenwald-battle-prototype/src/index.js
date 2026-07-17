import { Router } from "./modules/router.js";
import { renderMainPage } from "./pages/main-page.js";
import { renderBattleCreation } from "./pages/battle-creation.js";
import { renderBattle } from "./pages/battle.js";

const voidFn = () => void 0;

const main = () => {
  const router = new Router();

  let finalizePage = voidFn;

  router.registerRoute("/", () => {
    finalizePage();
    finalizePage = renderMainPage();
  });

  router.registerRoute("/game", () => {
    finalizePage();
    finalizePage = renderBattleCreation();
  });

  router.registerRoute("/battle", () => {
    finalizePage();
    finalizePage = renderBattle();
  });
};

main();
