import { BATTLE_STEP, aliveCount, createSimulation, stepSimulation } from "../battle/simulation";
import { START_GOLD, START_LIVES } from "../../store/store";
import { createStartingRoster, generateEnemyRoster, rollShopOffers } from "../game/roster";
import { pushLog } from "./log-actions";
import type { TSimulation } from "../battle/types";
import type { TStore } from "../../store/store";

/** Frame time is capped so a background tab does not fast-forward the fight. */
const MAX_FRAME_SECONDS = 0.25;

/** Guard against a spiral of death when the machine cannot keep up. */
const MAX_STEPS_PER_FRAME = 40;

const drainEvents = (store: TStore, sim: TSimulation): void => {
  if (sim.events.length === 0) {
    return;
  }

  for (const text of sim.events) {
    pushLog(store, text);
  }

  sim.events.length = 0;
};

const finishBattle = (store: TStore, sim: TSimulation): void => {
  const round = store.metaState.round.peek();

  // One last tick, so the panels read the state the battle actually ended in
  // instead of the snapshot from an eighth of a second earlier.
  store.battleState.tick.value = store.battleState.tick.peek() + 1;
  store.metaState.phase.value = "result";
  store.battleState.outcome.value = sim.outcome;

  if (sim.outcome === "player") {
    const reward = 5 + Math.min(5, round);
    store.metaState.gold.value = store.metaState.gold.peek() + reward;
    store.metaState.wins.value = store.metaState.wins.peek() + 1;
    pushLog(store, `Раунд ${round} выигран, награда ${reward} з.`);
  } else if (sim.outcome === "enemy") {
    const survivors = aliveCount(sim, "enemy");
    const damage = 1 + survivors;
    store.metaState.gold.value = store.metaState.gold.peek() + 3;
    store.metaState.lives.value = Math.max(0, store.metaState.lives.peek() - damage);
    pushLog(store, `Раунд ${round} проигран, остров теряет ${damage} ед. прочности`);
  } else {
    store.metaState.gold.value = store.metaState.gold.peek() + 4;
    pushLog(store, `Раунд ${round} свёлся вничью`);
  }

  if (store.metaState.lives.peek() > 0) {
    return;
  }

  store.metaState.phase.value = "over";
  pushLog(store, "Остров пал. Начните заново.");
};

const startBattleAction = (store: TStore): void => {
  if (store.metaState.phase.peek() !== "prep") {
    return;
  }

  const player = store.rosterState.player.peek();
  if (player.length === 0) {
    pushLog(store, "Некому воевать — наймите хотя бы одного бойца");

    return;
  }

  store.battleState.sim.value = createSimulation([...player, ...store.rosterState.enemy.peek()]);
  store.battleState.outcome.value = null;
  store.battleState.tick.value = 0;
  store.metaState.paused.value = false;
  store.metaState.phase.value = "battle";
  store.viewState.draggingId.value = null;
  pushLog(store, `Бой ${player.length} против ${store.rosterState.enemy.peek().length}`);
};

/** Called once per animation frame by the arena canvas. */
const advanceBattleAction = (store: TStore, frameSeconds: number): void => {
  if (store.metaState.phase.peek() !== "battle") {
    return;
  }

  const sim = store.battleState.sim.peek();
  if (!sim || sim.outcome !== "running" || store.metaState.paused.peek()) {
    return;
  }

  sim.carry += Math.min(MAX_FRAME_SECONDS, frameSeconds) * store.metaState.speed.peek();

  let steps = 0;
  while (sim.carry >= BATTLE_STEP && steps < MAX_STEPS_PER_FRAME) {
    stepSimulation(sim, BATTLE_STEP);
    sim.carry -= BATTLE_STEP;
    steps += 1;

    if (sim.outcome !== "running") {
      sim.carry = 0;
      break;
    }
  }

  drainEvents(store, sim);

  // The canvas redraws itself every frame; the panels only need a few updates
  // a second, so the tick counts eighths of a battle second.
  const tick = Math.floor(sim.time * 8);
  if (tick !== store.battleState.tick.peek()) {
    store.battleState.tick.value = tick;
  }

  if (sim.outcome !== "running") {
    finishBattle(store, sim);
  }
};

const setSpeedAction = (store: TStore, speed: number): void => {
  store.metaState.speed.value = speed;
};

const togglePauseAction = (store: TStore): void => {
  store.metaState.paused.value = !store.metaState.paused.peek();
};

const nextRoundAction = (store: TStore): void => {
  if (store.metaState.phase.peek() !== "result") {
    return;
  }

  const round = store.metaState.round.peek() + 1;
  const income = 4 + Math.min(4, round);

  store.metaState.round.value = round;
  store.metaState.gold.value = store.metaState.gold.peek() + income;
  store.metaState.phase.value = "prep";
  store.rosterState.enemy.value = generateEnemyRoster(store.rng, round);
  store.shopState.offers.value = rollShopOffers(store.rng);
  store.battleState.sim.value = null;
  store.battleState.outcome.value = null;
  pushLog(store, `Раунд ${round}: доход ${income} з.`);
};

const restartGameAction = (store: TStore): void => {
  store.metaState.round.value = 1;
  store.metaState.gold.value = START_GOLD;
  store.metaState.lives.value = START_LIVES;
  store.metaState.wins.value = 0;
  store.metaState.speed.value = 1;
  store.metaState.paused.value = false;
  store.metaState.phase.value = "prep";
  store.rosterState.player.value = createStartingRoster(store.rng);
  store.rosterState.enemy.value = generateEnemyRoster(store.rng, 1);
  store.rosterState.selectedId.value = null;
  store.shopState.offers.value = rollShopOffers(store.rng);
  store.battleState.sim.value = null;
  store.battleState.outcome.value = null;
  store.battleState.tick.value = 0;
  store.metaState.log.value = [];
  pushLog(store, "Новая партия: раунд 1");
};

export { advanceBattleAction, nextRoundAction, restartGameAction, setSpeedAction, startBattleAction, togglePauseAction };
