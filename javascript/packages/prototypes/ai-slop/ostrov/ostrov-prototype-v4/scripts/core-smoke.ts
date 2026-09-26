import {
  BIOMES,
  BIOME_ORDER,
  BUILDINGS,
  BUILDING_ORDER,
  HEX_SIZE_PX,
  INITIAL_RESOURCES,
  PENTAGON_CELL_COUNT,
  TECHS,
  TECH_ORDER,
  WORLD_CELL_COUNT,
  addToxicity,
  applyInsaneConversion,
  applyUpkeep,
  applyYields,
  computeTaxYields,
  createBattleLevel,
  createIsland,
  createRng,
  createWorld,
  hexId,
  hexNeighbours,
  hexToPixel,
  hexYield,
  islandToxicityPoints,
  legalHexesFor,
  pixelToHex,
  rollTrailEvent,
  setBuilding,
  stepBattle,
} from "../src/core/exports";
import type {
  TBattleInput,
  TBattleState,
  TBiomeId,
  TBuildingId,
  THex,
  TIsland,
  TResources,
  TTechId,
} from "../src/core/exports";

/**
 * The pure-model smoke run of `src/core/`: no React, no DOM, no browser.
 * `yarn workspace @hw/ostrov-prototype-v4 smoke`.
 *
 * S2 wrote this file and a later cleanup deleted it along with the throwaway
 * self-check scripts; S8 rebuilt it from the check list in
 * `docs/analysis/02-s2-core-report.md §3`. Every check below is one of that
 * list, in the same order.
 */

const SMOKE_SEED = 4242;
const OTHER_SEED = 99;
const HUMAN_ID = "p1";
const HEX_SPAN = 5;
const TRAIL_ROLLS = 200;
const EVENT_TRAIL = 40;
const BATTLE_TICKS = 300;
const BATTLE_TURN = 3;
const NO_EXTRA_ENEMIES = 0;
const NO_TECHS: readonly TTechId[] = [];
/** The purge ritual of plan §3.3: 5 💠 take 20 ☣️ off one hex, never below zero. */
const PURGE_TOXICITY_DELTA = 20;
const PURGE_START_TOXICITY = 30;
const PURGE_SMALL_TOXICITY = 8;
const RIGHT_INPUT: TBattleInput = { up: false, down: false, left: false, right: true };

const failures: string[] = [];

