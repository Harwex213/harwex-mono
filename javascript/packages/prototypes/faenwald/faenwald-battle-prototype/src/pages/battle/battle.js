import { BATTLE_PHASE } from "../../modules/active-battle.js";
import { ROUTES } from "../../data/routing.js";
import { MODEL } from "../../model/model.js";

const BATTLE_PHASE_ROUTES = {
  [BATTLE_PHASE.DISPOSITION]: ROUTES.BATTLE_DISPOSITION,
  [BATTLE_PHASE.ACTIVE]: ROUTES.BATTLE_ACTIVE,
  [BATTLE_PHASE.FINISHED]: ROUTES.BATTLE_FINISHED,
};

const renderBattle = ({ root, router }) => {

  router.registerRoute(ROUTES.ROOT, () => {
    router.replace(ROUTES.BATTLE_CREATION);
  });

  if (MODEL.activeBattle.phase === null) {

  }

  root.innerHTML = `
    ${topNavHtml(router)}
    ${STYLE}
    <section class="ba">
      <h1>Battle</h1>
      ${content}
    </section>
  `;

  return () => {
    root.innerHTML = "";
  };
};

export { renderBattle };
