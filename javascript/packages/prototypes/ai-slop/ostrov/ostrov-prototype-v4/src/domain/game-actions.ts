import { finishBattleAction, startBattleAction } from "./battle-actions";
import { navigateAction } from "./route-actions";
import { startTaxPhaseAction } from "./tax-actions";
import { beginExplorationAction } from "./world-actions";
import { createIsland, createRng, createWorld, INITIAL_RESOURCES } from "../core/exports";
import { FIRST_TURN, NO_SEED, PHASE_NAMES_RU } from "../store/game-state";
import { HUMAN_PLAYER_ID } from "../store/store";
import { PLAYER_COLOURS } from "../ui/palette";
import type { TIsland, TPhase, TPlayer, TResources, TWorldCell } from "../core/exports";
import type { TLogEntry } from "../store/game-state";
import type { TStore } from "../store/store";

/**
 * The turn loop and the two resource actions that hang off it. Every body reads
 * with `.peek()` and writes with `.value =`, and every value written is a fresh
 * immutable one.
 */

/** `Date.now()` is far too large to read in a log line, so the seed is its remainder. */
const SEED_MODULO = 100000;

const DEFAULT_NICKNAME = "Игрок";

/** The three AI players are rows in the player list. They never take a turn. */
const AI_PLAYER_SEEDS: readonly { readonly id: string; readonly nickname: string; readonly colour: string }[] = [
  { id: "p2", nickname: "Carribean Sorcerer", colour: PLAYER_COLOURS.teal },
  { id: "p3", nickname: "Blue Sorcerer", colour: PLAYER_COLOURS.blue },
  { id: "p4", nickname: "Orange Sorcerer", colour: PLAYER_COLOURS.orange },
];

const AI_START_ARMY_MIN = 3;
const AI_START_ARMY_MAX = 8;
const AI_START_BUILDINGS_MIN = 8;
const AI_START_BUILDINGS_MAX = 20;
const AI_START_TECHS_MIN = 10;
const AI_START_TECHS_MAX = 16;
const HUMAN_START_ARMY_MIN = 1;
const HUMAN_START_ARMY_MAX = 3;

const AI_ARMY_GAIN_MAX = 2;
const AI_BUILDING_GAIN_MAX = 1;
const AI_TECH_EVERY_TURNS = 4;

const CALM_MANA_COST = 3;
const CALM_FOOD_COST = 2;
const CALM_CURED = 1;
const ASYLUM_MANA_COST = 2;
const ASYLUM_CURED = 3;
const MAX_CALM_USES_PER_TURN = 5;

const TOAST_MS = 2000;

/** The world cell the human island starts on, when the generated world names none. */
const FALLBACK_START_CELL_ID = 0;

let toastTimerId: number | null = null;

const appendLogEntry = (store: TStore, turn: number, phase: TPhase, textRu: string): void => {
  const entry: TLogEntry = { turn, phase, textRu };

  store.game.log.value = [...store.game.log.peek(), entry];
};

/**
 * `WORLD_START_CELL_ID` is not part of the core contract, so the starting cell
 * is the one the generator already handed to the human player.
 */
const findStartCellId = (cells: readonly TWorldCell[]): number => {
  const own = cells.find((cell) => cell.occupantId === HUMAN_PLAYER_ID);
  if (own !== undefined) {
    return own.id;
  }

  return FALLBACK_START_CELL_ID;
};

/** Sets the seed by hand, for the dev hook and the probe. `startGame` then keeps it. */
const setSeedAction = (store: TStore, seed: number): void => {
  store.game.seed.value = seed;
};

const showToastAction = (store: TStore, text: string): void => {
  store.ui.toast.value = text;

  if (toastTimerId !== null) {
    window.clearTimeout(toastTimerId);
  }

  toastTimerId = window.setTimeout(() => {
    toastTimerId = null;
    store.ui.toast.value = null;
  }, TOAST_MS);
};

const dismissEventModalAction = (store: TStore): void => {
  store.ui.eventModal.value = null;
};

const startGameAction = (store: TStore, nickname: string): void => {
  const existingSeed = store.game.seed.peek();
  const seed = existingSeed === NO_SEED ? Date.now() % SEED_MODULO : existingSeed;
  const rng = createRng(seed);

  const trimmedNickname = nickname.trim();
  const human: TPlayer = {
    id: HUMAN_PLAYER_ID,
    nickname: trimmedNickname === "" ? DEFAULT_NICKNAME : trimmedNickname,
    colour: PLAYER_COLOURS.green,
    isHuman: true,
    army: rng.int(HUMAN_START_ARMY_MIN, HUMAN_START_ARMY_MAX),
    buildingCount: 0,
    techCount: 0,
  };

  const players: readonly TPlayer[] = [
    human,
    ...AI_PLAYER_SEEDS.map((seedPlayer) => {
      return {
        id: seedPlayer.id,
        nickname: seedPlayer.nickname,
        colour: seedPlayer.colour,
        isHuman: false,
        army: rng.int(AI_START_ARMY_MIN, AI_START_ARMY_MAX),
        buildingCount: rng.int(AI_START_BUILDINGS_MIN, AI_START_BUILDINGS_MAX),
        techCount: rng.int(AI_START_TECHS_MIN, AI_START_TECHS_MAX),
      };
    }),
  ];

  const islands = players.reduce((byOwner, player, index) => {
    byOwner[player.id] = createIsland(seed + index, player.id);

    return byOwner;
  }, {} as Record<string, TIsland>);

  const worldCells = createWorld(seed);

  store.game.seed.value = seed;
  store.game.players.value = players;
  store.game.islands.value = islands;
  store.game.resources.value = INITIAL_RESOURCES;
  store.game.worldCells.value = worldCells;
  store.game.islandCellId.value = findStartCellId(worldCells);
  store.game.turn.value = FIRST_TURN;
  store.game.phase.value = "build";
  store.game.researching.value = null;
  store.game.researched.value = [];
  store.game.researchProgress.value = {};
  store.game.pendingEnemies.value = 0;
  store.game.calmUsesThisTurn.value = 0;
  store.game.battle.value = null;
  store.game.busy.value = false;
  store.game.log.value = [];
  store.game.started.value = true;

  appendLogEntry(store, FIRST_TURN, "build", `Остров основан, сид ${seed}`);

  navigateAction(store, "island");
};

