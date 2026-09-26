import { hexToPixel } from "./hex";
import { createIsland } from "./island-gen";
import { createRng, hashUnit } from "./rng";

import type { THex, TBattleInput, TBattleIsland, TBattleState, TIsland, TRng, TTechId, TUnit } from "./types";

/**
 * The clearing phase (plan §3.8): a pure auto-battler over a 1600x1200 world.
 * `stepBattle` accumulates real time and runs one 100 ms tick at a time, so the
 * result never depends on the frame rate. Nothing here touches the DOM.
 */

type TUnitStats = {
  readonly hp: number;
  readonly dmg: number;
  readonly range: number;
  readonly speed: number;
  readonly air: boolean;
};

type TPoint = {
  readonly x: number;
  readonly y: number;
};

const BATTLE_WORLD_W = 1600;
const BATTLE_WORLD_H = 1200;

/** The battle draws the island smaller than the island page does, so several fit in the world. */
const BATTLE_HEX_SIZE_PX = 24;

const BATTLE_TICK_MS = 100;
const MS_PER_SECOND = 1000;

const PLAYER_ISLAND_SPEED_PX_S = 120;
const PLAYER_ISLAND_START_X_PX = 320;

/** Enemy islands keep this far from each other and from the player's start. */
const MIN_ISLAND_GAP_PX = 400;
const ISLAND_PLACEMENT_MARGIN_PX = 280;
const ISLAND_PLACEMENT_ATTEMPTS = 400;

const MIN_ENEMY_ISLANDS = 2;
const MAX_ENEMY_ISLANDS = 4;
const ENEMY_ISLAND_SEED_STEP = 977;

const BASE_ENEMIES_PER_ISLAND = 3;
const ENEMIES_PER_TURN_DIVISOR = 2;
const MAX_ENEMIES_PER_ISLAND = 12;
const ENEMY_HP_BONUS_PER_STEP = 0.1;
const ENEMY_HP_TURN_STEP = 5;

const PLAYER_MILITIA_KIND = "ополченец";
const CONSCRIPTION_HP_BONUS = 10;

/** A unit walks at a hostile it can see this far away; further off it just wanders. */
const AGGRO_RANGE_PX = 250;
const WANDER_RADIUS_PX = 60;
const WANDER_TURN_RAD_PER_TICK = 0.05;
const UNIT_SPAWN_JITTER_PX = 14;
const TAU = Math.PI * 2;

const unitStats = (hp: number, dmg: number, range: number, speed: number, air: boolean): TUnitStats => {
  return { hp, dmg, range, speed, air };
};

/**
 * Every unit of plan §3.8. The cavalry entries are the mounted variants the plan
 * resolves the spec's duplicated list into: +25% HP, +50% speed, same damage and range.
 */
const UNIT_STATS: Readonly<Record<string, TUnitStats>> = {
  "ополченец": unitStats(20, 3, 12, 40, false),
  "копейщик": unitStats(28, 5, 16, 38, false),
  "мечник": unitStats(36, 7, 12, 42, false),
  "алебардист": unitStats(44, 9, 18, 36, false),
  "рыцарь": unitStats(60, 11, 12, 55, false),
  "пращник": unitStats(16, 3, 70, 40, false),
  "лучник": unitStats(20, 4, 90, 40, false),
  "длинный лучник": unitStats(24, 6, 120, 36, false),
  "мушкетёр": unitStats(28, 9, 100, 34, false),
  "конный пращник": unitStats(20, 3, 70, 60, false),
  "конный лучник": unitStats(25, 4, 90, 60, false),
  "конный длинный лучник": unitStats(30, 6, 120, 54, false),
  "конный мушкетёр": unitStats(35, 9, 100, 51, false),
  "ворона": unitStats(14, 2, 12, 70, true),
  "великий орёл": unitStats(30, 6, 14, 80, true),
  "грифон": unitStats(45, 9, 16, 75, true),
  "волк": unitStats(18, 4, 12, 60, false),
  "паук": unitStats(16, 5, 14, 45, false),
  "пиявка": unitStats(12, 3, 10, 30, false),
  "скелет": unitStats(24, 5, 12, 38, false),
  "зомби": unitStats(30, 4, 12, 26, false),
  "огр": unitStats(70, 12, 16, 28, false),
  "ведьма": unitStats(26, 7, 90, 34, false),
  "вампир": unitStats(50, 10, 14, 50, false),
  "моль": unitStats(14, 3, 12, 65, true),
  "летучая мышь": unitStats(12, 2, 10, 70, true),
};

