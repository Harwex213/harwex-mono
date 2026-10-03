import { showToastAction } from "./game-actions";
import {
  BATTLE_TICK_MS,
  addHexesToIsland,
  createBattleLevel,
  stepBattle,
} from "../core/exports";
import { HUMAN_PLAYER_ID } from "../store/store";
import type { TBattleInput, TBattleState, THex, TIsland, TPhase } from "../core/exports";
import type { TLogEntry } from "../store/game-state";
import type { TStore } from "../store/store";

/**
 * The clearing phase (plan §3.8). `src/core/battle-sim.ts` owns every rule; the
 * actions here only start a level, feed it real time, and write the result back
 * into the game state when the phase ends.
 */

/** A tab switch hands the loop one huge frame. Anything longer than this is cut. */
const MAX_TICK_MS = 100;

/** The level seed is derived from the game seed so two runs of the probe see one board. */
const BATTLE_SEED_TURN_STEP = 101;

const NO_UNITS = 0;

/** The last input the canvas sent. `stepBattleTicks` replays the level with it. */
let currentInput: TBattleInput = { up: false, down: false, left: false, right: false };

/** How many player units the level started with, so the report can name the losses. */
let startingPlayerUnits = NO_UNITS;

const appendLogEntry = (store: TStore, turn: number, phase: TPhase, textRu: string): void => {
  const entry: TLogEntry = { turn, phase, textRu };

  store.game.log.value = [...store.game.log.peek(), entry];
};

const countUnits = (battle: TBattleState, side: "player" | "enemy"): number => {
  return battle.units.filter((unit) => unit.side === side).length;
};

/**
 * Writes a stepped level back. The level is finished exactly once, and that is
 * where the end-turn button becomes clickable again.
 */
const applySteppedBattle = (store: TStore, previous: TBattleState, next: TBattleState): void => {
  store.game.battle.value = next;

  if (previous.finished === true || next.finished === false) {
    return;
  }

  store.game.busy.value = false;
  showToastAction(store, "Уровень зачищен");
  appendLogEntry(store, store.game.turn.peek(), store.game.phase.peek(), "Уровень зачищен");
};

/** Builds the level for this turn. The exploration → clearing branch is the caller. */
const startBattleAction = (store: TStore): void => {
  const island = store.game.islands.peek()[HUMAN_PLAYER_ID];
  if (island === undefined) {
    return;
  }

  const turn = store.game.turn.peek();
  const seed = store.game.seed.peek() + turn * BATTLE_SEED_TURN_STEP;
  const battle = createBattleLevel(
    seed,
    island,
    turn,
    store.game.pendingEnemies.peek(),
    store.game.researched.peek(),
  );

  currentInput = { up: false, down: false, left: false, right: false };
  startingPlayerUnits = countUnits(battle, "player");

  store.game.battle.value = battle;
  store.game.pendingEnemies.value = 0;
  store.game.busy.value = true;
  store.ui.battleRetreated.value = false;

  appendLogEntry(
    store,
    turn,
    store.game.phase.peek(),
    `Зачистка началась: ${battle.enemyIslands.length} вражеских островов`,
  );
};

/** One animation frame of the level. The battle canvas is the only caller. */
const battleTickAction = (store: TStore, dtMs: number, input: TBattleInput): void => {
  const battle = store.game.battle.peek();
  if (battle === null || battle.finished === true) {
    return;
  }

  currentInput = input;
  const clampedDtMs = Math.max(0, Math.min(MAX_TICK_MS, dtMs));

  applySteppedBattle(store, battle, stepBattle(battle, clampedDtMs, input));
};

/**
 * Runs whole ticks synchronously, for the dev hook and the probe. `input`
 * defaults to whatever the canvas last sent, so a probe can steer the island
 * without a frame loop by passing it here.
 */
const stepBattleTicksAction = (store: TStore, ticks: number, input?: TBattleInput): void => {
  const battle = store.game.battle.peek();
  if (battle === null) {
    return;
  }

  if (input !== undefined) {
    currentInput = input;
  }

  let next = battle;
  for (let tick = 0; tick < ticks; tick += 1) {
    next = stepBattle(next, BATTLE_TICK_MS, currentInput);
  }

  applySteppedBattle(store, battle, next);
};

/** A debug cheat: every enemy drops to zero hp and dies on the next tick. */
const killAllEnemiesAction = (store: TStore): void => {
  const battle = store.game.battle.peek();
  if (battle === null) {
    return;
  }

  store.game.battle.value = {
    ...battle,
    units: battle.units.map((unit) => {
      if (unit.side !== "enemy") {
        return unit;
      }

      return { ...unit, hp: 0 };
    }),
  };
};

/** Ends the level on the spot. Whatever was absorbed so far is kept. */
const retreatAction = (store: TStore): void => {
  const battle = store.game.battle.peek();
  if (battle === null || battle.finished === true) {
    return;
  }

  store.game.battle.value = { ...battle, finished: true };
  store.game.busy.value = false;
  store.ui.battleRetreated.value = true;

  appendLogEntry(store, store.game.turn.peek(), store.game.phase.peek(), "Отступление с уровня");
};

/**
 * Applies the level result to the game: the absorbed hexes join the island with
 * their biomes but bare and clean, and the army counter becomes the survivors.
 * The clearing → build branch calls this before the turn advances.
 */
const finishBattleAction = (store: TStore): void => {
  const battle = store.game.battle.peek();
  if (battle === null) {
    return;
  }

  const islands = store.game.islands.peek();
  const island = islands[HUMAN_PLAYER_ID];
  const survivors = countUnits(battle, "player");
  const lost = Math.max(0, startingPlayerUnits - survivors);
  let joined = 0;

  if (island !== undefined) {
    const arriving: readonly THex[] = battle.absorbedHexes.map((hex) => {
      return { ...hex, building: null, toxicity: 0 };
    });
    const grown: TIsland = addHexesToIsland(island, arriving);
    joined = Object.keys(grown.hexes).length - Object.keys(island.hexes).length;

    store.game.islands.value = { ...islands, [HUMAN_PLAYER_ID]: grown };
  }

  store.game.players.value = store.game.players.peek().map((player) => {
    if (player.id !== HUMAN_PLAYER_ID) {
      return player;
    }

    return { ...player, army: survivors };
  });

  appendLogEntry(
    store,
    store.game.turn.peek(),
    store.game.phase.peek(),
    `Присоединено ${joined} гексов, потеряно ${lost} юнитов`,
  );

  startingPlayerUnits = NO_UNITS;
  store.game.battle.value = null;
  store.game.busy.value = false;
  store.ui.battleRetreated.value = false;
};

export {
  MAX_TICK_MS,
  battleTickAction,
  finishBattleAction,
  killAllEnemiesAction,
  retreatAction,
  startBattleAction,
  stepBattleTicksAction,
};
