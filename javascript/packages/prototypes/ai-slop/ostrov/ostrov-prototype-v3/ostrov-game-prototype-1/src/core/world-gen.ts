import { ISLAND_TYPE_WEIGHTS, generateIsland } from "@hw/ostrov-island-system";
import { addBuilding, addUnit, log, rebuildPosIndex } from "./entities";
import { axialToOffsetX, offsetToAxial } from "./hex";
import { createFactions, HITECH_FACTION_ID, NATIVES_FACTION_ID, PLAYERS_FACTION_ID } from "./factions";
import { createResearchState } from "./tech";
import { createRng, hashSeed, hexDistance, hexKey, neighboursOf, shuffled } from "@hw/ostrov-utils";
import { generateWorld } from "@hw/ostrov-world-system";
import type { TAxial } from "@hw/ostrov-utils";
import type { TFaction, TGame, TGameIsland, TGameTile, TPlayerId, TPlayerState } from "./state";
import type { TTerrain } from "@hw/ostrov-island-system";
import type { TRange, TWorldConfig } from "@hw/ostrov-world-system";

/** Island sizes the design asks for: from 6 to 25 cells. */
const WORLD_CONFIG: TWorldConfig = {
  xRange: { min: -19, max: 19 },
  yRange: { min: -13, max: 13 },
  islandTiles: { min: 6, max: 25 },
  islandTypeCounts: { meadow: 2, forest: 2, hills: 2, mountain: 1, mixed: 3 },
};

/** The hi-tech city is far above the cap; that is its whole point. */
const CITADEL_TILES = 42;
const CITADEL_BOARD_RADIUS = 6;

/** World layouts tried before the city settles for the largest ordinary island. */
const LAYOUT_ATTEMPTS = 6;

/** Base fossil deposits of a fresh hex, by terrain. */
const DEPOSITS_BY_TERRAIN: Record<TTerrain, number> = {
  plains: 4,
  meadow: 5,
  forest: 6,
  hills: 8,
  mountain: 10,
};

const STARTING_PLAYER: Omit<TPlayerState, "id" | "name" | "accent"> = {
  production: 12,
  food: 10,
  metals: 0,
  population: 3,
  ready: false,
  powerBuildingId: null,
  defeated: false,
};

const createPlayers = (): Record<TPlayerId, TPlayerState> => ({
  p1: { ...STARTING_PLAYER, id: "p1", name: "Игрок 1", accent: "#7ee0ff" },
  p2: { ...STARTING_PLAYER, id: "p2", name: "Игрок 2", accent: "#ffb45e" },
});

const inWorld = (hex: TAxial, xRange: TRange, yRange: TRange) => {
  const x = axialToOffsetX(hex);

  return x >= xRange.min && x <= xRange.max && hex.r >= yRange.min && hex.r <= yRange.max;
};

/**
 * Finds room for the citadel after the ordinary islands were placed. The blocked
 * set holds every land hex plus its ring, so the city keeps one hex of sea around it.
 */
const placeCitadel = (footprint: readonly TAxial[], landHexes: readonly TAxial[], xRange: TRange, yRange: TRange, seed: number) => {
  const blocked = new Set<string>();
  for (const hex of landHexes) {
    blocked.add(hexKey(hex.q, hex.r));

    for (const neighbour of neighboursOf(hex)) {
      blocked.add(hexKey(neighbour.q, neighbour.r));
    }
  }

  const anchors: TAxial[] = [];
  for (let y = yRange.min; y <= yRange.max; y += 1) {
    for (let x = xRange.min; x <= xRange.max; x += 1) {
      anchors.push(offsetToAxial(x, y));
    }
  }

  for (const anchor of shuffled(anchors, createRng(seed))) {
    const moved = footprint.map((hex) => ({ q: hex.q + anchor.q, r: hex.r + anchor.r }));
    const fits = moved.every((hex) => inWorld(hex, xRange, yRange) && !blocked.has(hexKey(hex.q, hex.r)));

    if (fits) {
      return moved;
    }
  }

  return null;
};

const centreTile = (tiles: readonly TGameTile[]) => {
  const total = tiles.reduce((sum, tile) => ({ q: sum.q + tile.q, r: sum.r + tile.r }), { q: 0, r: 0 });
  const centre = { q: total.q / tiles.length, r: total.r / tiles.length };

  return [...tiles].sort((a, b) => hexDistance(a, centre) - hexDistance(b, centre))[0]!;
};

