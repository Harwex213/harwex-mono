import { ARCHETYPE_IDS, archetypeOf } from "../battle/archetypes";
import { ARENA_WIDTH } from "../arena/hex";
import { clampToArena, isDeployable, zoneBand } from "../arena/arena";
import { pickOne, randomRange } from "../battle/rng";
import type { TArchetypeId } from "../battle/archetypes";
import type { TPoint } from "../arena/hex";
import type { TRng } from "../battle/rng";
import type { TRosterUnit, TTeam } from "../battle/types";
import type { TZone } from "../arena/arena";

/** Number of cards the shop shows at once. */
const SHOP_SIZE = 5;

/** Nobody may field more than this, so the arena never turns into a mob. */
const ROSTER_LIMIT = 10;

let unitCounter = 0;

const createUnitId = (team: TTeam): string => {
  unitCounter += 1;

  return `${team}-${unitCounter}`;
};

/**
 * Picks an open spot in the half of the arena that belongs to `zone`. Positions
 * are continuous, so "open" only means far from the units already placed.
 */
const findSpot = (rng: TRng, taken: readonly TRosterUnit[], zone: TZone, radius: number): TPoint => {
  const band = zoneBand(zone);
  let best: TPoint | null = null;
  let bestScore = -1;

  for (let attempt = 0; attempt < 160; attempt += 1) {
    const x = randomRange(rng, 0, ARENA_WIDTH);
    const y = randomRange(rng, band.top + radius, band.bottom - radius);
    if (!isDeployable(x, y, radius + 4, zone)) {
      continue;
    }

    let score = 999;
    for (const unit of taken) {
      const gap = Math.hypot(unit.x - x, unit.y - y) - archetypeOf(unit.archetypeId).radius;
      score = Math.min(score, gap);
    }

    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }

    if (bestScore > 64) {
      break;
    }
  }

  if (best) {
    return best;
  }

  return clampToArena(ARENA_WIDTH / 2, (band.top + band.bottom) / 2, radius);
};

const createUnit = (rng: TRng, taken: readonly TRosterUnit[], archetypeId: TArchetypeId, team: TTeam): TRosterUnit => {
  const zone: TZone = team === "player" ? "player" : "enemy";
  const spot = findSpot(rng, taken, zone, archetypeOf(archetypeId).radius);

  return {
    id: createUnitId(team),
    team,
    archetypeId,
    x: spot.x,
    y: spot.y,
  };
};

const createStartingRoster = (rng: TRng): TRosterUnit[] => {
  const roster: TRosterUnit[] = [];

  for (const archetypeId of ["guardian", "warrior", "archer"] as TArchetypeId[]) {
    roster.push(createUnit(rng, roster, archetypeId, "player"));
  }

  return roster;
};

/** Gold the enemy warband is worth on a given round. */
const enemyBudget = (round: number): number => 6 + Math.round(round * 2.5);

const generateEnemyRoster = (rng: TRng, round: number): TRosterUnit[] => {
  const allowed = ARCHETYPE_IDS.filter((id) => id !== "healer" || round >= 3);
  const roster: TRosterUnit[] = [];
  let budget = enemyBudget(round);

  while (roster.length < ROSTER_LIMIT) {
    const affordable = allowed.filter((id) => archetypeOf(id).cost <= budget);
    if (affordable.length === 0) {
      break;
    }

    const archetypeId = pickOne(rng, affordable);
    budget -= archetypeOf(archetypeId).cost;
    roster.push(createUnit(rng, roster, archetypeId, "enemy"));
  }

  return roster;
};

const rollShopOffers = (rng: TRng): TArchetypeId[] => {
  const offers: TArchetypeId[] = [];

  for (let index = 0; index < SHOP_SIZE; index += 1) {
    offers.push(pickOne(rng, ARCHETYPE_IDS));
  }

  return offers;
};

export { ROSTER_LIMIT, SHOP_SIZE, createStartingRoster, createUnit, enemyBudget, findSpot, generateEnemyRoster, rollShopOffers };
