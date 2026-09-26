import { getEnemy, getUnit } from "./units";
import { pick, randomInt } from "./rng";
import type { TRng } from "./rng";
import type { TEnemyId, TUnitId } from "./units";

/**
 * The clearing phase. The player steers their island with WASD across a field
 * of other islands; the units fight by themselves, which is the spec's
 * auto-battle. Everything here is pure: one step in, one step out.
 */

const ARENA_WIDTH = 1000;
const ARENA_HEIGHT = 640;
const PLAYER_ISLAND_RADIUS = 70;
const ISLAND_SPEED = 130;
/** A unit picks a fight with anything this close. */
const AGGRO_RADIUS = 170;
/** Enemies leave their island once the player's island is this close to it. */
const APPROACH_RADIUS = 260;
/** How far from its anchor a unit strolls while nothing is happening. */
const WANDER_RADIUS = 52;
const WANDER_ARRIVED_PX = 8;
/** Enemies grow this much tougher per turn, as the spec asks. */
const ENEMY_GROWTH_PER_TURN = 0.12;

type TSide = "player" | "enemy";

type TBattleUnit = {
  readonly id: string;
  readonly side: TSide;
  readonly kind: TUnitId | TEnemyId;
  readonly emoji: string;
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly damage: number;
  readonly range: number;
  readonly speed: number;
  /** The island this unit belongs to; player units follow the flying one. */
  readonly homeIslandId: string | null;
  readonly wanderX: number;
  readonly wanderY: number;
};

type TBattleIsland = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** How many hexes joining this island adds to the player's own. */
  readonly hexes: number;
  readonly annexed: boolean;
};

type TBattleInput = {
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
};

type TBattle = {
  readonly width: number;
  readonly height: number;
  readonly islandX: number;
  readonly islandY: number;
  readonly islandRadius: number;
  readonly input: TBattleInput;
  readonly islands: readonly TBattleIsland[];
  readonly units: readonly TBattleUnit[];
  readonly status: "running" | "won" | "lost";
  readonly elapsedMs: number;
  /** Hexes won so far, handed to the island when the battle ends. */
  readonly annexedHexes: number;
};

/** Which creatures a level throws at the player, by how late the game is. */
const enemyPoolForTurn = (turn: number): readonly TEnemyId[] => {
  if (turn <= 2) {
    return ["wolf", "spider", "leech", "bat"];
  }

  if (turn <= 5) {
    return ["wolf", "spider", "skeleton", "zombie", "bat", "moth"];
  }

  return ["skeleton", "zombie", "ogre", "witch", "vampire", "moth", "bat"];
};

const distance = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const wanderPoint = (rng: TRng, x: number, y: number) => ({
  wanderX: clamp(x + (rng() - 0.5) * WANDER_RADIUS * 2, 0, ARENA_WIDTH),
  wanderY: clamp(y + (rng() - 0.5) * WANDER_RADIUS * 2, 0, ARENA_HEIGHT),
});

type TBattleSetup = {
  readonly islandCount: number;
  readonly turn: number;
  /** The units the player fields, already filtered by technologies and people. */
  readonly roster: readonly TUnitId[];
};