const ENEMY_KINDS: readonly string[] = [
  "волк",
  "паук",
  "пиявка",
  "скелет",
  "зомби",
  "огр",
  "ведьма",
  "вампир",
  "моль",
  "летучая мышь",
];

const PLAYER_ISLAND_ID = "player";

/** The pixel centre of every hex of a battle island. */
const islandHexCentres = (island: TBattleIsland): readonly TPoint[] => {
  return island.hexes.map((hex) => {
    const offset = hexToPixel(hex.q, hex.r, BATTLE_HEX_SIZE_PX);
    return { x: island.x + offset.x, y: island.y + offset.y };
  });
};

/** Two footprints touch when any pair of their hex discs touches. */
const islandsOverlap = (left: TBattleIsland, right: TBattleIsland): boolean => {
  const reach = BATTLE_HEX_SIZE_PX * 2;
  const leftCentres = islandHexCentres(left);
  const rightCentres = islandHexCentres(right);
  for (const a of leftCentres) {
    for (const b of rightCentres) {
      if (Math.hypot(a.x - b.x, a.y - b.y) < reach) {
        return true;
      }
    }
  }
  return false;
};

/** How far the island centre may travel before a hex leaves the world. */
const islandBounds = (island: TBattleIsland): { minX: number; maxX: number; minY: number; maxY: number } => {
  let minOffsetX = 0;
  let maxOffsetX = 0;
  let minOffsetY = 0;
  let maxOffsetY = 0;
  for (const hex of island.hexes) {
    const offset = hexToPixel(hex.q, hex.r, BATTLE_HEX_SIZE_PX);
    minOffsetX = Math.min(minOffsetX, offset.x);
    maxOffsetX = Math.max(maxOffsetX, offset.x);
    minOffsetY = Math.min(minOffsetY, offset.y);
    maxOffsetY = Math.max(maxOffsetY, offset.y);
  }
  return {
    minX: BATTLE_HEX_SIZE_PX - minOffsetX,
    maxX: BATTLE_WORLD_W - BATTLE_HEX_SIZE_PX - maxOffsetX,
    minY: BATTLE_HEX_SIZE_PX - minOffsetY,
    maxY: BATTLE_WORLD_H - BATTLE_HEX_SIZE_PX - maxOffsetY,
  };
};

const clamp = (value: number, min: number, max: number): number => {
  if (min > max) {
    return (min + max) / 2;
  }
  return Math.max(min, Math.min(max, value));
};

const spawnPoint = (rng: TRng, island: TBattleIsland): TPoint => {
  const hex = island.hexes.length > 0 ? rng.pick(island.hexes) : null;
  if (hex === null) {
    return { x: island.x, y: island.y };
  }
  const offset = hexToPixel(hex.q, hex.r, BATTLE_HEX_SIZE_PX);
  return {
    x: island.x + offset.x + (rng.next() - 0.5) * UNIT_SPAWN_JITTER_PX,
    y: island.y + offset.y + (rng.next() - 0.5) * UNIT_SPAWN_JITTER_PX,
  };
};

const createUnit = (
  id: string,
  kind: string,
  side: "player" | "enemy",
  homeIslandId: string,
  at: TPoint,
  hpBonus: number,
  hpMultiplier: number,
): TUnit => {
  const stats = UNIT_STATS[kind] ?? UNIT_STATS[PLAYER_MILITIA_KIND];
  if (stats === undefined) {
    throw new Error(`createUnit: no stats for ${kind}`);
  }
  const maxHp = Math.max(1, Math.round(stats.hp * hpMultiplier) + hpBonus);
  return {
    id,
    kind,
    side,
    homeIslandId,
    x: at.x,
    y: at.y,
    hp: maxHp,
    maxHp,
    dmg: stats.dmg,
    range: stats.range,
    speed: stats.speed,
    air: stats.air,
  };
};

