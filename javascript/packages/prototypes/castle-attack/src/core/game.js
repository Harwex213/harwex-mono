import { signal } from "@hw/signals";

class Unit {
  //region properties

  /**
   * текущая позиция по оси X
   * @type {number}
   */
  x = 0;

  /**
   текущая позиция по оси Y
   * @type {number}
   */
  y = 0;

  /**
   * дальность видимости юнита
   * @type {number}
   */
  viewRange = 0;

  /**
   * на сколько уменьшить урон
   * @type {number}
   */
  armor = 0;

  /**
   * текущий показатель здоровья
   * @type {number}
   */
  health = 0;

  maxHealth = 0;

  /**
   * естественное восстановление здоровья
   * @type {number}
   */
  regenPerTick = -1;

  /**
   * насколько сильно юнит дотягивается для удара
   * @type {number}
   */
  attackRange = -1;

  /**
   * значение урона другому юниту за действие
   * @type {number}
   */
  attackPerAction = -1;

  /**
   * на сколько хилит хп другому юниту за действие
   * @type {number}
   */
  healPerAction = -1;

  /**
   * на сколько двигается за действие
   * @type {number}
   */
  movementPerAction = -1;

  /**
   * сколько действий может сделать за тик
   * @type {number}
   */
  actionPerTick = -1;

  //endregion
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

  nextTick() {
    if (this.state.peek() !== GAME_STATE.RUNNING) {
      return;
    }


    this.tick.value = this.tick.peek() + 1;
  }

  spawnRace() {

  }

  spawnUnit() {

  }
}

export { Game };