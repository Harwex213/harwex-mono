import { ACTIVE_BATTLE_PHASE } from "./constants/battle.js";
import { ACTIVE_BATTLE_COMMANDS } from "./constants/battle-commands.js";
import { moveUnit } from "./handlers/move-unit.js";
import { rotateUnit } from "./handlers/rotate-unit.js";
import { accelerateUnit } from "./handlers/accelerate-unit.js";
import { attackUnit } from "./handlers/attack-unit.js";

const BATTLE_COMMAND_TO_HANDLER = {
  [ACTIVE_BATTLE_COMMANDS.MOVE_UNIT]: moveUnit,
  [ACTIVE_BATTLE_COMMANDS.ROTATE_UNIT]: rotateUnit,
  [ACTIVE_BATTLE_COMMANDS.ACCELERATE_UNIT]: accelerateUnit,
  [ACTIVE_BATTLE_COMMANDS.ATTACK_UNIT]: attackUnit,
};

class ActiveBattleFMS {
  #nextUnitId = 0;

  constructor(state) {
    this.state = state;
  }

  startBattleDisposition(map, attackerUnits, defenderUnits) {
    const state = this.state;

    if (state.phase !== null) {
      return;
    }

    state.phase = ACTIVE_BATTLE_PHASE.DISPOSITION;
    state.map = map;

    const mapToActiveBattleUnit = (unit) => {
      return {
        id: this.#nextUnitId++,
        type: unit.type,
        name: unit.name,
        hp: unit.hp,
        maxMap: unit.hp,
        attack: unit.attack,
        morale: unit.morale,
        speed: unit.speed,
        position: null,
        facing: unit.facing,
        movePoints: 0,
      }
    };

    state.attackerUnits = attackerUnits.map(mapToActiveBattleUnit);
    state.defenderUnits = defenderUnits.map(mapToActiveBattleUnit);
  }
}

class ActiveBattle {
  constructor() {
    this.state = {
      phase: null,
      map: null,
      attackerUnits: [],
      defenderUnits: [],
      round: 0,
      activeGroup: null,
      log: [],
      winner: null,
    };

    this.fms = new ActiveBattleFMS(this.state);
  }

  command(type, params) {
    const handler = BATTLE_COMMAND_TO_HANDLER[type];

    if (handler) {
      handler(this.state, params);
    }
  }
}

export { ActiveBattle };