const farthestTile = (tiles: readonly TGameTile[], from: TAxial) => {
  return [...tiles].sort((a, b) => hexDistance(b, from) - hexDistance(a, from))[0]!;
};

const freeTiles = (game: TGame, island: TGameIsland) => {
  return island.tileIds.map((id) => game.tiles[id]!).filter((tile) => tile.buildingId === null);
};

const islandTiles = (game: TGame, island: TGameIsland) => island.tileIds.map((id) => game.tiles[id]!);

const populateRival = (game: TGame, faction: TFaction, island: TGameIsland, rng: ReturnType<typeof createRng>) => {
  const tiles = islandTiles(game, island);
  const centre = centreTile(tiles);
  addBuilding(game, "power", faction.id, null, centre.id, true);

  const around = shuffled(freeTiles(game, island), rng);
  const barracksTile = around[0];
  if (barracksTile !== undefined) {
    addBuilding(game, "barracks", faction.id, null, barracksTile.id, true);
  }

  for (const tile of around.slice(1, 4)) {
    const type = tile.terrain === "hills" || tile.terrain === "mountain" ? "mine" : tile.terrain === "forest" ? "workshop" : "farm";
    addBuilding(game, type, faction.id, null, tile.id, true);
  }

  addUnit(game, "army", faction.id, null, centre.id, ["spearmen", "spearmen"]);
  if (barracksTile !== undefined) {
    addUnit(game, "army", faction.id, null, barracksTile.id, ["spearmen", "archers"]);
  }

  faction.homeIslandId = island.id;
};

const populateCitadel = (game: TGame, island: TGameIsland, rng: ReturnType<typeof createRng>) => {
  const tiles = islandTiles(game, island);
  const core = centreTile(tiles);
  addBuilding(game, "core", HITECH_FACTION_ID, null, core.id, true);

  const around = shuffled(freeTiles(game, island), rng);
  const towers = around.slice(0, 3);
  for (const tile of towers) {
    addBuilding(game, "barracks", HITECH_FACTION_ID, null, tile.id, true);
  }

  for (const tile of around.slice(3, 9)) {
    addBuilding(game, rng.next() < 0.5 ? "lab" : "workshop", HITECH_FACTION_ID, null, tile.id, true);
  }

  addUnit(game, "army", HITECH_FACTION_ID, null, core.id, ["mech", "drone", "drone"]);
  for (const tile of towers.slice(0, 2)) {
    addUnit(game, "army", HITECH_FACTION_ID, null, tile.id, ["drone", "drone", "mech"]);
  }
};

const populateNatives = (game: TGame, island: TGameIsland, avoid: TAxial | null) => {
  const tiles = islandTiles(game, island);
  const spot = avoid === null ? centreTile(tiles) : farthestTile(tiles, avoid);

  addBuilding(game, "camp", NATIVES_FACTION_ID, null, spot.id, true);
  addUnit(game, "army", NATIVES_FACTION_ID, null, spot.id, ["tribesmen", "tribesmen"]);
};

/**
 * Builds a whole game from a seed: the hex world of islands, the hi-tech city, the
 * fossil deposits, the roster of factions with their homes, and the two players'
 * starting party on the home island, with a natives camp on its far shore.
 */