const placeEnemyIslands = (rng: TRng, playerIsland: TBattleIsland, seed: number): readonly TBattleIsland[] => {
  const count = rng.int(MIN_ENEMY_ISLANDS, MAX_ENEMY_ISLANDS);
  const islands: TBattleIsland[] = [];
  for (let index = 0; index < count; index += 1) {
    let x = 0;
    let y = 0;
    let placed = false;
    for (let attempt = 0; attempt < ISLAND_PLACEMENT_ATTEMPTS; attempt += 1) {
      x = ISLAND_PLACEMENT_MARGIN_PX
        + rng.next() * (BATTLE_WORLD_W - ISLAND_PLACEMENT_MARGIN_PX * 2);
      y = ISLAND_PLACEMENT_MARGIN_PX
        + rng.next() * (BATTLE_WORLD_H - ISLAND_PLACEMENT_MARGIN_PX * 2);
      const tooClose = [playerIsland, ...islands].some((other) => {
        return Math.hypot(other.x - x, other.y - y) < MIN_ISLAND_GAP_PX;
      });
      if (tooClose === false) {
        placed = true;
        break;
      }
    }
    if (placed === false) {
      continue;
    }
    const islandSeed = seed + (index + 1) * ENEMY_ISLAND_SEED_STEP;
    const generated = createIsland(islandSeed, `enemy-${index + 1}`);
    islands.push({
      id: `enemy-${index + 1}`,
      side: "enemy",
      x,
      y,
      hexes: Object.values(generated.hexes),
      absorbed: false,
    });
  }
  return islands;
};

const createBattleLevel = (
  seed: number,
  island: TIsland,
  turn: number,
  extraEnemies: number,
  researched: readonly TTechId[],
): TBattleState => {
  const rng = createRng(seed);
  const hasConscription = researched.includes("conscription");
  const playerIsland: TBattleIsland = {
    id: PLAYER_ISLAND_ID,
    side: "player",
    x: PLAYER_ISLAND_START_X_PX,
    y: BATTLE_WORLD_H / 2,
    hexes: Object.values(island.hexes),
    absorbed: false,
  };
  const enemyIslands = placeEnemyIslands(rng, playerIsland, seed);
  const units: TUnit[] = [];
  const villages = playerIsland.hexes.filter((hex) => {
    return hex.building === "village";
  });
  const militiaPerVillage = hasConscription === true ? 2 : 1;
  const playerHpBonus = hasConscription === true ? CONSCRIPTION_HP_BONUS : 0;
  let militiaIndex = 0;
  for (const village of villages) {
    for (let copy = 0; copy < militiaPerVillage; copy += 1) {
      militiaIndex += 1;
      units.push(createUnit(
        `${PLAYER_ISLAND_ID}:u${militiaIndex}`,
        PLAYER_MILITIA_KIND,
        "player",
        PLAYER_ISLAND_ID,
        spawnPoint(rng, { ...playerIsland, hexes: [village] }),
        playerHpBonus,
        1,
      ));
    }
  }
  const perIsland = Math.min(
    MAX_ENEMIES_PER_ISLAND,
    BASE_ENEMIES_PER_ISLAND + Math.floor(turn / ENEMIES_PER_TURN_DIVISOR),
  ) + extraEnemies;
  const hpMultiplier = 1 + ENEMY_HP_BONUS_PER_STEP * Math.floor(turn / ENEMY_HP_TURN_STEP);
  for (const enemyIsland of enemyIslands) {
    for (let index = 0; index < perIsland; index += 1) {
      units.push(createUnit(
        `${enemyIsland.id}:u${index + 1}`,
        rng.pick(ENEMY_KINDS),
        "enemy",
        enemyIsland.id,
        spawnPoint(rng, enemyIsland),
        0,
        hpMultiplier,
      ));
    }
  }
  return {
    turn,
    playerIsland,
    enemyIslands,
    units,
    elapsedMs: 0,
    finished: false,
    absorbedHexes: [],
  };
};

type TMutableUnit = {
  id: string;
  kind: string;
  side: "player" | "enemy";
  homeIslandId: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dmg: number;
  range: number;
  speed: number;
  air: boolean;
};

const stepTowards = (unit: TMutableUnit, targetX: number, targetY: number, dtSeconds: number): void => {
  const dx = targetX - unit.x;
  const dy = targetY - unit.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-6) {
    return;
  }
  const step = Math.min(distance, unit.speed * dtSeconds);
  unit.x = clamp(unit.x + dx / distance * step, 0, BATTLE_WORLD_W);
  unit.y = clamp(unit.y + dy / distance * step, 0, BATTLE_WORLD_H);
};

