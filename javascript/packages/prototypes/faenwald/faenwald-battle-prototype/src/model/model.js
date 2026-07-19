import { ACTIVE_BATTLE_MODULE } from "../modules/active-battle.js";
import { BATTLE_CONFIG_MODULE } from "../modules/battle-config.js";
import { MAPS_MODULE } from "../modules/maps.js";
import { MODIFIERS_MODULE } from "../modules/modifiers.js";

// the composition root is the only place the environment (localStorage) is handed to modules;
// persistence-backed state hydrates before battleConfig reads it for its default map

const maps = MAPS_MODULE.create({ storage: localStorage });
MAPS_MODULE.hydrate(maps);

const modifiers = MODIFIERS_MODULE.create({ storage: localStorage });
MODIFIERS_MODULE.hydrate(modifiers);

const MODEL = {
  maps: maps,
  modifiers: modifiers,
  battleConfig: BATTLE_CONFIG_MODULE.create(maps),
  activeBattle: ACTIVE_BATTLE_MODULE.create(),
};

export { MODEL };