/** Lays out the level: islands in a row of arcs, enemies standing on them. */
const createBattle = (setup: TBattleSetup, rng: TRng): TBattle => {
  const growth = 1 + (setup.turn - 1) * ENEMY_GROWTH_PER_TURN;
  const pool = enemyPoolForTurn(setup.turn);
  const islands: TBattleIsland[] = [];
  const units: TBattleUnit[] = [];

  for (let index = 0; index < setup.islandCount; index += 1) {
    const angle = (index / Math.max(1, setup.islandCount)) * Math.PI * 2 + rng() * 0.4;
    const spread = 200 + rng() * 90;
    const island: TBattleIsland = {
      id: `i${index}`,
      x: clamp(ARENA_WIDTH / 2 + Math.cos(angle) * spread * 1.5, 120, ARENA_WIDTH - 120),
      y: clamp(ARENA_HEIGHT / 2 + Math.sin(angle) * spread, 110, ARENA_HEIGHT - 110),
      radius: 58 + rng() * 22,
      hexes: randomInt(rng, 1, 3),
      annexed: false,
    };

    islands.push(island);

    const garrison = randomInt(rng, 2, 3 + Math.min(3, Math.floor(setup.turn / 2)));
    for (let slot = 0; slot < garrison; slot += 1) {
      const enemy = getEnemy(pick(rng, pool));
      const spot = (slot / garrison) * Math.PI * 2;
      const x = island.x + Math.cos(spot) * island.radius * 0.6;
      const y = island.y + Math.sin(spot) * island.radius * 0.6;

      units.push({
        id: `e${index}_${slot}`,
        side: "enemy",
        kind: enemy.id,
        emoji: enemy.emoji,
        x,
        y,
        hp: Math.round(enemy.hp * growth),
        maxHp: Math.round(enemy.hp * growth),
        damage: enemy.damage * growth,
        range: enemy.range,
        speed: enemy.speed,
        homeIslandId: island.id,
        ...wanderPoint(rng, x, y),
      });
    }
  }

  const islandX = 110;
  const islandY = ARENA_HEIGHT / 2;

  setup.roster.forEach((unitId, index) => {
    const unit = getUnit(unitId);
    const spot = (index / Math.max(1, setup.roster.length)) * Math.PI * 2;
    const x = islandX + Math.cos(spot) * PLAYER_ISLAND_RADIUS * 0.6;
    const y = islandY + Math.sin(spot) * PLAYER_ISLAND_RADIUS * 0.6;

    units.push({
      id: `p${index}`,
      side: "player",
      kind: unit.id,
      emoji: unit.emoji,
      x,
      y,
      hp: unit.hp,
      maxHp: unit.hp,
      damage: unit.damage,
      range: unit.range,
      speed: unit.speed,
      homeIslandId: null,
      ...wanderPoint(rng, x, y),
    });
  });

  return {
    width: ARENA_WIDTH,
    height: ARENA_HEIGHT,
    islandX,
    islandY,
    islandRadius: PLAYER_ISLAND_RADIUS,
    input: { up: false, down: false, left: false, right: false },
    islands,
    units,
    status: "running",
    elapsedMs: 0,
    annexedHexes: 0,
  };
};

/** The point a unit drifts back to when it has nobody to fight. */
const anchorFor = (battle: TBattle, unit: TBattleUnit) => {
  if (unit.side === "player") {
    // Player units drift toward the island their own island is closing on.
    const target = battle.islands
      .filter((island) => !island.annexed)
      .find((island) => distance(battle.islandX, battle.islandY, island.x, island.y) < APPROACH_RADIUS);

    if (target) {
      return { x: (battle.islandX + target.x) / 2, y: (battle.islandY + target.y) / 2 };
    }

    return { x: battle.islandX, y: battle.islandY };
  }

  const home = battle.islands.find((island) => island.id === unit.homeIslandId);
  if (!home) {
    return { x: unit.x, y: unit.y };
  }

  // An island the player has flown up to pulls its garrison off its perch.
  if (distance(battle.islandX, battle.islandY, home.x, home.y) < APPROACH_RADIUS) {
    return { x: battle.islandX, y: battle.islandY };
  }

  return { x: home.x, y: home.y };
};

const nearestFoe = (battle: TBattle, unit: TBattleUnit) => {
  let best: TBattleUnit | null = null;
  let bestDistance = AGGRO_RADIUS;

  for (const other of battle.units) {
    if (other.side === unit.side || other.hp <= 0) {
      continue;
    }

    const gap = distance(unit.x, unit.y, other.x, other.y);
    if (gap < bestDistance) {
      best = other;
      bestDistance = gap;
    }
  }

  return best;
};

