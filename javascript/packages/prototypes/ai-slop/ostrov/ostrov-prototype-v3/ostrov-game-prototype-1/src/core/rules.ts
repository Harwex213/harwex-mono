import { BUILDING_DEFS, CAMP_LOOT, ENGINE_HALF_COST, MAX_SQUADS_PER_SIDE, PLAYER_SQUAD_LADDER, SQUAD_DEFS, UNIT_DEFS } from "./catalog";
import {
  addBuilding,
  addUnit,
  buildingOn,
  buildingsOf,
  createSquad,
  factionById,
  isBuilt,
  islandById,
  log,
  nextId,
  rebuildPosIndex,
  removeBuilding,
  removeUnit,
  tileAt,
  tileOf,
  unitsOf,
  unitsOnTile,
} from "./entities";
import { HITECH_FACTION_ID, PLAYERS_FACTION_ID } from "./factions";
import { axialToOffsetX } from "./hex";
import { HEX_DIRECTIONS, hexDistance, hexKey, neighboursOf } from "@hw/ostrov-utils";
import { isBuildingUnlocked, isKnown, isResearchable, isSquadUnlocked, TECH_BY_ID } from "./tech";
import type { TBattleSetup, TBuilding, TBuildingType, TGame, TGameTile, TPlayerId, TSquadType, TUnit, TUnitType } from "./state";

/** How far a faction's units see. Meeting a faction reveals its name. */
const DISCOVERY_RANGE = 4;

/** Rounds a sea hop costs with rafts. */
const RAFT_HOP_COST = 2;

type TReach = Map<string, number>;

const hostileOn = (game: TGame, tile: TGameTile, factionId: string) => {
  const enemyUnit = unitsOnTile(game, tile.id).some((unit) => unit.factionId !== factionId);
  const building = buildingOn(game, tile.id);
  const enemyBuilding = building !== null && building.factionId !== factionId;

  return enemyUnit || enemyBuilding;
};

/**
 * Hexes the unit can end its move on, with the movement it costs to get there.
 * Land steps cost one. With rafts, one sea hex may be jumped for two. A hostile
 * hex can be entered by an army only, and nothing walks through one.
 */
const reachableTiles = (game: TGame, unit: TUnit): TReach => {
  const start = tileOf(game, unit);
  const best: TReach = new Map([[start.id, 0]]);
  const queue: { tile: TGameTile; cost: number }[] = [{ tile: start, cost: 0 }];
  const rafts = isKnown(game.research, "rafts");

  const consider = (tile: TGameTile, cost: number) => {
    if (cost > unit.movesLeft) {
      return;
    }

    const known = best.get(tile.id);
    if (known !== undefined && known <= cost) {
      return;
    }

    const hostile = hostileOn(game, tile, unit.factionId);
    if (hostile && unit.type !== "army") {
      return;
    }

    best.set(tile.id, cost);

    if (!hostile) {
      queue.push({ tile, cost });
    }
  };

  while (queue.length > 0) {
    const { tile, cost } = queue.shift()!;

    for (const direction of HEX_DIRECTIONS) {
      const q = tile.q + direction.q;
      const r = tile.r + direction.r;
      const next = tileAt(game, q, r);

      if (next !== null) {
        consider(next, cost + 1);

        continue;
      }

      if (!rafts) {
        continue;
      }

      const beyond = tileAt(game, q + direction.q, r + direction.r);
      if (beyond !== null) {
        consider(beyond, cost + RAFT_HOP_COST);
      }
    }
  }

  best.delete(start.id);

  return best;
};

