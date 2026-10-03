import { createRng, hashSeed } from "../core/rng";
import { totalToxicity } from "../core/tax";
import { rollTrailEvent } from "../core/trail-events";
import { getCell } from "../core/world-gen";
import { moveCheck, scoutCheck } from "../core/world-rules";
import { replacePlayer } from "./player-updates";
import { WAITING_NOTICE } from "./ready-actions";
import { showNotice } from "./ui-actions";
import type { TStore } from "../store/store";
import type { TWorld } from "../core/world-gen";

/**
 * The exploration phase, on the global map. The player spends scouting to
 * reveal one chosen cell at a time and may fly the island one cell over.
 * Staying dumps the island's toxicity into the cell as a trail that never
 * fades. The rules themselves live in `core/world-rules.ts`.
 */

const writeWorld = (store: TStore, world: TWorld) => {
  store.world.world.value = world;
};

/**
 * Scouting and the flight belong to the scout phase. They are refused once the
 * player has pressed "Готов"; a notice says why.
 */
const isExplorationOpen = (store: TStore) => {
  if (store.game.stage.peek() !== "play" || store.game.phase.peek() !== "scout") {
    return false;
  }

  if (store.derived.isHumanReady.peek()) {
    showNotice(store, WAITING_NOTICE);

    return false;
  }

  return true;
};

const selectWorldCellAction = (store: TStore, cellId: string) => {
  store.world.selectedCellId.value = cellId;
};

/** Opens the phase: nothing is spent yet, and no flight has been made. */
const enterExplorationAction = (store: TStore) => {
  const player = store.derived.humanPlayer.peek();

  store.world.movedThisTurn.value = false;
  store.world.selectedCellId.value = player?.cellId ?? null;
};

/** Spends scouting on one frontier cell and reveals what is in it. */
const scoutAction = (store: TStore, cellId: string) => {
  if (!isExplorationOpen(store)) {
    return;
  }

  const player = store.derived.humanPlayer.peek();
  const world = store.world.world.peek();
  if (!player || !world) {
    return;
  }

  const check = scoutCheck(world, player.cellId, cellId, player.resources.scouting);
  if (!check.ok) {
    showNotice(store, check.reason);

    return;
  }

  writeWorld(store, {
    ...world,
    cells: world.cells.map((cell) => (cell.id === cellId ? { ...cell, revealed: true } : cell)),
  });

  replacePlayer(store, {
    ...player,
    resources: { ...player.resources, scouting: player.resources.scouting - check.cost },
  });
};

/** One flight per turn, and only to a free cell that touches the current one. */
const moveIslandAction = (store: TStore, cellId: string) => {
  if (!isExplorationOpen(store)) {
    return;
  }

  const player = store.derived.humanPlayer.peek();
  const world = store.world.world.peek();
  if (!player || !world) {
    return;
  }

  const check = moveCheck(world, player.cellId, cellId, store.world.movedThisTurn.peek());
  if (!check.ok) {
    showNotice(store, check.reason);

    return;
  }

  writeWorld(store, {
    ...world,
    cells: world.cells.map((cell) => {
      if (cell.id === player.cellId) {
        return { ...cell, ownerId: null };
      }

      // Flying into an island cell wakes its wild islands for the cleanup.
      if (cell.id === cellId) {
        return { ...cell, ownerId: player.id, revealed: true, activated: cell.activated || cell.kind === "island" };
      }

      return cell;
    }),
  });

  replacePlayer(store, { ...player, cellId });
  store.world.movedThisTurn.value = true;
  store.world.selectedCellId.value = cellId;
};

/**
 * Closing the phase. An island that did not fly leaves its whole toxicity in
 * the cell, and the trail may throw an event back at it.
 */
const settleExplorationAction = (store: TStore) => {
  const player = store.derived.humanPlayer.peek();
  const world = store.world.world.peek();
  if (!player || !world) {
    return;
  }

  if (store.world.movedThisTurn.peek()) {
    return;
  }

  // The trail takes the island's hex load, not the meter: the meter is the
  // island's own reckoning, the trail is what it leaves in the world.
  const trail = totalToxicity(player);
  const updated: TWorld = {
    ...world,
    cells: world.cells.map((cell) => {
      return cell.id === player.cellId ? { ...cell, toxicTrail: cell.toxicTrail + trail } : cell;
    }),
  };

  writeWorld(store, updated);

  const here = getCell(updated, player.cellId);
  if (!here) {
    return;
  }

  const rng = createRng(hashSeed(`${store.game.nickname.peek()}:trail:${store.game.turn.peek()}`));
  const event = rollTrailEvent(here.toxicTrail, rng);
  if (!event) {
    return;
  }

  store.world.trailEvent.value = event;

  if (event.id === "bandits") {
    replacePlayer(store, {
      ...player,
      resources: {
        ...player.resources,
        stone: Math.floor(player.resources.stone * 0.75),
        wood: Math.floor(player.resources.wood * 0.75),
      },
    });

    return;
  }

  if (event.id === "undead") {
    replacePlayer(store, {
      ...player,
      resources: { ...player.resources, population: Math.max(0, player.resources.population - 2) },
    });

    return;
  }

  if (event.id === "madness") {
    const moved = Math.min(2, player.resources.population);
    replacePlayer(store, {
      ...player,
      resources: {
        ...player.resources,
        population: player.resources.population - moved,
        mad: player.resources.mad + moved,
      },
    });

    return;
  }

  // The worm: it eats a building and leaves the hex filthy.
  const built = player.island.hexes.filter((hex) => hex.building !== null);
  if (built.length === 0) {
    return;
  }

  const victim = built[Math.floor(rng() * built.length)];
  replacePlayer(store, {
    ...player,
    island: {
      hexes: player.island.hexes.map((hex) => {
        return hex.id === victim?.id ? { ...hex, building: null, toxicity: Math.min(100, hex.toxicity + 30) } : hex;
      }),
    },
  });
};

const closeTrailEventAction = (store: TStore) => {
  store.world.trailEvent.value = null;
};

export {
  closeTrailEventAction,
  enterExplorationAction,
  moveIslandAction,
  scoutAction,
  selectWorldCellAction,
  settleExplorationAction,
};
