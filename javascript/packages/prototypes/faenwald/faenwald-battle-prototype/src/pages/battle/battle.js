import { BATTLE_PHASE } from "../../state/active-battle.js";
import { ROUTES } from "../../data/routing.js";
import { MODEL } from "../../model/model.js";

const BATTLE_PHASE_ROUTES = {
  [BATTLE_PHASE.DISPOSITION]: ROUTES.BATTLE_DISPOSITION,
  [BATTLE_PHASE.ACTIVE]: ROUTES.BATTLE_ACTIVE,
  [BATTLE_PHASE.FINISHED]: ROUTES.BATTLE_FINISHED,
};

const renderBattle = ({ router }) => {
  router.replace(BATTLE_PHASE_ROUTES[MODEL.activeBattle.phase] ?? ROUTES.BATTLE_CREATION);
};

export { renderBattle };
