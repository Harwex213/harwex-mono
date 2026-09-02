import { BUILDING_DEFS, SQUAD_DEFS, UNIT_DEFS } from "./catalog";
import { hexKey, neighboursOf } from "@hw/ostrov-utils";
import type { TBuilding, TBuildingType, TGame, TGameTile, TLogEntry, TPlayerId, TSquad, TSquadType, TUnit, TUnitType } from "./state";

const nextId = (game: TGame, prefix: string) => {
  const id = `${prefix}-${game.nextId}`;
  game.nextId += 1;

  return id;
};

const tileAt = (game: TGame, q: number, r: number): TGameTile | null => {
  const id = game.posIndex[hexKey(q, r)];

  if (id === undefined) {
    return null;
  }

  return game.tiles[id] ?? null;
};

const tileOf = (game: TGame, unit: TUnit) => game.tiles[unit.tileId]!;

const unitsOnTile = (game: TGame, tileId: string) => {
  return Object.values(game.units).filter((unit) => unit.tileId === tileId);
};

const buildingOn = (game: TGame, tileId: string): TBuilding | null => {
  const tile = game.tiles[tileId];

  if (tile === undefined || tile.buildingId === null) {
    return null;
  }

  return game.buildings[tile.buildingId] ?? null;
};

const isBuilt = (building: TBuilding) => building.progress >= building.cost;

/** Land neighbours of a hex, whatever island they belong to. */
const landNeighbours = (game: TGame, tile: TGameTile): TGameTile[] => {
  return neighboursOf(tile)
    .map((hex) => tileAt(game, hex.q, hex.r))
    .filter((found): found is TGameTile => found !== null);
};

const rebuildPosIndex = (game: TGame) => {
  const index: Record<string, string> = {};

  for (const tile of Object.values(game.tiles)) {
    index[hexKey(tile.q, tile.r)] = tile.id;
  }

  game.posIndex = index;
};

const createSquad = (game: TGame, type: TSquadType): TSquad => {
  const def = SQUAD_DEFS[type];

  return { id: nextId(game, "sq"), type, hp: def.hp, hpMax: def.hp, slot: null };
};

const addUnit = (
  game: TGame,
  type: TUnitType,
  factionId: string,
  owner: TPlayerId | null,
  tileId: string,
  squadTypes: readonly TSquadType[] = []
): TUnit => {
  const unit: TUnit = {
    id: nextId(game, "u"),
    type,
    factionId,
    owner,
    tileId,
    movesLeft: 0,
    name: UNIT_DEFS[type].name,
    squads: squadTypes.map((squadType) => createSquad(game, squadType)),
  };

  game.units[unit.id] = unit;

  return unit;
};

const removeUnit = (game: TGame, unitId: string) => {
  delete game.units[unitId];
};

/** Places a building. `complete` skips the construction and makes it work at once. */
const addBuilding = (
  game: TGame,
  type: TBuildingType,
  factionId: string,
  owner: TPlayerId | null,
  tileId: string,
  complete: boolean
): TBuilding => {
  const def = BUILDING_DEFS[type];
  const building: TBuilding = {
    id: nextId(game, "b"),
    type,
    factionId,
    owner,
    tileId,
    progress: complete ? def.cost : 0,
    cost: def.cost,
    engineHalves: type === "engine" ? { p1: 0, p2: 0 } : null,
  };

  game.buildings[building.id] = building;
  game.tiles[tileId]!.buildingId = building.id;

  return building;
};

const removeBuilding = (game: TGame, buildingId: string) => {
  const building = game.buildings[buildingId];

  if (building === undefined) {
    return;
  }

  const tile = game.tiles[building.tileId];
  if (tile !== undefined && tile.buildingId === buildingId) {
    tile.buildingId = null;
  }

  delete game.buildings[buildingId];
};

const log = (game: TGame, text: string, tone: TLogEntry["tone"] = "info") => {
  game.log.unshift({ id: game.nextId, turn: game.turn, text, tone });
  game.nextId += 1;

  if (game.log.length > 120) {
    game.log.length = 120;
  }
};

const factionById = (game: TGame, id: string) => game.factions.find((faction) => faction.id === id)!;

const islandById = (game: TGame, id: string) => game.islands.find((island) => island.id === id)!;

const buildingsOf = (game: TGame, factionId: string) => {
  return Object.values(game.buildings).filter((building) => building.factionId === factionId);
};

const unitsOf = (game: TGame, factionId: string) => {
  return Object.values(game.units).filter((unit) => unit.factionId === factionId);
};

export {
  addBuilding,
  addUnit,
  buildingOn,
  buildingsOf,
  createSquad,
  factionById,
  isBuilt,
  islandById,
  landNeighbours,
  log,
  nextId,
  rebuildPosIndex,
  removeBuilding,
  removeUnit,
  tileAt,
  tileOf,
  unitsOf,
  unitsOnTile,
};
