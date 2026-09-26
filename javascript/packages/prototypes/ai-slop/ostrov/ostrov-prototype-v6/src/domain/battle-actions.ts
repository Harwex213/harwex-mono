import { createBattle, stepBattle } from "../core/battle-sim";
import { growIsland } from "../core/island-gen";
import { createRng, hashSeed } from "../core/rng";
import { buildRoster, getUnit } from "../core/units";
import { replacePlayer } from "./player-updates";
import type { TStore } from "../store/store";
import type { TBattleInput } from "../core/battle-sim";
import type { TRng } from "../core/rng";

/**
 * The clearing phase. The level runs on an animation frame loop; the sim
 * itself is pure and lives in `core/battle-sim.ts`.
 */

/** A frame longer than this is a tab that was in the background. */
const MAX_FRAME_SECONDS = 0.05;

let frameHandle: number | null = null;
let lastFrameMs = 0;
let simRng: TRng | null = null;

const stopLoop = () => {
  if (frameHandle !== null) {
    cancelAnimationFrame(frameHandle);
    frameHandle = null;
  }
};

const startLoop = (store: TStore) => {
  stopLoop();
  lastFrameMs = performance.now();

  const frame = (now: number) => {
    const dt = Math.min(MAX_FRAME_SECONDS, (now - lastFrameMs) / 1000);
    lastFrameMs = now;

    const battle = store.battle.battle.peek();
    if (!battle || battle.status !== "running" || !simRng) {
      frameHandle = null;

      return;
    }

    store.battle.battle.value = stepBattle(battle, dt, simRng);
    frameHandle = requestAnimationFrame(frame);
  };

  frameHandle = requestAnimationFrame(frame);
};

/** Builds the level from the cell the island is over and levies the army. */
const enterClearingAction = (store: TStore) => {
  const player = store.derived.humanPlayer.peek();
  if (!player) {
    return;
  }

  const cell = store.derived.currentCell.peek();
  const turn = store.game.turn.peek();
  const rng = createRng(hashSeed(`${store.game.nickname.peek()}:battle:${turn}`));
  const roster = buildRoster(player.resources.population, store.derived.techEffects.peek().unlockedUnits, rng);

  simRng = rng;
  store.battle.roster.value = roster;
  store.battle.resolved.value = false;
  store.battle.battle.value = createBattle(
    { islandCount: cell && !cell.cleared ? cell.islandCount : 0, turn, roster },
    rng,
  );

  startLoop(store);
};

const setBattleInputAction = (store: TStore, input: Partial<TBattleInput>) => {
  const battle = store.battle.battle.peek();
  if (!battle) {
    return;
  }

  store.battle.battle.value = { ...battle, input: { ...battle.input, ...input } };

  if (frameHandle === null && battle.status === "running") {
    startLoop(store);
  }
};

/**
 * Hands the result back to the island: annexed hexes join it, the people who
 * did not come back are gone, and a cleared cell stays cleared.
 */
const finishBattleAction = (store: TStore) => {
  stopLoop();

  const battle = store.battle.battle.peek();
  const player = store.derived.humanPlayer.peek();
  if (!battle || !player || store.battle.resolved.peek()) {
    return;
  }

  const roster = store.battle.roster.peek();
  const survivors = battle.units.filter((unit) => unit.side === "player").length;
  const lost = roster.slice(survivors);
  const peopleLost = lost.reduce((sum, unitId) => sum + getUnit(unitId).upkeep, 0);
  const rng = createRng(hashSeed(`${store.game.nickname.peek()}:annex:${store.game.turn.peek()}`));

  replacePlayer(store, {
    ...player,
    island: battle.annexedHexes > 0 ? growIsland(player.island, battle.annexedHexes, rng) : player.island,
    army: survivors,
    resources: {
      ...player.resources,
      population: Math.max(0, player.resources.population - peopleLost),
    },
  });

  const world = store.world.world.peek();
  if (world && battle.status === "won") {
    store.world.world.value = {
      cells: world.cells.map((cell) => {
        return cell.id === player.cellId ? { ...cell, cleared: true, islandCount: 0 } : cell;
      }),
    };
  }

  store.battle.resolved.value = true;
};

export { enterClearingAction, finishBattleAction, setBattleInputAction, stopLoop };