/** Marks every faction one of the players' units has come close to. */
const discoverFactions = (game: TGame) => {
  const own = unitsOf(game, PLAYERS_FACTION_ID).map((unit) => tileOf(game, unit));

  for (const faction of game.factions) {
    if (faction.discovered) {
      continue;
    }

    const theirs = [
      ...unitsOf(game, faction.id).map((unit) => tileOf(game, unit)),
      ...buildingsOf(game, faction.id).map((building) => game.tiles[building.tileId]!),
    ];

    const met = own.some((mine) => theirs.some((other) => hexDistance(mine, other) <= DISCOVERY_RANGE));
    if (met) {
      faction.discovered = true;
      log(game, `Встречена фракция: ${faction.name}. «${faction.motto}»`, "info");
    }
  }
};

const grantLoot = (game: TGame, player: TPlayerId | null) => {
  if (player === null) {
    return;
  }

  const state = game.players[player];
  state.production += CAMP_LOOT.production;
  state.metals += CAMP_LOOT.metals;
};

const eliminateFaction = (game: TGame, factionId: string) => {
  const faction = factionById(game, factionId);
  faction.alive = false;

  for (const unit of unitsOf(game, factionId)) {
    removeUnit(game, unit.id);
  }

  log(game, `${faction.name}: фракция уничтожена.`, "good");
};

/**
 * The attacker takes an undefended hex. Enemy civilians on it are lost; a building
 * changes hands, a camp is razed, a Centre of Power ends its faction, and the
 * Nexus core ends the game.
 */
const captureTile = (game: TGame, tileId: string, attackerFactionId: string, player: TPlayerId | null) => {
  for (const unit of unitsOnTile(game, tileId)) {
    if (unit.factionId !== attackerFactionId) {
      removeUnit(game, unit.id);
      log(game, `${unit.name} (${factionById(game, unit.factionId).name}) уничтожен на захваченном гексе.`, "info");
    }
  }

  const building = buildingOn(game, tileId);
  if (building === null || building.factionId === attackerFactionId) {
    return;
  }

  const def = BUILDING_DEFS[building.type];
  const loserFaction = factionById(game, building.factionId);

  if (building.type === "core") {
    removeBuilding(game, building.id);
    game.result = "victory";
    game.phase = "ended";
    log(game, "Ядро Цитадели захвачено. Нексус пал перед Союзом двух племён!", "good");

    return;
  }

  if (building.type === "camp") {
    removeBuilding(game, building.id);
    grantLoot(game, player);
    log(game, `Лагерь туземцев разорён. Добыча: +${CAMP_LOOT.production} производства, +${CAMP_LOOT.metals} металлов.`, "good");

    return;
  }

  if (building.type === "power") {
    removeBuilding(game, building.id);

    if (loserFaction.id === PLAYERS_FACTION_ID && building.owner !== null) {
      const loser = game.players[building.owner];
      loser.defeated = true;
      loser.powerBuildingId = null;
      log(game, `Центр Власти ${loser.name} пал!`, "bad");
      checkDefeat(game);
    } else {
      eliminateFaction(game, loserFaction.id);
    }

    return;
  }

  if (attackerFactionId === PLAYERS_FACTION_ID) {
    building.factionId = attackerFactionId;
    building.owner = player;
    log(game, `Захвачено здание: ${def.name} (${loserFaction.name}).`, "good");
  } else {
    removeBuilding(game, building.id);
    log(game, `Разрушено здание: ${def.name}. Виновник: ${factionById(game, attackerFactionId).name}.`, "bad");
  }
};

const checkDefeat = (game: TGame) => {
  const both = game.players.p1.defeated && game.players.p2.defeated;

  if (both) {
    game.result = "defeat";
    game.phase = "ended";
    log(game, "Оба Центра Власти пали. Союз рассеян.", "bad");
  }
};

type TMoveOutcome = { kind: "moved" } | { kind: "captured" } | { kind: "battle"; setup: TBattleSetup } | { kind: "blocked"; reason: string };

