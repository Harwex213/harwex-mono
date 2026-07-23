import { BATTLE_PHASE } from "../../state/active-battle.js";
import { ROUTES } from "../../data/routing.js";

const BATTLE_PHASE_ROUTES = {
  [BATTLE_PHASE.DISPOSITION]: ROUTES.BATTLE_DISPOSITION,
  [BATTLE_PHASE.ACTIVE]: ROUTES.BATTLE_ACTIVE,
  [BATTLE_PHASE.FINISHED]: ROUTES.BATTLE_FINISHED,
};

/**
 * The /battle dispatcher: resolves the current battle phase to its page route.
 *
 * @param {ActiveBattle} activeBattle
 * @returns {string}
 */
const battlePhaseRoute = (activeBattle) =>
  BATTLE_PHASE_ROUTES[activeBattle.phase] ?? ROUTES.BATTLE_CREATION;

export { battlePhaseRoute };