const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : ` — ${detail}`}`);
  if (ok === false) {
    failures.push(name);
  }
};

const makeHex = (biome: TBiomeId, building: TBuildingId | null, toxicity: number): THex => {
  return { id: hexId(0, 0), q: 0, r: 0, biome, building, toxicity };
};

const islandOf = (hexes: readonly THex[]): TIsland => {
  return {
    ownerId: HUMAN_ID,
    hexes: hexes.reduce((map, hex) => {
      map[hex.id] = hex;

      return map;
    }, {} as Record<string, THex>),
  };
};

/** A breadth-first walk over the axial neighbours of the island's hexes. */
const reachableHexCount = (island: TIsland): number => {
  const ids = Object.keys(island.hexes);
  const first = ids[0];
  if (first === undefined) {
    return 0;
  }

  const seen = new Set<string>([first]);
  const queue: string[] = [first];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }

    const hex = island.hexes[current];
    if (hex === undefined) {
      continue;
    }

    for (const neighbour of hexNeighbours(hex.q, hex.r)) {
      const id = hexId(neighbour.q, neighbour.r);
      if (island.hexes[id] === undefined || seen.has(id) === true) {
        continue;
      }

      seen.add(id);
      queue.push(id);
    }
  }

  return seen.size;
};

const main = (): void => {
  const island = createIsland(SMOKE_SEED, HUMAN_ID);
  const hexCount = Object.keys(island.hexes).length;
  check("island size is 12..20", hexCount >= 12 && hexCount <= 20, `${hexCount} hexes`);

  const reached = reachableHexCount(island);
  check("island is connected", reached === hexCount, `${reached} reached`);

  const farmHexes = legalHexesFor(island, "farm").length;
  const sawmillHexes = legalHexesFor(island, "sawmill").length;
  const mineHexes = legalHexesFor(island, "mine").length;
  check(
    "island can host a farm, a sawmill and a mine on turn one",
    farmHexes > 0 && sawmillHexes > 0 && mineHexes > 0,
    `farm ${farmHexes}, sawmill ${sawmillHexes}, mine ${mineHexes}`,
  );

  const cells = createWorld(SMOKE_SEED);
  check("world has 92 cells", cells.length === WORLD_CELL_COUNT, `${cells.length} cells`);

  const pentagons = cells.filter((cell) => {
    return cell.corners.length === 5;
  }).length;
  check(
    "world has 12 pentagons and 80 hexagons",
    pentagons === PENTAGON_CELL_COUNT && cells.length - pentagons === WORLD_CELL_COUNT - PENTAGON_CELL_COUNT,
    `${pentagons} / ${cells.length - pentagons}`,
  );

  const symmetric = cells.every((cell) => {
    return cell.neighbours.every((id) => {
      const other = cells[id];

      return other !== undefined && other.neighbours.includes(cell.id) === true;
    });
  });
  check("every world neighbour relation is symmetric", symmetric === true, "");

  const start = cells.find((cell) => {
    return cell.occupantId === HUMAN_ID;
  });
  const startRevealed = start !== undefined
    && start.revealed === true
    && start.neighbours.every((id) => {
      return cells[id]?.revealed === true;
    });
  check("the start cell holds p1 and is revealed with its neighbours", startRevealed === true, "");

  const tablesSane = BUILDING_ORDER.every((building) => {
    const info = BUILDINGS[building];
    const entries = Object.values(info.yields);

    return entries.length > 0 && entries.every((entry) => {
      return entry !== undefined && entry.amount > 0 && entry.toxicity >= 0;
    });
  });
  check("every building yield table matches the spec", tablesSane === true, "");

  const spots = BUILDINGS.farm.yields.swamp?.amount === 5
    && BUILDINGS.farm.yields.swamp?.toxicity === 3
    && BUILDINGS.mine.yields.volcano?.amount === 10
    && BUILDINGS.mine.yields.volcano?.toxicity === 5
    && BUILDINGS.sawmill.yields.rainforest?.amount === 8
    && BUILDINGS.sawmill.yields.rainforest?.toxicity === 4
    && BUILDINGS.village.yields.badlands?.amount === 1
    && BUILDINGS.village.yields.badlands?.toxicity === 4
    && BUILDINGS.university.yields.cliffs?.amount === 1
    && BUILDINGS.university.yields.cliffs?.toxicity === 0;
  check(
    "spot values farm/swamp 5-3, mine/volcano 10-5, sawmill/rainforest 8-4, village/badlands 1-4, university/cliffs 1-0",
    spots === true,
    "",
  );

  check(
    "16 biomes, 7 buildings, 8 techs",
    BIOME_ORDER.length === 16 && Object.keys(BIOMES).length === 16
      && BUILDING_ORDER.length === 7 && TECH_ORDER.length === 8 && Object.keys(TECHS).length === 8,
    `${BIOME_ORDER.length} / ${BUILDING_ORDER.length} / ${TECH_ORDER.length}`,
  );

  const cleanFarm = hexYield(makeHex("grassland", "farm", 0), NO_TECHS);
  check("a clean grassland farm yields 4 food", cleanFarm?.amount === 4, `${cleanFarm?.amount}`);

  const poisonedFarm = hexYield(makeHex("grassland", "farm", 50), NO_TECHS);
  check("a farm at 50 toxicity yields 0 food", poisonedFarm?.amount === 0, `${poisonedFarm?.amount}`);

  const deadHex = hexYield(makeHex("grassland", "farm", 100), NO_TECHS);
  check("a hex at 100 toxicity yields nothing", deadHex === null, "");

  const irrigated = hexYield(makeHex("grassland", "farm", 0), ["irrigation"]);
  check("irrigation adds 1 food to a farm", irrigated?.amount === 5, `${irrigated?.amount}`);

  const deepMine = hexYield(makeHex("volcano", "mine", 0), ["scrubbers", "deep_shafts"]);
  check(
    "scrubbers and deep shafts give a volcano mine 12 stone at 5 toxicity",
    deepMine?.amount === 12 && deepMine?.toxicity === 5,
    `${deepMine?.amount}/${deepMine?.toxicity}`,
  );

  const converted = applyInsaneConversion({ ...INITIAL_RESOURCES, population: 10 }, 45);
  const capped = applyInsaneConversion({ ...INITIAL_RESOURCES, population: 6 }, 400);
  check(
    "insane conversion is floor(points / 10), capped by population",
    converted.insane === 4 && capped.insane === 6 && capped.population === 0,
    `${converted.insane} then ${capped.insane}`,
  );

  const fed: TResources = { ...INITIAL_RESOURCES, food: 16, population: 4, insane: 1 };
  const afterUpkeep = applyUpkeep(fed);
  const starving: TResources = { ...INITIAL_RESOURCES, food: 0, population: 4, insane: 1 };
  const afterStarvation = applyUpkeep(starving);
  check(
    "upkeep eats 1 food per citizen and 2 per insane, then starves",
    afterUpkeep.food === 10 && afterStarvation.food === 0 && afterStarvation.population === 1
      && afterStarvation.insane === 2,
    `${afterUpkeep.food}, then ${afterStarvation.population} left and ${afterStarvation.insane} insane`,
  );

  const guildIsland = islandOf([makeHex("grassland", "masons_guild", 0)]);
  const withoutInsane = computeTaxYields(guildIsland, NO_TECHS, 0);
  const withInsane = computeTaxYields(guildIsland, NO_TECHS, 50);
  const farmIsland = islandOf([makeHex("grassland", "farm", 0)]);
  const foodWithInsane = computeTaxYields(farmIsland, NO_TECHS, 50);
  check(
    "the insane halve hammers but never food",
    withoutInsane[0]?.amount === 3 && withInsane[0]?.amount === 1 && foodWithInsane[0]?.amount === 4,
    `hammers ${withoutInsane[0]?.amount} → ${withInsane[0]?.amount}, food ${foodWithInsane[0]?.amount}`,
  );

  const paid = applyYields(INITIAL_RESOURCES, [
    { hexId: hexId(0, 0), resource: "food", amount: 4, toxicity: 1 },
    { hexId: hexId(1, 0), resource: "food", amount: 0, toxicity: 1 },
  ]);
  check(
    "applyYields adds amounts and toxicity",
    paid.food === INITIAL_RESOURCES.food + 4 && paid.toxicity === INITIAL_RESOURCES.toxicity + 2,
    `${paid.food} food, ${paid.toxicity} toxicity`,
  );

  const poisonedIsland = islandOf([
    { id: hexId(0, 0), q: 0, r: 0, biome: "grassland", building: null, toxicity: 12 },
    { id: hexId(1, 0), q: 1, r: 0, biome: "plains", building: null, toxicity: 7 },
  ]);
  check(
    "island toxicity points sum the hexes",
    islandToxicityPoints(poisonedIsland) === 19,
    `${islandToxicityPoints(poisonedIsland)}`,
  );

  const first = createRng(SMOKE_SEED);
  const second = createRng(SMOKE_SEED);
  const third = createRng(OTHER_SEED);
  const a = [first.next(), first.next(), first.next()];
  const b = [second.next(), second.next(), second.next()];
  const c = [third.next(), third.next(), third.next()];
  check(
    "the same seed reproduces and a different seed does not",
    a.join() === b.join() && a.join() !== c.join(),
    "",
  );

  const twin = createIsland(SMOKE_SEED, HUMAN_ID);
  check(
    "createIsland is deterministic",
    JSON.stringify(twin) === JSON.stringify(island),
    "",
  );

  let inverted = true;
  for (let q = -HEX_SPAN; q <= HEX_SPAN; q += 1) {
    for (let r = -HEX_SPAN; r <= HEX_SPAN; r += 1) {
      const point = hexToPixel(q, r, HEX_SIZE_PX);
      const back = pixelToHex(point.x, point.y, HEX_SIZE_PX);
      if (back.q !== q || back.r !== r) {
        inverted = false;
      }
    }
  }
  check("pixelToHex inverts hexToPixel for q,r in -5..5", inverted === true, "");

  let fired = 0;
  for (let index = 0; index < TRAIL_ROLLS; index += 1) {
    const rng = createRng(SMOKE_SEED + index);
    if (rollTrailEvent(rng, EVENT_TRAIL, false) !== null) {
      fired += 1;
    }
  }
  check(
    "a trail of 40 fires an event sometimes and not always",
    fired > 0 && fired < TRAIL_ROLLS,
    `${fired} of ${TRAIL_ROLLS}`,
  );

  const battleIsland = setBuilding(island, Object.keys(island.hexes)[0] ?? "", "village");
  const level = createBattleLevel(SMOKE_SEED, battleIsland, BATTLE_TURN, NO_EXTRA_ENEMIES, NO_TECHS);
  const cleared: TBattleState = {
    ...level,
    units: level.units.filter((unit) => {
      return unit.side === "player";
    }),
  };
  let stepped: TBattleState = cleared;
  for (let tick = 0; tick < BATTLE_TICKS; tick += 1) {
    stepped = stepBattle(stepped, 100, RIGHT_INPUT);
  }
  const absorbed = stepped.enemyIslands.filter((enemy) => {
    return enemy.absorbed === true;
  }).length;
  check(
    "300 ticks with the enemies removed absorb at least one island",
    absorbed >= 1,
    `${absorbed} of ${stepped.enemyIslands.length} absorbed, ${stepped.absorbedHexes.length} hexes`,
  );

  check("the battle reports itself finished once no enemy lives", stepped.finished === true, "");

  const poisonedId = Object.keys(island.hexes)[0] ?? "";
  const poisoned = addToxicity(island, poisonedId, PURGE_START_TOXICITY);
  const startToxicity = poisoned.hexes[poisonedId]?.toxicity ?? -1;
  const purged = addToxicity(poisoned, poisonedId, -PURGE_TOXICITY_DELTA);
  check(
    "a purge takes 20 toxicity off the hex",
    purged.hexes[poisonedId]?.toxicity === startToxicity - PURGE_TOXICITY_DELTA,
    `${startToxicity} → ${purged.hexes[poisonedId]?.toxicity}`,
  );

  const barely = addToxicity(island, poisonedId, PURGE_SMALL_TOXICITY);
  const clamped = addToxicity(barely, poisonedId, -PURGE_TOXICITY_DELTA);
  check(
    "a purge of a barely poisoned hex clamps at zero",
    clamped.hexes[poisonedId]?.toxicity === 0,
    `${barely.hexes[poisonedId]?.toxicity} − ${PURGE_TOXICITY_DELTA} → ${clamped.hexes[poisonedId]?.toxicity}`,
  );

  if (failures.length > 0) {
    console.log(`FAILED ${failures.length}: ${failures.join(", ")}`);
    process.exit(1);
  }

  console.log("ALL PASS");
};

main();