/** One tick of the auto-battle. `dt` is in seconds. */
const stepBattle = (battle: TBattle, dt: number, rng: TRng): TBattle => {
  if (battle.status !== "running") {
    return battle;
  }

  const moveX = (battle.input.right ? 1 : 0) - (battle.input.left ? 1 : 0);
  const moveY = (battle.input.down ? 1 : 0) - (battle.input.up ? 1 : 0);
  const moveLength = Math.hypot(moveX, moveY) || 1;
  const islandX = clamp(
    battle.islandX + (moveX / moveLength) * ISLAND_SPEED * dt * (moveX === 0 && moveY === 0 ? 0 : 1),
    battle.islandRadius,
    battle.width - battle.islandRadius,
  );
  const islandY = clamp(
    battle.islandY + (moveY / moveLength) * ISLAND_SPEED * dt * (moveX === 0 && moveY === 0 ? 0 : 1),
    battle.islandRadius,
    battle.height - battle.islandRadius,
  );

  const moved: TBattle = { ...battle, islandX, islandY };
  const damageById = new Map<string, number>();
  const next: TBattleUnit[] = [];

  for (const unit of moved.units) {
    if (unit.hp <= 0) {
      continue;
    }

    const foe = nearestFoe(moved, unit);

    if (foe) {
      const gap = distance(unit.x, unit.y, foe.x, foe.y);
      if (gap <= unit.range) {
        damageById.set(foe.id, (damageById.get(foe.id) ?? 0) + unit.damage * dt);
        next.push(unit);

        continue;
      }

      const step = Math.min(unit.speed * dt, gap);
      next.push({
        ...unit,
        x: unit.x + ((foe.x - unit.x) / gap) * step,
        y: unit.y + ((foe.y - unit.y) / gap) * step,
      });

      continue;
    }

    // Nobody to fight. A unit left behind by its island runs to catch up; one
    // that is already with it strolls about, as the spec describes.
    const anchor = anchorFor(moved, unit);
    const anchorGap = distance(unit.x, unit.y, anchor.x, anchor.y);

    if (anchorGap > WANDER_RADIUS * 2) {
      const step = Math.min(unit.speed * dt, anchorGap);
      next.push({
        ...unit,
        x: unit.x + ((anchor.x - unit.x) / anchorGap) * step,
        y: unit.y + ((anchor.y - unit.y) / anchorGap) * step,
        ...wanderPoint(rng, anchor.x, anchor.y),
      });

      continue;
    }

    const gap = distance(unit.x, unit.y, unit.wanderX, unit.wanderY);
    if (gap < WANDER_ARRIVED_PX) {
      next.push({ ...unit, ...wanderPoint(rng, anchor.x, anchor.y) });

      continue;
    }

    const step = Math.min(unit.speed * 0.5 * dt, gap);
    next.push({
      ...unit,
      x: unit.x + ((unit.wanderX - unit.x) / gap) * step,
      y: unit.y + ((unit.wanderY - unit.y) / gap) * step,
    });
  }

  const alive = next
    .map((unit) => ({ ...unit, hp: unit.hp - (damageById.get(unit.id) ?? 0) }))
    .filter((unit) => unit.hp > 0);

  let annexedHexes = moved.annexedHexes;
  const islands = moved.islands.map((island) => {
    if (island.annexed) {
      return island;
    }

    const guarded = alive.some((unit) => unit.side === "enemy" && unit.homeIslandId === island.id);
    const touching = distance(islandX, islandY, island.x, island.y) < battle.islandRadius + island.radius;
    if (guarded || !touching) {
      return island;
    }

    annexedHexes += island.hexes;

    return { ...island, annexed: true };
  });

  const playerLeft = alive.some((unit) => unit.side === "player");
  const allAnnexed = islands.every((island) => island.annexed);

  return {
    ...moved,
    units: alive,
    islands,
    annexedHexes,
    elapsedMs: moved.elapsedMs + dt * 1000,
    status: allAnnexed ? "won" : playerLeft ? "running" : "lost",
  };
};

export type { TBattle, TBattleInput, TBattleIsland, TBattleSetup, TBattleUnit };
export { ARENA_HEIGHT, ARENA_WIDTH, createBattle, stepBattle };