/** Moves a unit to a reachable hex, and settles what it meets there. */
const moveUnit = (game: TGame, unitId: string, tileId: string): TMoveOutcome => {
  const unit = game.units[unitId];

  if (unit === undefined) {
    return { kind: "blocked", reason: "Юнит не найден" };
  }

  const cost = reachableTiles(game, unit).get(tileId);
  if (cost === undefined) {
    return { kind: "blocked", reason: "Гекс недостижим" };
  }

  const defenders = unitsOnTile(game, tileId).filter((other) => other.factionId !== unit.factionId && other.type === "army");

  unit.movesLeft -= cost;
  unit.tileId = tileId;

  if (unit.factionId === PLAYERS_FACTION_ID) {
    discoverFactions(game);
  }

  if (defenders.length > 0) {
    const setup: TBattleSetup = {
      id: nextId(game, "battle"),
      tileId,
      attackerFactionId: unit.factionId,
      defenderFactionId: defenders[0]!.factionId,
      attackerUnitIds: [unit.id],
      defenderUnitIds: defenders.map((other) => other.id),
      attackerPlayer: unit.owner,
    };
    unit.movesLeft = 0;

    return { kind: "battle", setup };
  }

  const tile = game.tiles[tileId]!;
  if (hostileOn(game, tile, unit.factionId)) {
    unit.movesLeft = 0;
    captureTile(game, tileId, unit.factionId, unit.owner);

    return { kind: "captured" };
  }

  return { kind: "moved" };
};

const canFoundPower = (game: TGame, unit: TUnit): string | null => {
  if (unit.type !== "settler" || unit.owner === null) {
    return "Только поселенец основывает Центр Власти";
  }

  if (game.players[unit.owner].powerBuildingId !== null) {
    return "У этого игрока уже есть Центр Власти";
  }

  if (buildingOn(game, unit.tileId) !== null) {
    return "Гекс уже занят зданием";
  }

  return null;
};

const foundPower = (game: TGame, unitId: string) => {
  const unit = game.units[unitId];

  if (unit === undefined || canFoundPower(game, unit) !== null) {
    return;
  }

  const owner = unit.owner!;
  const building = addBuilding(game, "power", PLAYERS_FACTION_ID, owner, unit.tileId, true);
  game.players[owner].powerBuildingId = building.id;
  removeUnit(game, unit.id);
  log(game, `${game.players[owner].name} основал Центр Власти на острове ${islandById(game, game.tiles[unit.tileId]!.islandId).name}.`, "good");
};

type TBuildOption = {
  type: TBuildingType;
  reason: string | null;
};

const buildOptions = (game: TGame, unit: TUnit): TBuildOption[] => {
  const tile = game.tiles[unit.tileId]!;
  const island = islandById(game, tile.islandId);

  return (Object.keys(BUILDING_DEFS) as TBuildingType[])
    .filter((type) => BUILDING_DEFS[type].buildable)
    .map((type) => {
      const def = BUILDING_DEFS[type];

      if (!isBuildingUnlocked(game.research, type)) {
        return { type, reason: "Не открыто технологией" };
      }

      if (tile.buildingId !== null) {
        return { type, reason: "Гекс занят" };
      }

      if (def.terrains.length > 0 && !def.terrains.includes(tile.terrain)) {
        return { type, reason: "Не та местность" };
      }

      if (def.burnsDeposits && tile.deposits <= 0) {
        return { type, reason: "Нет ископаемых" };
      }

      if (type === "engine" && !island.home) {
        return { type, reason: "Только на родном острове" };
      }

      if (type === "engine" && buildingsOf(game, PLAYERS_FACTION_ID).some((built) => built.type === "engine")) {
        return { type, reason: "Двигатель уже заложен" };
      }

      return { type, reason: null };
    });
};

/** Lays a construction site. The site takes production every turn a builders unit stands on it. */
const startBuilding = (game: TGame, unitId: string, type: TBuildingType) => {
  const unit = game.units[unitId];

  if (unit === undefined || unit.type !== "builders") {
    return;
  }

  const option = buildOptions(game, unit).find((found) => found.type === type);
  if (option === undefined || option.reason !== null) {
    return;
  }

  addBuilding(game, type, PLAYERS_FACTION_ID, unit.owner, unit.tileId, false);
  unit.movesLeft = 0;
  log(game, `${game.players[unit.owner!].name} заложил стройку: ${BUILDING_DEFS[type].name}.`, "info");
};