/** The three AI players only advance their three displayed counters, on a seeded rule. */
const advanceAiCounters = (store: TStore, completedTurn: number, nextTurn: number): void => {
  const rng = createRng(store.game.seed.peek() + completedTurn);
  const grantsTech = nextTurn % AI_TECH_EVERY_TURNS === 0;

  store.game.players.value = store.game.players.peek().map((player) => {
    if (player.isHuman) {
      return player;
    }

    return {
      ...player,
      army: player.army + rng.int(0, AI_ARMY_GAIN_MAX),
      buildingCount: player.buildingCount + rng.int(0, AI_BUILDING_GAIN_MAX),
      techCount: player.techCount + (grantsTech ? 1 : 0),
    };
  });
};

const endTurnAction = (store: TStore): void => {
  if (store.game.busy.peek()) {
    return;
  }

  const phase = store.game.phase.peek();
  const turn = store.game.turn.peek();

  switch (phase) {
    case "build": {
      // The tax phase stays on the island page: the payouts have to fly to the
      // HUD that is on screen. `startTaxPhase` writes the phase and the log line
      // itself, and holds `busy` until the animation ends.
      startTaxPhaseAction(store);
      break;
    }

    case "tax": {
      store.game.phase.value = "exploration";
      appendLogEntry(store, turn, "exploration", `Ход ${turn}: ${PHASE_NAMES_RU.exploration}`);
      navigateAction(store, "world");
      // The trail grows and rolls its event only after the phase is the current one,
      // because both the log line and the event modal read the phase back.
      beginExplorationAction(store);
      break;
    }

    case "exploration": {
      store.game.phase.value = "clearing";
      appendLogEntry(store, turn, "clearing", `Ход ${turn}: ${PHASE_NAMES_RU.clearing}`);
      navigateAction(store, "battle");
      // The level is built after the route already points at the battle page, so
      // the canvas mounts on a level that exists. `startBattle` holds `busy`.
      startBattleAction(store);
      break;
    }

    case "clearing": {
      const nextTurn = turn + 1;

      // The absorbed hexes and the surviving army land while the phase is still
      // `clearing`, because the log line reads the phase back.
      finishBattleAction(store);
      store.game.turn.value = nextTurn;
      store.game.phase.value = "build";
      store.game.calmUsesThisTurn.value = 0;
      advanceAiCounters(store, turn, nextTurn);
      appendLogEntry(store, nextTurn, "build", `Ход ${nextTurn}: ${PHASE_NAMES_RU.build}`);
      navigateAction(store, "island");
      break;
    }
  }
};

/**
 * "Успокоить": spend mana and food to turn 🤖 back into 🧍, at most five times a
 * turn. `asylum` makes one use cure three for less mana.
 */
const calmAction = (store: TStore): void => {
  const uses = store.game.calmUsesThisTurn.peek();
  if (uses >= MAX_CALM_USES_PER_TURN) {
    showToastAction(store, `Успокоить можно не больше ${MAX_CALM_USES_PER_TURN} раз за ход`);

    return;
  }

  const resources = store.game.resources.peek();
  if (resources.insane <= 0) {
    showToastAction(store, "Сумасшедших нет");

    return;
  }

  const hasAsylum = store.game.researched.peek().includes("asylum");
  const manaCost = hasAsylum ? ASYLUM_MANA_COST : CALM_MANA_COST;
  const cured = Math.min(hasAsylum ? ASYLUM_CURED : CALM_CURED, resources.insane);

  if (resources.mana < manaCost || resources.food < CALM_FOOD_COST) {
    showToastAction(store, `Не хватает ресурсов: нужно ${manaCost} 💠 и ${CALM_FOOD_COST} 🍗`);

    return;
  }

  const next: TResources = {
    ...resources,
    mana: resources.mana - manaCost,
    food: resources.food - CALM_FOOD_COST,
    insane: resources.insane - cured,
    population: resources.population + cured,
  };

  store.game.resources.value = next;
  store.game.calmUsesThisTurn.value = uses + 1;

  appendLogEntry(store, store.game.turn.peek(), store.game.phase.peek(), `Успокоено сумасшедших: ${cured}`);
};

export {
  TOAST_MS,
  calmAction,
  dismissEventModalAction,
  endTurnAction,
  setSeedAction,
  showToastAction,
  startGameAction,
};
