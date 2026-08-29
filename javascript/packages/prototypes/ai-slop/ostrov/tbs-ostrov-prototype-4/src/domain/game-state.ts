import {
  addGold,
  boardViewOf,
  buildArmy,
  patchStructure,
  pushLog,
  refreshVision,
  setArmies,
  setHiredThisTurn,
  takeId,
} from "./engine";
import { runEnemyTurn } from "./enemy-turn";
import { axialDistance } from "./hex/coords";
import { nearestFreeLandTile, neighbourKeysOf } from "./rules/board";
import { UNITS } from "./rules/units";
import { fitHexSizeToBoard } from "./view-state";
import { generateIsland } from "./world/generator";
import { createRng, hashSeed, pickOne, randomSeed } from "./world/rng";
import { TERRAIN } from "./world/terrain";
import type { TBoardView } from "./rules/board";
import type { TArmy, TArmyKind, TStructure, TWorld } from "./world/types";
import type { TStore } from "../store/store";

/** Gold the island starts with: two cheap armies, or one good one. */
const START_GOLD = 55;

/** Gold the city hands over before the tiles around it are counted. */
const CITY_BASE_INCOME = 4;

const CITY_HP = 60;
const CITY_DEFENCE = 10;
const CAMP_HP = 34;
const CAMP_DEFENCE = 6;

/** The camp lets a new band out this often, up to the cap. */
const CAMP_SPAWN_INTERVAL = 3;
const MAX_ENEMY_ARMIES = 4;

const HEAL_RESTING = 3;
const HEAL_ENTRENCHED = 3;
const HEAL_AT_HOME = 3;
/** Repairs only happen when no hostile army stands next to the walls. */
const STRUCTURE_REPAIR = 5;

const ENEMY_STARTING_KINDS: readonly TArmyKind[] = ["spearman", "scout"];

/** Gold a city on `key` collects: its own tile plus the ring around it. */
const cityIncome = (world: TWorld, key: string): number => {
  const tile = world.tiles.get(key);
  if (!tile) {
    return CITY_BASE_INCOME;
  }

  const ring = neighbourKeysOf(world, key).map((neighbourKey) => world.tiles.get(neighbourKey)!);

  return [tile, ...ring].reduce((total, current) => total + TERRAIN[current.terrain].income, CITY_BASE_INCOME);
};

/** Gold the player's armies eat every turn. */
const armyUpkeep = (armies: readonly TArmy[]): number =>
  armies.reduce((total, army) => (army.owner === "player" ? total + UNITS[army.kind].upkeep : total), 0);

const buildStructure = (
  store: TStore,
  kind: TStructure["kind"],
  key: string
): TStructure => ({
  id: takeId(store),
  kind,
  owner: kind === "city" ? "player" : "enemy",
  name: kind === "city" ? "Столица Приморья" : "Лагерь клана",
  key,
  hp: kind === "city" ? CITY_HP : CAMP_HP,
  maxHp: kind === "city" ? CITY_HP : CAMP_HP,
  defence: kind === "city" ? CITY_DEFENCE : CAMP_DEFENCE,
  sight: kind === "city" ? 3 : 2,
});

/** Throws the board away and builds a fresh island from the current seed. */
const newGameAction = (store: TStore) => {
  const seed = store.worldState.seed.peek();
  const size = store.worldState.boardSize.peek();
  const { world, cityKey, campKey } = generateIsland({ seed, width: size, height: size });

  store.worldState.world.value = world;
  store.gameState.nextId.value = 1;
  store.gameState.rollCount.value = 0;
  store.gameState.turn.value = 1;
  store.gameState.phase.value = "player";
  store.gameState.outcome.value = "playing";
  store.gameState.log.value = [];
  store.gameState.explored.value = new Set<string>();
  store.gameState.visible.value = new Set<string>();
  store.selectionState.selectedArmyId.value = -1;
  store.selectionState.hoveredKey.value = "";
  store.animationState.move.value = null;
  store.animationState.strike.value = null;

  const city = buildStructure(store, "city", cityKey);
  const camp = buildStructure(store, "camp", campKey);
  store.gameState.structures.value = [city, camp];

  const taken = new Set<string>();
  const view: TBoardView = { world, armies: [], structures: [city, camp] };

  const placeArmy = (owner: TArmy["owner"], kind: TArmyKind, anchor: string): TArmy | null => {
    const key = nearestFreeLandTile(view, anchor, taken);
    if (!key) {
      return null;
    }
    taken.add(key);

    return { ...buildArmy(store, owner, kind, key) };
  };

  const armies: TArmy[] = [];
  const garrison = placeArmy("player", "spearman", cityKey);
  if (garrison) {
    armies.push(garrison);
  }
  for (const kind of ENEMY_STARTING_KINDS) {
    const raider = placeArmy("enemy", kind, campKey);
    if (raider) {
      armies.push(raider);
    }
  }
  setArmies(store, armies);

  store.gameState.factions.value = {
    player: { id: "player", name: "Приморье", gold: START_GOLD, hiredThisTurn: false },
    enemy: { id: "enemy", name: "Багровый клан", gold: 0, hiredThisTurn: false },
  };

  refreshVision(store);
  pushLog(store, "system", `Остров «${seed}» поднялся из моря. Клан уже здесь.`);
};

const setSeedAction = (store: TStore, seed: string) => {
  store.worldState.seed.value = seed;
};

const randomizeSeedAction = (store: TStore) => {
  store.worldState.seed.value = randomSeed();
  newGameAction(store);
};

const setBoardSizeAction = (store: TStore, size: number) => {
  store.worldState.boardSize.value = size;
  fitHexSizeToBoard(store, size);
  newGameAction(store);
};

