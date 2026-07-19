import { createBattle } from "../modules/active-battle.js";
import { BATTLE_CONFIG_MODULE } from "../modules/battle-config.js";

const MODEL = {
  battleConfig: BATTLE_CONFIG_MODULE.create(),
  activeBattle: createBattle(),
};

export { MODEL };