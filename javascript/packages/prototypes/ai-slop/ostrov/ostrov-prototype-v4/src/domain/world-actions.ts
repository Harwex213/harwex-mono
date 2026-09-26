import { showToastAction } from "./game-actions";
import {
  BANDIT_LOSS_PERCENT,
  BANDIT_MIN_LOSS,
  EMPTY_TRAIL_RELIEF,
  GARBAGE_WORM_DESTROY_TOXICITY,
  GARBAGE_WORM_TOXICITY,
  INSANE_GROWTH_COUNT,
  UNDEAD_EXTRA_ENEMIES,
  addToxicity,
  addTrail,
  builtHexIds,
  createRng,
  moveOccupant,
  revealCell,
  rollTrailEvent,
  setBuilding,
} from "../core/exports";
import { HUMAN_PLAYER_ID } from "../store/store";
import type { TResources, TRng, TTechId, TTrailEvent, TWorldCell } from "../core/exports";
import type { TLogEntry } from "../store/game-state";
import type { TStore } from "../store/store";

/**
 * The exploration phase (plan §3.6 and §3.7): the island pays its toxicity into
 * the trail of the cell it stands on, the trail rolls an event, and the player
 * reveals a neighbour, flies to one, or stays.
 *
 * Every body reads with `.peek()` and writes with `.value =`, and every value
 * written is a fresh immutable one.
 */

/** Scouting spent to reveal one neighbour, and the discount `star_charts` gives. */
const REVEAL_COST_SCOUTING = 2;
const STAR_CHARTS_COST_SCOUTING = 1;

/** How far the island may fly in one exploration phase, and what `levitation` adds. */
const BASE_MOVE_RANGE = 1;
const LEVITATION_MOVE_RANGE = 2;

/** One turn's worth of seeds, so the phase roll and every arrival roll differ. */
const TURN_SEED_STRIDE = 1000;
const EXPLORATION_SEED_SALT = 7;

/** The salt of the roll that fires at the start of the phase. */
const PHASE_START_SALT = 0;

/** The salt of the roll that fires on arrival; the destination keeps the rolls apart. */
const ARRIVAL_SALT_BASE = 1;

/** The salt of the rng an event effect uses when it has to pick something. */
const EFFECT_SALT = 500;

const PERCENT_SCALE = 100;

const NOT_EXPLORATION_RU = "Это можно делать только в фазе разведки";
const NOT_A_NEIGHBOUR_RU = "Разведать можно только соседний гекс";
const ALREADY_REVEALED_RU = "Гекс уже разведан";
const NOT_ENOUGH_SCOUTING_RU = "Не хватает разведки";
const ALREADY_MOVED_RU = "Остров уже летал в этом ходу";
const TOO_FAR_RU = "Слишком далеко";

const appendLogEntry = (store: TStore, textRu: string): void => {
  const entry: TLogEntry = {
    turn: store.game.turn.peek(),
    phase: store.game.phase.peek(),
    textRu,
  };

  store.game.log.value = [...store.game.log.peek(), entry];
};

/** One seeded source per turn and purpose, so two runs of the probe see the same events. */
const explorationRng = (store: TStore, salt: number): TRng => {
  const seed = store.game.seed.peek() + store.game.turn.peek() * TURN_SEED_STRIDE + EXPLORATION_SEED_SALT + salt;

  return createRng(seed);
};

const cellById = (cells: readonly TWorldCell[], cellId: number): TWorldCell | null => {
  return cells.find((candidate) => {
    return candidate.id === cellId;
  }) ?? null;
};

/** Scouting a neighbour costs less once the star charts are drawn. */
const revealCostFor = (researched: readonly TTechId[]): number => {
  return researched.includes("star_charts") ? STAR_CHARTS_COST_SCOUTING : REVEAL_COST_SCOUTING;
};

/** How many cells the island may cross in one flight. */
const moveRangeFor = (researched: readonly TTechId[]): number => {
  return researched.includes("levitation") ? LEVITATION_MOVE_RANGE : BASE_MOVE_RANGE;
};

/** Breadth-first search over `neighbours`; the distance to `fromId` itself is 0. */
const cellDistances = (cells: readonly TWorldCell[], fromId: number): ReadonlyMap<number, number> => {
  const distances = new Map<number, number>();
  const start = cellById(cells, fromId);
  if (start === null) {
    return distances;
  }

  distances.set(fromId, 0);
  let frontier: readonly number[] = [fromId];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const cellId of frontier) {
      const cell = cellById(cells, cellId);
      const distance = distances.get(cellId);
      if (cell === null || distance === undefined) {
        continue;
      }

      for (const neighbourId of cell.neighbours) {
        if (distances.has(neighbourId)) {
          continue;
        }

        distances.set(neighbourId, distance + 1);
        next.push(neighbourId);
      }
    }

    frontier = next;
  }

  return distances;
};