/** One 100 ms tick: attack, close in, or wander around the home island. */
const runTick = (
  units: TMutableUnit[],
  homeCentres: ReadonlyMap<string, TPoint>,
  tickIndex: number,
): void => {
  const dtSeconds = BATTLE_TICK_MS / MS_PER_SECOND;
  for (const unit of units) {
    if (unit.hp <= 0) {
      continue;
    }
    let target: TMutableUnit | null = null;
    let targetDistance = Number.POSITIVE_INFINITY;
    for (const other of units) {
      if (other.hp <= 0 || other.side === unit.side) {
        continue;
      }
      const distance = Math.hypot(other.x - unit.x, other.y - unit.y);
      if (distance < targetDistance) {
        target = other;
        targetDistance = distance;
      }
    }
    if (target !== null && targetDistance <= unit.range) {
      target.hp -= unit.dmg;
      continue;
    }
    if (target !== null && targetDistance <= AGGRO_RANGE_PX) {
      stepTowards(unit, target.x, target.y, dtSeconds);
      continue;
    }
    const home = homeCentres.get(unit.homeIslandId);
    if (home === undefined) {
      continue;
    }
    const angle = hashUnit(unit.id) * TAU + tickIndex * WANDER_TURN_RAD_PER_TICK;
    stepTowards(
      unit,
      home.x + Math.cos(angle) * WANDER_RADIUS_PX,
      home.y + Math.sin(angle) * WANDER_RADIUS_PX,
      dtSeconds,
    );
  }
};

/**
 * Advances the level by `dtMs` of real time. The simulation keeps running after
 * `finished` turns true, so the player may still fly over a dead island and absorb it.
 */
const stepBattle = (state: TBattleState, dtMs: number, input: TBattleInput): TBattleState => {
  const dtSeconds = dtMs / MS_PER_SECOND;
  let moveX = (input.right === true ? 1 : 0) - (input.left === true ? 1 : 0);
  let moveY = (input.down === true ? 1 : 0) - (input.up === true ? 1 : 0);
  if (moveX !== 0 && moveY !== 0) {
    moveX /= Math.SQRT2;
    moveY /= Math.SQRT2;
  }
  const bounds = islandBounds(state.playerIsland);
  const playerIsland: TBattleIsland = {
    ...state.playerIsland,
    x: clamp(
      state.playerIsland.x + moveX * PLAYER_ISLAND_SPEED_PX_S * dtSeconds,
      bounds.minX,
      bounds.maxX,
    ),
    y: clamp(
      state.playerIsland.y + moveY * PLAYER_ISLAND_SPEED_PX_S * dtSeconds,
      bounds.minY,
      bounds.maxY,
    ),
  };
  const elapsedMs = state.elapsedMs + dtMs;
  const tickCount = Math.floor(elapsedMs / BATTLE_TICK_MS) - Math.floor(state.elapsedMs / BATTLE_TICK_MS);
  const units: TMutableUnit[] = state.units.map((unit) => {
    return { ...unit };
  });
  const homeCentres = new Map<string, TPoint>();
  homeCentres.set(playerIsland.id, { x: playerIsland.x, y: playerIsland.y });
  for (const enemyIsland of state.enemyIslands) {
    homeCentres.set(enemyIsland.id, { x: enemyIsland.x, y: enemyIsland.y });
  }
  const firstTick = Math.floor(state.elapsedMs / BATTLE_TICK_MS) + 1;
  for (let tick = 0; tick < tickCount; tick += 1) {
    runTick(units, homeCentres, firstTick + tick);
  }
  const liveUnits = units.filter((unit) => {
    return unit.hp > 0;
  });
  const absorbedHexes: THex[] = [...state.absorbedHexes];
  const enemyIslands = state.enemyIslands.map((enemyIsland) => {
    if (enemyIsland.absorbed === true) {
      return enemyIsland;
    }
    const defended = liveUnits.some((unit) => {
      return unit.side === "enemy" && unit.homeIslandId === enemyIsland.id;
    });
    if (defended === true) {
      return enemyIsland;
    }
    if (islandsOverlap(playerIsland, enemyIsland) === false) {
      return enemyIsland;
    }
    absorbedHexes.push(...enemyIsland.hexes);
    return { ...enemyIsland, absorbed: true };
  });
  const enemiesLeft = liveUnits.some((unit) => {
    return unit.side === "enemy";
  });
  const allAbsorbed = enemyIslands.every((enemyIsland) => {
    return enemyIsland.absorbed === true;
  });
  return {
    turn: state.turn,
    playerIsland,
    enemyIslands,
    units: liveUnits.map((unit) => {
      return { ...unit };
    }),
    elapsedMs,
    finished: allAbsorbed === true || enemiesLeft === false,
    absorbedHexes,
  };
};

export type { TUnitStats };

export {
  BATTLE_HEX_SIZE_PX,
  BATTLE_TICK_MS,
  BATTLE_WORLD_H,
  BATTLE_WORLD_W,
  PLAYER_ISLAND_ID,
  PLAYER_ISLAND_SPEED_PX_S,
  UNIT_STATS,
  createBattleLevel,
  islandHexCentres,
  islandsOverlap,
  stepBattle,
};