const bestSquadType = (game: TGame): TSquadType => {
  const unlocked = PLAYER_SQUAD_LADDER.filter((type) => isSquadUnlocked(game.research, type));

  return unlocked[unlocked.length - 1] ?? "militia";
};

const canAfford = (game: TGame, player: TPlayerId, type: TUnitType): string | null => {
  const state = game.players[player];
  const def = UNIT_DEFS[type];

  if (state.production < def.productionCost) {
    return `Нужно ${def.productionCost} производства`;
  }

  if (state.metals < def.metalsCost) {
    return `Нужно ${def.metalsCost} металлов`;
  }

  if (state.population < def.populationCost) {
    return `Нужно ${def.populationCost} населения`;
  }

  return null;
};

const pay = (game: TGame, player: TPlayerId, type: TUnitType) => {
  const state = game.players[player];
  const def = UNIT_DEFS[type];

  state.production -= def.productionCost;
  state.metals -= def.metalsCost;
  state.population -= def.populationCost;
};

/** Settlers and builders come out of the player's Centre of Power. */
const trainCivilian = (game: TGame, player: TPlayerId, type: "settler" | "builders") => {
  const state = game.players[player];
  const power = state.powerBuildingId === null ? null : game.buildings[state.powerBuildingId];

  if (power === undefined || power === null || canAfford(game, player, type) !== null) {
    return;
  }

  pay(game, player, type);
  addUnit(game, type, PLAYERS_FACTION_ID, player, power.tileId);
  log(game, `${state.name} обучил юнит: ${UNIT_DEFS[type].name}.`, "info");
};

const ownBarracksOn = (game: TGame, tileId: string) => {
  const building = buildingOn(game, tileId);

  return building !== null && building.type === "barracks" && building.factionId === PLAYERS_FACTION_ID && isBuilt(building) ? building : null;
};

/** Forms a fresh army of one squad at a working barracks. */
const formArmy = (game: TGame, player: TPlayerId, barracksId: string) => {
  const barracks = game.buildings[barracksId];

  if (barracks === undefined || ownBarracksOn(game, barracks.tileId) === null || canAfford(game, player, "army") !== null) {
    return;
  }

  pay(game, player, "army");
  const type = bestSquadType(game);
  addUnit(game, "army", PLAYERS_FACTION_ID, player, barracks.tileId, [type]);
  log(game, `${game.players[player].name} сформировал армию: отряд «${SQUAD_DEFS[type].name}».`, "info");
};

/** Adds one squad to an army standing on a working barracks. */
const reinforceArmy = (game: TGame, player: TPlayerId, unitId: string) => {
  const army = game.units[unitId];

  if (army === undefined || army.type !== "army" || army.owner !== player || ownBarracksOn(game, army.tileId) === null) {
    return;
  }

  if (army.squads.length >= MAX_SQUADS_PER_SIDE || canAfford(game, player, "army") !== null) {
    return;
  }

  pay(game, player, "army");
  army.squads.push(createSquad(game, bestSquadType(game)));
};

const engineOf = (game: TGame): TBuilding | null => {
  return buildingsOf(game, PLAYERS_FACTION_ID).find((building) => building.type === "engine") ?? null;
};

