import { createMaps } from "./maps.js";
import { createModifiers } from "./modifiers.js";
import { createBattleConfig } from "./battle-config.js";
import { createActiveBattle } from "./active-battle.js";

/**
 * @returns {AppState}
 */
const createInitialState = () => {
  const maps = createMaps();
  return {
    maps,
    modifiers: createModifiers(),
    battleConfig: createBattleConfig(maps),
    activeBattle: createActiveBattle(),
  };
};

export { createInitialState };
