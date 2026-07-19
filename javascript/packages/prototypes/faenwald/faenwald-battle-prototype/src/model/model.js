import { ACTIVE_BATTLE_MODULE } from "../modules/active-battle.js";
import { BATTLE_CONFIG_MODULE } from "../modules/battle-config.js";

const MODEL = {
  battleConfig: BATTLE_CONFIG_MODULE.create(),
  activeBattle: ACTIVE_BATTLE_MODULE.create(),
};

export { MODEL };