const createGame = (seedText: string): TGame => {
  const seed = hashSeed(seedText);
  const rng = createRng(seed ^ 0x51ed);

  // The city is placed after the ordinary islands. A crowded layout may leave it
  // no room, so the layout is rerolled a few times before the fallback is taken.
  const citadelIsland = generateIsland({
    seedText: `${seedText}#nexus`,
    boardRadius: CITADEL_BOARD_RADIUS,
    landCount: CITADEL_TILES,
    terrainWeights: ISLAND_TYPE_WEIGHTS.hills,
  });
  const footprint = citadelIsland.landTiles();
  let world = generateWorld({ seedText, ...WORLD_CONFIG });
  let placedCitadel = placeCitadel(footprint, world.tiles, world.xRange, world.yRange, seed ^ 0xc17a);

  for (let attempt = 1; placedCitadel === null && attempt < LAYOUT_ATTEMPTS; attempt += 1) {
    world = generateWorld({ seedText: `${seedText}~${attempt}`, ...WORLD_CONFIG });
    placedCitadel = placeCitadel(footprint, world.tiles, world.xRange, world.yRange, seed ^ 0xc17a ^ attempt);
  }

  const game: TGame = {
    seedText,
    turn: 1,
    phase: "planning",
    result: null,
    xRange: world.xRange,
    yRange: world.yRange,
    factions: createFactions(),
    islands: [],
    tiles: {},
    posIndex: {},
    units: {},
    buildings: {},
    players: createPlayers(),
    research: createResearchState(),
    log: [],
    pendingBattles: [],
    curtainLines: [],
    islandMovesLeft: 0,
    nextId: 1,
  };

  const addTile = (islandId: string, order: number, hex: TAxial, terrain: TTerrain, coastal: boolean) => {
    const deposits = Math.max(1, DEPOSITS_BY_TERRAIN[terrain] + rng.int(-1, 2));
    const tile: TGameTile = {
      id: `${islandId}:${order}`,
      islandId,
      q: hex.q,
      r: hex.r,
      terrain,
      coastal,
      deposits,
      depositsMax: deposits,
      buildingId: null,
    };
    game.tiles[tile.id] = tile;

    return tile.id;
  };

  for (const placed of world.islands) {
    const island: TGameIsland = {
      id: placed.id,
      name: placed.name,
      type: placed.type,
      tileIds: placed.tiles.map((tile, order) => addTile(placed.id, order, tile, tile.terrain, tile.coastal)),
      citadel: false,
      home: false,
    };
    game.islands.push(island);
  }

  if (placedCitadel !== null) {
    const island: TGameIsland = {
      id: "nexus",
      name: "Нексус",
      type: "hills",
      tileIds: footprint.map((tile, order) => addTile("nexus", order, placedCitadel[order]!, tile.terrain!, tile.coastal)),
      citadel: true,
      home: false,
    };
    game.islands.push(island);
  }

  rebuildPosIndex(game);

  // Homes: the biggest ordinary island is the players'; the next four go to the rivals.
  const ordinary = game.islands.filter((island) => !island.citadel).sort((a, b) => b.tileIds.length - a.tileIds.length);

  let citadel = game.islands.find((island) => island.citadel) ?? null;
  if (citadel === null) {
    // No room for the city: the largest island stands in for it.
    citadel = ordinary.shift()!;
    citadel.citadel = true;
    citadel.name = "Нексус";
  }

  const home = ordinary.shift()!;
  home.home = true;

  const players = game.factions.find((faction) => faction.id === PLAYERS_FACTION_ID)!;
  players.homeIslandId = home.id;
  game.factions.find((faction) => faction.id === HITECH_FACTION_ID)!.homeIslandId = citadel.id;

  const rivals = game.factions.filter((faction) => faction.kind === "rival");
  rivals.forEach((faction, index) => {
    const island = ordinary[index];

    if (island === undefined) {
      faction.alive = false;

      return;
    }

    populateRival(game, faction, island, rng);
  });

  populateCitadel(game, citadel, rng);

  for (const island of ordinary.slice(rivals.length)) {
    populateNatives(game, island, null);
  }

  // The players' party lands on the shore; the camp sits on the far side.
  const homeTiles = islandTiles(game, home);
  const startTile = shuffled(homeTiles.filter((tile) => tile.coastal), rng)[0] ?? homeTiles[0]!;
  const partner =
    neighboursOf(startTile)
      .map((hex) => game.posIndex[hexKey(hex.q, hex.r)])
      .filter((id): id is string => id !== undefined && game.tiles[id]!.islandId === home.id)[0] ?? startTile.id;

  addUnit(game, "settler", PLAYERS_FACTION_ID, "p1", startTile.id);
  addUnit(game, "builders", PLAYERS_FACTION_ID, "p1", startTile.id);
  addUnit(game, "army", PLAYERS_FACTION_ID, "p1", startTile.id, ["militia", "militia"]);
  addUnit(game, "settler", PLAYERS_FACTION_ID, "p2", partner);
  addUnit(game, "builders", PLAYERS_FACTION_ID, "p2", partner);
  addUnit(game, "army", PLAYERS_FACTION_ID, "p2", partner, ["militia", "militia"]);

  populateNatives(game, home, startTile);

  for (const unit of Object.values(game.units)) {
    if (unit.factionId === PLAYERS_FACTION_ID) {
      unit.movesLeft = 2;
    }
  }

  log(game, `Два племени высадились на острове ${home.name}. Основайте Центры Власти.`, "good");
  log(game, "На дальнем берегу дымит лагерь туземцев.", "bad");

  return game;
};

export { WORLD_CONFIG, createGame };
