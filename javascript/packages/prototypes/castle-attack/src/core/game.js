import { signal } from "@hw/signals";

const ATTACK_TYPE = {
  MELEE: "MELEE",

};

class Unit {
  x = -1;
  y = -1;

  viewRange = -1;
  armor = -1;
  health = -1;
  maxHealth = -1;

  regenPerTick = -1;
  attackType = -1;
  attackRange = -1;
  attackPerAction = -1;
  healPerAction = -1;
  movementPerAction = -1;

  lastTickAmount = -1;
  actionPerTick = -1;
  actions = -1;
}

const GAME_STATE = {
  NOT_STARTED: "NOT_STARTED",
  RUNNING: "RUNNING",
  PAUSED: "PAUSED",
};

class Game {
  state;
  tick;
  map;

  constructor(width, height) {
    this.state = signal(GAME_STATE.NOT_STARTED);
    this.tick = signal(0);
    this.map = {
      width,
      height,
      grid: [...Array(width)].map((_) => [...Array(height)]),
    };
  }

  #doActions() {

  }

  #doRegen() {

  }

  nextTick() {
    if (this.state.peek() !== GAME_STATE.RUNNING) {
      return;
    }


    this.tick.value = this.tick.peek() + 1;
  }

  spawnUnit(row, col) {

  }
}

export { Game };