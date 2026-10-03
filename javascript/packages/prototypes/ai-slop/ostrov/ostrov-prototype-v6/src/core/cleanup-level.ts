import { BIOMES } from "./biomes";
import { HEX_SIZE, hexId, hexNeighbors, hexToPixel } from "./hex";
import { pick, pickWeighted, randomInt } from "./rng";
import { structureHp } from "./structure-hp";
import { isDead } from "./tax";
import type { TRng } from "./rng";
import type { TBiomeId, TBuildingId, THex, TIsland, TPlayer } from "./types";
import type { TEnemyId, TUnitId } from "./units";

/**
 * The level of the cleanup phase: the player's own island and a few enemy hex
 * islands around it. This file only lays the level out. `cleanup-sim.ts` runs it.
 *
 * The raid tier sets how hard the level is. It grows every two turns, and a
 * cell with a heavy toxic trail adds to it: the poison draws monsters.
 */

const MAX_TIER = 6;
const TURNS_PER_TIER = 2;
/** Toxic trail worth one extra tier. */
const TRAIL_PER_TIER = 200;
/** Toxic trail at which the hexes of an enemy island reach full pollution. */
const TRAIL_FULL = 400;
const MAX_TRAIL_TOXICITY_PCT = 60;
const MAX_ENEMY_HEXES = 19;
const MAX_GARRISON = 10;
/** Monster hp and damage grow this much per turn, so late raids hit harder. */
const ENEMY_GROWTH_PER_TURN = 0.12;
/** How strongly an enemy island takes after the biome of its world cell. */
const CELL_BIOME_WEIGHT = 10;
/** How much a placed neighbour pulls the next hex to the same biome. */
const NEIGHBOR_BIAS = 2.6;
/** Open water between the player's island and the nearest enemy island. */
const SPAWN_GAP_MIN = 300;
const SPAWN_GAP_SPREAD = 260;
const SPAWN_GAP_BETWEEN = 160;
const APPROACH_CHANCE_PER_TIER = 0.2;
/** Open sky between the outermost island and the map border. */
const BOUNDS_MARGIN = 760;
const MIN_HALF_WIDTH = 1900;
const MIN_HALF_HEIGHT = 1400;
const MAX_APPROACH_CHANCE = 0.8;

type TCleanupSide = "player" | "enemy";

/** An enemy island either drifts in place or sails at the player. */
type TIslandBehavior = "player" | "drift" | "approach";

/** One hex of a level island, in the island's own axial coordinates. */
type TCleanupHex = {
  readonly id: string;
  readonly q: number;
  readonly r: number;
  readonly biome: TBiomeId;
  readonly building: TBuildingId | null;
  readonly stronghold: boolean;
  readonly toxicity: number;
  readonly dead: boolean;
  /** Hit points of the building or stronghold on the hex. 0 and 0 for an empty hex. */
  readonly hp: number;
  readonly maxHp: number;
};

type TIslandSpec = {
  readonly id: string;
  readonly label: string;
  readonly side: TCleanupSide;
  readonly behavior: TIslandBehavior;
  readonly hexes: readonly TCleanupHex[];
  /** World position of the island's axial origin. */
  readonly x: number;
  readonly y: number;
  /** Monsters that start on the island. Empty for the player's island. */
  readonly garrison: readonly TEnemyId[];
};

/** The map border: a rectangle centred on the world origin. */
type TLevelBounds = {
  readonly halfWidth: number;
  readonly halfHeight: number;
};

type TLevelSpec = {
  readonly tier: number;
  readonly bounds: TLevelBounds;
  /** Multiplier on monster hp and damage. */
  readonly growth: number;
  readonly islands: readonly TIslandSpec[];
  readonly roster: readonly TUnitId[];
};

type TLevelSetup = {
  readonly player: TPlayer;
  readonly turn: number;
  /** Enemy islands waiting in the cell. Zero for a cleared cell. */
  readonly islandCount: number;
  readonly cellBiome: TBiomeId;
  readonly toxicTrail: number;
  readonly roster: readonly TUnitId[];
};

/**
 * A hex that joined the player's island in battle, in the player's own axial
 * coordinates: the island keeps exactly the shape it had at the end of the battle.
 */
