import { computeVisible } from "./rules/vision";
import { UNITS } from "./rules/units";
import { createRng, hashSeed } from "./world/rng";
import type { TBoardView } from "./rules/board";
import type { TRng } from "./world/rng";
import type { TArmy, TArmyKind, TFactionId, TLogTone, TWorld } from "./world/types";
import type { TStore } from "../store/store";

/**
 * The plumbing every action needs: reading the board out of the signals,
 * writing to the log, and keeping the fog and the win check in step with it.
 * Nothing here decides anything; it only keeps the state consistent.
 */

const MAX_LOG_ENTRIES = 60;

const worldOf = (store: TStore): TWorld | null => store.worldState.world.peek();

const boardViewOf = (store: TStore): TBoardView | null => {
  const world = worldOf(store);
  if (!world) {
    return null;
  }

  return {
    world,
    armies: store.gameState.armies.peek(),
    structures: store.gameState.structures.peek(),
  };
};

const takeId = (store: TStore): number => {
  const id = store.gameState.nextId.peek();
  store.gameState.nextId.value = id + 1;

  return id;
};

const pushLog = (store: TStore, tone: TLogTone, text: string) => {
  const entry = { id: takeId(store), turn: store.gameState.turn.peek(), tone, text };
  const log = [entry, ...store.gameState.log.peek()];

  store.gameState.log.value = log.slice(0, MAX_LOG_ENTRIES);
};

/** A fresh generator per fight, indexed off the seed, so replays match. */
const combatRng = (store: TStore): TRng => {
  const rolls = store.gameState.rollCount.peek();
  store.gameState.rollCount.value = rolls + 1;

  return createRng(hashSeed(store.worldState.seed.peek()) ^ Math.imul(rolls + 1, 2654435761));
};

/** Recomputes what the player can see, and remembers it as explored. */
const refreshVision = (store: TStore) => {
  const world = worldOf(store);
  if (!world) {
    return;
  }

  const visible = computeVisible(world, store.gameState.armies.peek(), store.gameState.structures.peek(), "player");
  const explored = new Set(store.gameState.explored.peek());
  for (const key of visible) {
    explored.add(key);
  }

  store.gameState.visible.value = visible;
  store.gameState.explored.value = explored;
};

const buildArmy = (store: TStore, owner: TFactionId, kind: TArmyKind, key: string): TArmy => {
  const blueprint = UNITS[kind];
  const id = takeId(store);

  return {
    id,
    owner,
    kind,
    name: `${blueprint.name} №${id}`,
    key,
    hp: blueprint.hp,
    maxHp: blueprint.hp,
    attack: blueprint.attack,
    movement: blueprint.movement,
    movementLeft: blueprint.movement,
    sight: blueprint.sight,
    hasAttacked: false,
    restedTurns: 0,
  };
};

const setArmies = (store: TStore, armies: readonly TArmy[]) => {
  store.gameState.armies.value = armies;
};

/** Replaces one army in place, leaving the rest of the list untouched. */
const patchArmy = (store: TStore, id: number, patch: Partial<TArmy>) => {
  setArmies(
    store,
    store.gameState.armies.peek().map((army) => (army.id === id ? { ...army, ...patch } : army))
  );
};

const removeArmy = (store: TStore, id: number) => {
  setArmies(
    store,
    store.gameState.armies.peek().filter((army) => army.id !== id)
  );

  if (store.selectionState.selectedArmyId.peek() === id) {
    store.selectionState.selectedArmyId.value = -1;
  }
};

const findArmy = (store: TStore, id: number): TArmy | null =>
  store.gameState.armies.peek().find((army) => army.id === id) ?? null;

const patchStructure = (store: TStore, id: number, hp: number) => {
  store.gameState.structures.value = store.gameState.structures
    .peek()
    .map((structure) => (structure.id === id ? { ...structure, hp } : structure));
};

const addGold = (store: TStore, faction: TFactionId, amount: number) => {
  const factions = store.gameState.factions.peek();
  const current = factions[faction];

  store.gameState.factions.value = {
    ...factions,
    [faction]: { ...current, gold: Math.max(0, current.gold + amount) },
  };
};

const setHiredThisTurn = (store: TStore, faction: TFactionId, hiredThisTurn: boolean) => {
  const factions = store.gameState.factions.peek();

  store.gameState.factions.value = { ...factions, [faction]: { ...factions[faction], hiredThisTurn } };
};

/** Ends the game as soon as one of the two settlements falls. */
const checkOutcome = (store: TStore) => {
  if (store.gameState.outcome.peek() !== "playing") {
    return;
  }

  const structures = store.gameState.structures.peek();
  const city = structures.find((structure) => structure.kind === "city");
  const camp = structures.find((structure) => structure.kind === "camp");

  if (!city || city.hp <= 0) {
    store.gameState.outcome.value = "lost";
    pushLog(store, "system", "Столица пала. Остров потерян.");

    return;
  }

  if (!camp || camp.hp <= 0) {
    store.gameState.outcome.value = "won";
    pushLog(store, "system", "Лагерь клана сожжён. Остров ваш.");
  }
};

export {
  addGold,
  boardViewOf,
  buildArmy,
  checkOutcome,
  combatRng,
  findArmy,
  patchArmy,
  patchStructure,
  pushLog,
  refreshVision,
  removeArmy,
  setArmies,
  setHiredThisTurn,
  takeId,
  worldOf,
};