/** Pays part of the player's half of the engine. Both halves must be paid in full. */
const investEngine = (game: TGame, player: TPlayerId, amount: number) => {
  const engine = engineOf(game);

  if (engine === null || engine.engineHalves === null) {
    return;
  }

  const state = game.players[player];
  const half = engine.engineHalves[player];
  const paid = Math.min(amount, state.production, ENGINE_HALF_COST - half);

  if (paid <= 0) {
    return;
  }

  state.production -= paid;
  engine.engineHalves[player] = half + paid;
  engine.progress = engine.engineHalves.p1 + engine.engineHalves.p2;

  if (isBuilt(engine)) {
    log(game, "Двигатель острова достроен. Остров может двигаться!", "good");
    game.islandMovesLeft = engineSteps(game);
  }
};

const engineSteps = (game: TGame) => (isKnown(game.research, "electricity") ? 2 : 1);

const engineReady = (game: TGame) => {
  const engine = engineOf(game);

  return engine !== null && isBuilt(engine);
};

const homeIsland = (game: TGame) => game.islands.find((island) => island.home)!;

/** Why the home island may not step in `direction`, or `null` when it may. */
const islandMoveBlocker = (game: TGame, direction: number): string | null => {
  if (!engineReady(game)) {
    return "Двигатель не достроен";
  }

  if (game.islandMovesLeft <= 0) {
    return "Двигатель остыл до следующего хода";
  }

  const offset = HEX_DIRECTIONS[direction]!;
  const home = homeIsland(game);
  const own = new Set(home.tileIds);

  for (const id of home.tileIds) {
    const tile = game.tiles[id]!;
    const q = tile.q + offset.q;
    const r = tile.r + offset.r;
    const x = axialToOffsetX({ q, r });

    if (x < game.xRange.min || x > game.xRange.max || r < game.yRange.min || r > game.yRange.max) {
      return "Край мира";
    }

    const there = tileAt(game, q, r);
    if (there !== null && !own.has(there.id)) {
      return `Столкновение с островом ${islandById(game, there.islandId).name}`;
    }
  }

  return null;
};

const moveIsland = (game: TGame, direction: number) => {
  if (islandMoveBlocker(game, direction) !== null) {
    return;
  }

  const offset = HEX_DIRECTIONS[direction]!;
  const home = homeIsland(game);

  for (const id of home.tileIds) {
    const tile = game.tiles[id]!;
    tile.q += offset.q;
    tile.r += offset.r;
  }

  rebuildPosIndex(game);
  game.islandMovesLeft -= 1;
  discoverFactions(game);
  log(game, `Остров ${home.name} сдвинулся.`, "info");
};

const setResearch = (game: TGame, techId: string) => {
  if (!isResearchable(game.research, techId)) {
    return;
  }

  const research = game.research;
  research.current = techId;
  research.progress = research.banked;
  research.banked = 0;
  log(game, `Исследование: ${TECH_BY_ID[techId]!.name}.`, "info");
};

/** Every hex neighbouring the players' island that belongs to another island. */
const touchingIslands = (game: TGame): string[] => {
  const home = homeIsland(game);
  const found = new Set<string>();

  for (const id of home.tileIds) {
    const tile = game.tiles[id]!;

    for (const hex of neighboursOf(tile)) {
      const otherId = game.posIndex[hexKey(hex.q, hex.r)];
      const other = otherId === undefined ? undefined : game.tiles[otherId];

      if (other !== undefined && other.islandId !== home.id) {
        found.add(other.islandId);
      }
    }
  }

  return [...found];
};

const isCitadelFaction = (factionId: string) => factionId === HITECH_FACTION_ID;

export type { TBuildOption, TMoveOutcome, TReach };
export {
  bestSquadType,
  buildOptions,
  canAfford,
  canFoundPower,
  captureTile,
  checkDefeat,
  discoverFactions,
  engineOf,
  engineReady,
  engineSteps,
  formArmy,
  foundPower,
  homeIsland,
  investEngine,
  isCitadelFaction,
  islandMoveBlocker,
  moveIsland,
  moveUnit,
  ownBarracksOn,
  reachableTiles,
  reinforceArmy,
  setResearch,
  startBuilding,
  touchingIslands,
  trainCivilian,
};
