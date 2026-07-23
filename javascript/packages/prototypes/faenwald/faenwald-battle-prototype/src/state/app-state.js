import { createMaps } from "./maps-state/maps-state.js";
import { createModifiers } from "./modifiers-state/modifiers-state.js";
import { createBattleConfig } from "./battle-config-state/battle-config-state.js";
import { createActiveBattle } from "./active-battle-state/active-battle-state.js";

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
