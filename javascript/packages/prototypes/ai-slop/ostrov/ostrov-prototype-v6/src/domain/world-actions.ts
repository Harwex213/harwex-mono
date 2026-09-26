import { createRng, hashSeed } from "../core/rng";
import { rollTrailEvent } from "../core/trail-events";
import { getCell } from "../core/world-gen";
import { replacePlayer } from "./player-updates";
import { showNotice } from "./ui-actions";
import type { TStore } from "../store/store";
import type { TWorld } from "../core/world-gen";

/**
 * The exploration phase, on the global map. The player spends scouting to
 * reveal the cells around them and may fly the island one cell over. Staying
 * dumps the island's toxicity into the cell as a trail that never fades.
 */

/** What it costs to reveal everything next to the island. */
const SCOUT_COST = 2;

const writeWorld = (store: TStore, world: TWorld) => {
  store.world.world.value = world;
};

const mapCells = (world: TWorld, change: (cellId: string) => Partial<TWorld["cells"][number]>) => ({
  cells: world.cells.map((cell) => ({ ...cell, ...change(cell.id) })),
});

const selectWorldCellAction = (store: TStore, cellId: string) => {
  store.world.selectedCellId.value = cellId;
};

/** Opens the phase: nothing is spent yet, and no flight has been made. */
const enterExplorationAction = (store: TStore) => {
  const player = store.derived.humanPlayer.peek();

  store.world.movedThisTurn.value = false;
  store.world.selectedCellId.value = player?.cellId ?? null;
};

const scoutAction = (store: TStore) => {
  const player = store.derived.humanPlayer.peek();
  const world = store.world.world.peek();
  if (!player || !world) {
    return;
  }

  if (player.resources.scouting < SCOUT_COST) {
    showNotice(store, `Не хватает разведки: нужно ${SCOUT_COST} 🔭`);

    return;
  }

  const here = getCell(world, player.cellId);
  if (!here) {
    return;
  }

  const unseen = here.neighbors.filter((id) => getCell(world, id)?.revealed === false);
  if (unseen.length === 0) {
    showNotice(store, "Все соседние гексы уже разведаны");

    return;
  }

  writeWorld(store, mapCells(world, (id) => (unseen.includes(id) ? { revealed: true } : {})));

  replacePlayer(store, {
    ...player,
    resources: { ...player.resources, scouting: player.resources.scouting - SCOUT_COST },
  });
};

/** One flight per turn, and only to a cell that touches the current one. */
const moveIslandAction = (store: TStore, cellId: string) => {
  const player = store.derived.humanPlayer.peek();
  const world = store.world.world.peek();
  if (!player || !world) {
    return;
  }

  if (store.world.movedThisTurn.peek()) {
    showNotice(store, "Остров уже перелетал в этом ходу");

    return;
  }

  const here = getCell(world, player.cellId);
  if (!here || !here.neighbors.includes(cellId)) {
    showNotice(store, "Перелететь можно только в соседний гекс");

    return;
  }

  writeWorld(store, {
    cells: world.cells.map((cell) => {
      if (cell.id === player.cellId) {
        return { ...cell, ownerId: null };
      }

      if (cell.id === cellId) {
        return { ...cell, ownerId: player.id, revealed: true };
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

  const trail = player.resources.toxicity;
  const updated: TWorld = {
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
  SCOUT_COST,
  selectWorldCellAction,
  settleExplorationAction,
};