type TAnnexedHex = {
  readonly q: number;
  readonly r: number;
  readonly biome: TBiomeId;
  readonly toxicity: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const raidTier = (turn: number, toxicTrail: number) => {
  const byTurn = Math.floor((turn - 1) / TURNS_PER_TIER);
  const byTrail = Math.floor(toxicTrail / TRAIL_PER_TIER);

  return clamp(1 + byTurn + byTrail, 1, MAX_TIER);
};

/** Which creatures a raid of this tier throws at the player. */
const enemyPoolForTier = (tier: number): readonly TEnemyId[] => {
  if (tier <= 1) {
    return ["wolf", "spider", "leech", "bat"];
  }

  if (tier <= 3) {
    return ["wolf", "spider", "skeleton", "zombie", "bat", "moth"];
  }

  return ["skeleton", "zombie", "ogre", "witch", "vampire", "moth", "bat"];
};

const playerHexes = (player: TPlayer): TCleanupHex[] => {
  return player.island.hexes.map((hex) => {
    const structure = structureHp(player, hex);

    return {
      id: hex.id,
      q: hex.q,
      r: hex.r,
      biome: hex.biome,
      building: hex.building,
      stronghold: hex.id === player.strongholdHexId,
      toxicity: hex.toxicity,
      dead: isDead(hex),
      hp: structure?.hp ?? 0,
      maxHp: structure?.max ?? 0,
    };
  });
};

/** Picks a biome for a new hex: the cell's biome first, then its neighbours'. */
const biomeFor = (rng: TRng, cellBiome: TBiomeId, neighborBiomes: readonly TBiomeId[]) => {
  return pickWeighted(rng, BIOMES, (candidate) => {
    const same = neighborBiomes.filter((biomeId) => biomeId === candidate.id).length;
    const base = candidate.id === cellBiome ? CELL_BIOME_WEIGHT : 1;

    return base * (1 + NEIGHBOR_BIAS * same);
  }).id;
};

/**
 * Grows an enemy island as a compact blob. A free cell with more placed
 * neighbours is more likely to be taken, so the island has few thin arms.
 */
const growEnemyHexes = (rng: TRng, size: number, cellBiome: TBiomeId, trail: number): TCleanupHex[] => {
  const placed = new Map<string, TCleanupHex>();
  const trailToxicity = (Math.min(trail, TRAIL_FULL) / TRAIL_FULL) * MAX_TRAIL_TOXICITY_PCT;

  const place = (q: number, r: number) => {
    const neighborBiomes = hexNeighbors(q, r)
      .map((cell) => placed.get(hexId(cell.q, cell.r))?.biome)
      .filter((biomeId): biomeId is TBiomeId => biomeId !== undefined);
    const toxicity = Math.round(clamp(trailToxicity + rng() * 18, 0, 90));
    const hex: THex = {
      id: hexId(q, r),
      q,
      r,
      biome: biomeFor(rng, cellBiome, neighborBiomes),
      building: null,
      toxicity,
    };

    placed.set(hex.id, {
      id: hex.id,
      q,
      r,
      biome: hex.biome,
      building: null,
      stronghold: false,
      toxicity,
      dead: isDead(hex),
      hp: 0,
      maxHp: 0,
    });
  };

  place(0, 0);

  while (placed.size < size) {
    const frontier = new Map<string, { q: number; r: number; weight: number }>();

    for (const hex of placed.values()) {
      for (const cell of hexNeighbors(hex.q, hex.r)) {
        const key = hexId(cell.q, cell.r);
        if (placed.has(key)) {
          continue;
        }

        const entry = frontier.get(key) ?? { q: cell.q, r: cell.r, weight: 0 };
        frontier.set(key, { ...entry, weight: entry.weight + 1 });
      }
    }

    const next = pickWeighted(rng, [...frontier.values()], (cell) => cell.weight * cell.weight);
    place(next.q, next.r);
  }

  return [...placed.values()];
};

/** Centre of an island's hexes and the distance from it to its farthest corner. */
const islandExtent = (hexes: readonly TCleanupHex[]) => {
  const centers = hexes.map((hex) => hexToPixel(hex.q, hex.r, HEX_SIZE));
  const cx = centers.reduce((sum, point) => sum + point.x, 0) / Math.max(1, centers.length);
  const cy = centers.reduce((sum, point) => sum + point.y, 0) / Math.max(1, centers.length);
  const radius = centers.reduce((max, point) => Math.max(max, Math.hypot(point.x - cx, point.y - cy)), 0);

  return { cx, cy, radius: radius + HEX_SIZE };
};

/**
 * Lays the level out. The player's island sits at the world origin. Enemy
 * islands stand on a ring around it, spread by angle, so none overlaps another.
 */
const createLevel = (setup: TLevelSetup, rng: TRng): TLevelSpec => {
  const tier = raidTier(setup.turn, setup.toxicTrail);
  const growth = 1 + (setup.turn - 1) * ENEMY_GROWTH_PER_TURN;
  const pool = enemyPoolForTier(tier);
  const ownHexes = playerHexes(setup.player);
  const own = islandExtent(ownHexes);
  const islands: TIslandSpec[] = [
    {
      id: "player",
      label: setup.player.nickname,
      side: "player",
      behavior: "player",
      hexes: ownHexes,
      x: -own.cx,
      y: -own.cy,
      garrison: [],
    },
  ];

  const placedRings: { x: number; y: number; radius: number }[] = [{ x: 0, y: 0, radius: own.radius }];
  const startAngle = rng() * Math.PI * 2;
  const count = Math.max(0, setup.islandCount);

  for (let index = 0; index < count; index += 1) {
    const size = Math.min(MAX_ENEMY_HEXES, 5 + tier * 2 + randomInt(rng, 0, 3));
    const hexes = growEnemyHexes(rng, size, setup.cellBiome, setup.toxicTrail);
    const extent = islandExtent(hexes);
    const garrisonSize = Math.min(MAX_GARRISON, 2 + tier + randomInt(rng, 0, 1));
    const garrison = Array.from({ length: garrisonSize }, () => pick(rng, pool));
    const angle = startAngle + (index / count) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    let distance = own.radius + extent.radius + SPAWN_GAP_MIN + rng() * SPAWN_GAP_SPREAD;
    let x = Math.cos(angle) * distance;
    let y = Math.sin(angle) * distance;

    // Pushes the island outwards until it clears every island placed before it.
    const overlaps = () => {
      return placedRings.some((ring) => Math.hypot(ring.x - x, ring.y - y) < ring.radius + extent.radius + SPAWN_GAP_BETWEEN);
    };

    while (overlaps()) {
      distance += HEX_SIZE;
      x = Math.cos(angle) * distance;
      y = Math.sin(angle) * distance;
    }

    placedRings.push({ x, y, radius: extent.radius });

    const approachChance = Math.min(MAX_APPROACH_CHANCE, APPROACH_CHANCE_PER_TIER * tier);

    islands.push({
      id: `enemy-${index}`,
      label: `Остров ${index + 1}`,
      side: "enemy",
      behavior: rng() < approachChance ? "approach" : "drift",
      hexes,
      x: x - extent.cx,
      y: y - extent.cy,
      garrison,
    });
  }

  // The border leaves the same open margin beyond the outermost island on
  // every side, so no island starts inside the retreat band.
  const reachX = placedRings.reduce((max, ring) => Math.max(max, Math.abs(ring.x) + ring.radius), 0);
  const reachY = placedRings.reduce((max, ring) => Math.max(max, Math.abs(ring.y) + ring.radius), 0);
  const bounds = {
    halfWidth: Math.max(MIN_HALF_WIDTH, reachX + BOUNDS_MARGIN),
    halfHeight: Math.max(MIN_HALF_HEIGHT, reachY + BOUNDS_MARGIN),
  };

  return { tier, growth, bounds, islands, roster: setup.roster };
};

/**
 * Adds the hexes that joined in battle at exactly their battle coordinates.
 * A hex id that is somehow already taken is skipped, never moved.
 */
const joinAnnexed = (island: TIsland, gains: readonly TAnnexedHex[]): TIsland => {
  const taken = new Set(island.hexes.map((hex) => hex.id));
  const added = gains
    .filter((gain) => !taken.has(hexId(gain.q, gain.r)))
    .map((gain) => ({
      id: hexId(gain.q, gain.r),
      q: gain.q,
      r: gain.r,
      biome: gain.biome,
      building: null,
      toxicity: gain.toxicity,
    }));

  return { hexes: [...island.hexes, ...added] };
};

export type {
  TAnnexedHex,
  TCleanupHex,
  TCleanupSide,
  TIslandBehavior,
  TIslandSpec,
  TLevelBounds,
  TLevelSetup,
  TLevelSpec,
};
export { createLevel, islandExtent, joinAnnexed, raidTier };