/** The number of steps between two cells, or `-1` when the map does not connect them. */
const cellDistance = (cells: readonly TWorldCell[], fromId: number, toId: number): number => {
  return cellDistances(cells, fromId).get(toId) ?? -1;
};

/** Every cell the island could fly to, itself excluded. */
const cellsWithinDistance = (
  cells: readonly TWorldCell[],
  fromId: number,
  maxDistance: number,
): readonly number[] => {
  const reachable: number[] = [];
  cellDistances(cells, fromId).forEach((distance, cellId) => {
    if (distance > 0 && distance <= maxDistance) {
      reachable.push(cellId);
    }
  });

  return reachable;
};

/** Bandits take a tenth of the food and the stone, at least one of each the player holds. */
const banditLoss = (amount: number): number => {
  if (amount <= 0) {
    return 0;
  }

  return Math.min(amount, Math.max(BANDIT_MIN_LOSS, Math.floor((amount * BANDIT_LOSS_PERCENT) / PERCENT_SCALE)));
};

const applyBandits = (store: TStore): string => {
  const resources = store.game.resources.peek();
  const foodLoss = banditLoss(resources.food);
  const stoneLoss = banditLoss(resources.stone);
  const next: TResources = {
    ...resources,
    food: resources.food - foodLoss,
    stone: resources.stone - stoneLoss,
  };

  store.game.resources.value = next;

  return `Бандиты унесли ${foodLoss} 🍗 и ${stoneLoss} 🪨`;
};

const applyUndead = (store: TStore): string => {
  store.game.pendingEnemies.value = store.game.pendingEnemies.peek() + UNDEAD_EXTRA_ENEMIES;

  return `Нечисть: +${UNDEAD_EXTRA_ENEMIES} врага в следующей зачистке`;
};

const applyInsaneGrowth = (store: TStore): string => {
  const resources = store.game.resources.peek();
  const converted = Math.min(INSANE_GROWTH_COUNT, resources.population);
  const next: TResources = {
    ...resources,
    population: resources.population - converted,
    insane: resources.insane + converted,
  };

  store.game.resources.value = next;

  return `Сошло с ума жителей: ${converted}`;
};

const applyGarbageWorm = (store: TStore): string => {
  const island = store.game.islands.peek()[HUMAN_PLAYER_ID];
  if (island === undefined) {
    return "Мусорный червь не нашёл, куда вгрызться";
  }

  const built = builtHexIds(island);
  if (built.length === 0) {
    return "Мусорный червь не нашёл ни одного застроенного гекса";
  }

  const rng = explorationRng(store, EFFECT_SALT);
  const hexId = rng.pick(built);
  const hex = island.hexes[hexId];
  const destroyed = hex !== undefined && hex.toxicity >= GARBAGE_WORM_DESTROY_TOXICITY;
  const poisoned = addToxicity(island, hexId, GARBAGE_WORM_TOXICITY);
  const next = destroyed ? setBuilding(poisoned, hexId, null) : poisoned;

  store.game.islands.value = {
    ...store.game.islands.peek(),
    [HUMAN_PLAYER_ID]: next,
  };

  if (destroyed) {
    return `Мусорный червь разрушил здание на гексе ${hexId}`;
  }

  return `Мусорный червь добавил ${GARBAGE_WORM_TOXICITY} ☣️ гексу ${hexId}`;
};

const applyEmptyTrail = (store: TStore): string => {
  const cellId = store.game.islandCellId.peek();
  store.game.worldCells.value = addTrail(store.game.worldCells.peek(), cellId, -EMPTY_TRAIL_RELIEF);

  return `Шлейф выдохся: −${EMPTY_TRAIL_RELIEF}`;
};

/** Runs the effect of plan §3.6, logs it and opens the modal. A `null` event does nothing. */
const applyTrailEventAction = (store: TStore, event: TTrailEvent | null): void => {
  if (event === null) {
    return;
  }

  let detail = "";
  switch (event.id) {
    case "bandits": {
      detail = applyBandits(store);
      break;
    }

    case "undead": {
      detail = applyUndead(store);
      break;
    }

    case "insane_growth": {
      detail = applyInsaneGrowth(store);
      break;
    }

    case "garbage_worm": {
      detail = applyGarbageWorm(store);
      break;
    }

    case "empty": {
      detail = applyEmptyTrail(store);
      break;
    }
  }

  store.ui.eventModal.value = event;
  appendLogEntry(store, `${event.titleRu}: ${detail}`);
};

