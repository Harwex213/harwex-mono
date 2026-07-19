import { BATTLE_PHASE } from "../../modules/active-battle.js";
import { ROUTES } from "../../data/routing.js";
import { topNavHtml } from "../../components/top-nav.js";
import { MODEL } from "../../model/model.js";

const BATTLE_PHASE_ROUTES = {
  [BATTLE_PHASE.DISPOSITION]: ROUTES.BATTLE_DISPOSITION,
  [BATTLE_PHASE.ACTIVE]: ROUTES.BATTLE_ACTIVE,
  [BATTLE_PHASE.FINISHED]: ROUTES.BATTLE_FINISHED,
};

const renderBattle = ({ root, router }) => {
  if (MODEL.activeBattle.phase === null) {
    router.replace(ROUTES.BATTLE_CREATION);
    return () => void 0;
  }

  root.innerHTML = `
    ${topNavHtml(router)}
    <section class="ba">
      <h1>Battle</h1>
    </section>
  `;

  return () => {
    root.innerHTML = "";
  };
};

export { renderBattle };