/** Buys an army in the city. One per turn, so the island fills up slowly. */
const hireArmyAction = (store: TStore, kind: TArmyKind) => {
  if (store.gameState.phase.peek() !== "player" || store.gameState.outcome.peek() !== "playing") {
    return;
  }

  const view = boardViewOf(store);
  const faction = store.gameState.factions.peek().player;
  const blueprint = UNITS[kind];
  if (!view || faction.hiredThisTurn || faction.gold < blueprint.cost) {
    return;
  }

  const city = view.structures.find((structure) => structure.kind === "city");
  if (!city) {
    return;
  }

  const taken = new Set(view.armies.map((army) => army.key));
  const key = nearestFreeLandTile(view, city.key, taken);
  if (!key) {
    pushLog(store, "system", "Вокруг столицы нет свободного места.");

    return;
  }

  const army = buildArmy(store, "player", kind, key);
  setArmies(store, [...view.armies, army]);
  addGold(store, "player", -blueprint.cost);
  setHiredThisTurn(store, "player", true);
  store.selectionState.selectedArmyId.value = army.id;

  refreshVision(store);
  pushLog(store, "player", `Нанят отряд: ${army.name} — ${blueprint.cost} золота.`);
};

/** True when the army stands on or beside a settlement of its own side. */
const isAtHome = (view: TBoardView, army: TArmy): boolean => {
  const tile = view.world.tiles.get(army.key);
  if (!tile) {
    return false;
  }

  return view.structures.some((structure) => {
    if (structure.owner !== army.owner || structure.hp <= 0) {
      return false;
    }
    const home = view.world.tiles.get(structure.key);

    return home !== undefined && axialDistance(home.cell, tile.cell) <= 1;
  });
};

/** True while a hostile army stands within one tile of the walls. */
const isBesieged = (view: TBoardView, structure: TStructure): boolean => {
  const home = view.world.tiles.get(structure.key);
  if (!home) {
    return false;
  }

  return view.armies.some((army) => {
    if (army.owner === structure.owner) {
      return false;
    }
    const tile = view.world.tiles.get(army.key);

    return tile !== undefined && axialDistance(home.cell, tile.cell) <= 1;
  });
};

/** Income, healing, reinforcements — everything that happens between turns. */
const beginPlayerTurn = (store: TStore) => {
  if (store.gameState.outcome.peek() !== "playing") {
    store.gameState.phase.value = "player";

    return;
  }

  const view = boardViewOf(store);
  if (!view) {
    return;
  }

  store.gameState.turn.value = store.gameState.turn.peek() + 1;

  const income = cityIncome(view.world, view.structures.find((structure) => structure.kind === "city")?.key ?? "");
  const upkeep = armyUpkeep(view.armies);
  addGold(store, "player", income - upkeep);
  setHiredThisTurn(store, "player", false);

  // An army that neither moved nor fought digs in; two quiet turns dig deeper.
  const rested = view.armies.map((army) => {
    const held = army.movementLeft === army.movement && !army.hasAttacked;
    const restedTurns = held ? army.restedTurns + 1 : 0;
    const heal = held
      ? HEAL_RESTING + (restedTurns >= 2 ? HEAL_ENTRENCHED : 0) + (isAtHome(view, army) ? HEAL_AT_HOME : 0)
      : 0;

    return {
      ...army,
      hp: Math.min(army.maxHp, army.hp + heal),
      movementLeft: army.movement,
      hasAttacked: false,
      restedTurns,
    };
  });
  setArmies(store, rested);

  for (const structure of view.structures) {
    if (structure.hp <= 0 || structure.hp >= structure.maxHp || isBesieged(view, structure)) {
      continue;
    }
    patchStructure(store, structure.id, Math.min(structure.maxHp, structure.hp + STRUCTURE_REPAIR));
  }

  spawnFromCamp(store);
  refreshVision(store);

  store.gameState.phase.value = "player";
  pushLog(store, "player", `Ход ${store.gameState.turn.peek()}. Казна пополнилась на ${income - upkeep} золота.`);
};

/** Every few turns the camp lets another band out, up to the cap. */
const spawnFromCamp = (store: TStore) => {
  const turn = store.gameState.turn.peek();
  if (turn % CAMP_SPAWN_INTERVAL !== 0) {
    return;
  }

  const view = boardViewOf(store);
  if (!view) {
    return;
  }

  const camp = view.structures.find((structure) => structure.kind === "camp");
  const enemies = view.armies.filter((army) => army.owner === "enemy");
  if (!camp || camp.hp <= 0 || enemies.length >= MAX_ENEMY_ARMIES) {
    return;
  }

  const taken = new Set(view.armies.map((army) => army.key));
  const key = nearestFreeLandTile(view, camp.key, taken);
  if (!key) {
    return;
  }

  const rng = createRng(hashSeed(store.worldState.seed.peek()) ^ Math.imul(turn, 40503));
  const kind = pickOne(rng, turn >= 6 ? (["spearman", "knight", "scout"] as const) : (["scout", "spearman"] as const));
  const army = buildArmy(store, "enemy", kind, key);
  setArmies(store, [...view.armies, army]);

  pushLog(store, "enemy", `Лагерь выпустил отряд: ${army.name}.`);
};

const endTurnAction = (store: TStore) => {
  if (store.gameState.phase.peek() !== "player" || store.gameState.outcome.peek() !== "playing") {
    return;
  }

  store.selectionState.selectedArmyId.value = -1;
  store.gameState.phase.value = "enemy";
  pushLog(store, "enemy", "Багровый клан выступает.");

  runEnemyTurn(store, () => beginPlayerTurn(store));
};

export {
  armyUpkeep,
  cityIncome,
  endTurnAction,
  hireArmyAction,
  newGameAction,
  randomizeSeedAction,
  setBoardSizeAction,
  setSeedAction,
};