/**
 * The start of the exploration phase (spec node-51): the island's whole
 * toxicity drops into the trail of the cell it stands on, and that trail rolls
 * an event.
 */
const beginExplorationAction = (store: TStore): void => {
  const cellId = store.game.islandCellId.peek();
  const points = store.derived.toxicityPoints.peek();

  store.ui.explorationMoved.value = false;
  store.ui.selectedCellId.value = null;

  if (points > 0) {
    store.game.worldCells.value = addTrail(store.game.worldCells.peek(), cellId, points);
    appendLogEntry(store, `Токсичный шлейф гекса ${cellId}: +${points}`);
  }

  const cell = cellById(store.game.worldCells.peek(), cellId);
  if (cell === null) {
    return;
  }

  applyTrailEventAction(store, rollTrailEvent(explorationRng(store, PHASE_START_SALT), cell.trail, false));
};

const selectCellAction = (store: TStore, cellId: number | null): void => {
  store.ui.selectedCellId.value = cellId;
};

/** Spends scouting to lift the fog off one neighbouring cell. */
const revealCellAction = (store: TStore, cellId: number): void => {
  if (store.game.phase.peek() !== "exploration") {
    showToastAction(store, NOT_EXPLORATION_RU);

    return;
  }

  const cells = store.game.worldCells.peek();
  const current = cellById(cells, store.game.islandCellId.peek());
  const target = cellById(cells, cellId);
  if (current === null || target === null) {
    return;
  }

  if (current.neighbours.includes(cellId) === false) {
    showToastAction(store, NOT_A_NEIGHBOUR_RU);

    return;
  }

  if (target.revealed === true) {
    showToastAction(store, ALREADY_REVEALED_RU);

    return;
  }

  const cost = revealCostFor(store.game.researched.peek());
  const resources = store.game.resources.peek();
  if (resources.scouting < cost) {
    showToastAction(store, NOT_ENOUGH_SCOUTING_RU);

    return;
  }

  store.game.resources.value = { ...resources, scouting: resources.scouting - cost };
  store.game.worldCells.value = revealCell(cells, cellId);
  appendLogEntry(store, `Разведан гекс ${cellId} за ${cost} 🔭`);
};

/**
 * Flies the island to `cellId`, once per turn. An unrevealed destination is
 * legal and doubles the chance of a trail event on arrival (plan §3.7).
 */
const moveIslandAction = (store: TStore, cellId: number): void => {
  if (store.game.phase.peek() !== "exploration") {
    showToastAction(store, NOT_EXPLORATION_RU);

    return;
  }

  if (store.ui.explorationMoved.peek() === true) {
    showToastAction(store, ALREADY_MOVED_RU);

    return;
  }

  const cells = store.game.worldCells.peek();
  const fromId = store.game.islandCellId.peek();
  const target = cellById(cells, cellId);
  if (target === null || cellId === fromId) {
    return;
  }

  const range = moveRangeFor(store.game.researched.peek());
  const distance = cellDistance(cells, fromId, cellId);
  if (distance < 0 || distance > range) {
    showToastAction(store, TOO_FAR_RU);

    return;
  }

  const wasUnrevealed = target.revealed === false;
  const moved = moveOccupant(cells, fromId, cellId, HUMAN_PLAYER_ID);

  store.game.worldCells.value = revealCell(moved, cellId);
  store.game.islandCellId.value = cellId;
  store.ui.explorationMoved.value = true;
  store.ui.selectedCellId.value = cellId;
  appendLogEntry(store, `Остров перелетел в гекс ${cellId}`);

  const arrived = cellById(store.game.worldCells.peek(), cellId);
  if (arrived === null) {
    return;
  }

  const rng = explorationRng(store, ARRIVAL_SALT_BASE + cellId);
  applyTrailEventAction(store, rollTrailEvent(rng, arrived.trail, wasUnrevealed));
};

export {
  applyTrailEventAction,
  beginExplorationAction,
  cellDistance,
  cellsWithinDistance,
  moveIslandAction,
  moveRangeFor,
  revealCellAction,
  revealCostFor,
  selectCellAction,
};
