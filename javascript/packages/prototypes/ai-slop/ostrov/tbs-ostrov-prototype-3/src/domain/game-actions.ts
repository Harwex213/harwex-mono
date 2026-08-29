import { createRng, mixSeed } from "./island/rng";
import { createWorld } from "./world/create-world";
import { addResources, emptyResources, incomeOf } from "./world/resources";
import { hexKey } from "./hex/coords";
import { linkedIdsOf, moveIsland, moveTargetsOf } from "./world/world";
import type { TAxial } from "./hex/coords";
import type { TStore } from "../store/store";

const LOG_LIMIT = 8;

const pushLog = (store: TStore, line: string) => {
  const { log } = store.gameState;

  log.value = [line, ...log.peek()].slice(0, LOG_LIMIT);
};

const playerOf = (store: TStore) => {
  return store.gameState.world.peek().islands.find((entry) => entry.owner === "player")!;
};

/** The move card. Toggles the target view on and off. */
const toggleMoveModeAction = (store: TStore) => {
  const { mode, movesLeft, hoveredTarget } = store.gameState;

  if (mode.peek() === "move") {
    mode.value = "idle";
    hoveredTarget.value = null;

    return;
  }

  if (movesLeft.peek() <= 0) {
    return;
  }

  mode.value = "move";
  store.gameState.selectedIslandId.value = "player";
};

const cancelMoveAction = (store: TStore) => {
  store.gameState.mode.value = "idle";
  store.gameState.hoveredTarget.value = null;
};

const hoverTargetAction = (store: TStore, target: TAxial | null) => {
  store.gameState.hoveredTarget.value = target;
};

/** Flies the player island to a highlighted cell. Ignored for a cell that is not a target. */
const moveToTargetAction = (store: TStore, target: TAxial) => {
  const { world, mode, movesLeft, hoveredTarget } = store.gameState;

  if (mode.peek() !== "move" || movesLeft.peek() <= 0) {
    return;
  }

  const player = playerOf(store);
  const targetKey = hexKey(target.q, target.r);
  const allowed = moveTargetsOf(world.peek(), player.id).some((cell) => hexKey(cell.q, cell.r) === targetKey);
  if (!allowed) {
    return;
  }

  const linksBefore = linkedIdsOf(world.peek(), player.id);

  world.value = moveIsland(world.peek(), player.id, target);
  movesLeft.value = movesLeft.peek() - 1;
  mode.value = "idle";
  hoveredTarget.value = null;

  const linksAfter = linkedIdsOf(world.peek(), player.id);
  const gained = linksAfter.filter((id) => !linksBefore.includes(id));
  const lost = linksBefore.filter((id) => !linksAfter.includes(id));
  const nameOf = (id: string) => world.peek().islands.find((entry) => entry.id === id)!.island.name;

  pushLog(store, `${player.island.name} перелетел на ${target.q}, ${target.r}.`);

  for (const id of gained) {
    pushLog(store, `Наведён мост к острову ${nameOf(id)}.`);
  }

  for (const id of lost) {
    pushLog(store, `Связь с островом ${nameOf(id)} потеряна.`);
  }
};

/**
 * Closes the turn: income is banked, every neutral island drifts one cell if
 * it has room, and the player gets the next move.
 */
const endTurnAction = (store: TStore) => {
  const { world, turn, movesLeft, resources, mode, hoveredTarget } = store.gameState;
  const player = playerOf(store);
  const linkCount = linkedIdsOf(world.peek(), player.id).length;
  const income = incomeOf(player.island.counts, linkCount);

  resources.value = addResources(resources.peek(), income);

  const currentTurn = turn.peek();
  let next = world.peek();

  next.islands.forEach((entry, index) => {
    if (entry.owner !== "neutral") {
      return;
    }

    const rng = createRng(mixSeed(next.seed, currentTurn, index));
    // Every other turn an island stays put, so the sky is not a constant swirl.
    if (rng.next() < 0.5) {
      return;
    }

    const targets = moveTargetsOf(next, entry.id, 1);
    if (targets.length === 0) {
      return;
    }

    next = moveIsland(next, entry.id, targets[rng.int(0, targets.length - 1)]!);
  });

  world.value = next;
  turn.value = currentTurn + 1;
  movesLeft.value = 1;
  mode.value = "idle";
  hoveredTarget.value = null;

  const gold = income.gold > 0 ? `, ${income.gold} золота` : "";

  pushLog(store, `Ход ${currentTurn} завершён: +${income.food} еды, ${income.wood} дерева, ${income.stone} камня${gold}.`);
};

/** Clicking the selected island again clears the selection. */
const selectIslandAction = (store: TStore, id: string) => {
  const { selectedIslandId, mode } = store.gameState;

  if (mode.peek() === "move") {
    return;
  }

  selectedIslandId.value = selectedIslandId.peek() === id ? null : id;
};

const newWorldAction = (store: TStore, seedText: string) => {
  const state = store.gameState;
  const text = seedText.trim() || Math.floor(Math.random() * 0xffffff).toString(36).toUpperCase();

  state.seedText.value = text;
  state.world.value = createWorld(text);
  state.turn.value = 1;
  state.movesLeft.value = 1;
  state.mode.value = "idle";
  state.hoveredTarget.value = null;
  state.selectedIslandId.value = "player";
  state.resources.value = emptyResources();
  state.log.value = [`Новое небо «${text}». Ваш остров в центре.`];
};

export {
  cancelMoveAction,
  endTurnAction,
  hoverTargetAction,
  moveToTargetAction,
  newWorldAction,
  selectIslandAction,
  toggleMoveModeAction,
};
