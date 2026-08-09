import { config } from "@hw/ostrov-prototype-v2-config";
import type { Axial } from "../hex/coords";
import { hexKey } from "../hex/coords";
import type { Point } from "../hex/layout";
import { HEX_HALF_HEIGHT, HEX_HALF_WIDTH, WALL_DEPTH, hexToWorld, worldToHex } from "../hex/layout";
import type { TerrainProfile, TerrainQuota, Tile } from "./island";
import { OWNER_ENEMY, OWNER_PLAYER, OWNER_WILD, compareByRow, growCluster, paintCluster } from "./island";
import type { Rng } from "./rng";
import { createRng } from "./rng";

/**
 * The world: many separate floating islands laid out in three concentric zones
 * around the world centre.
 *
 * Everything comes out of one seed. The generator holds a single RNG stream and
 * walks the zones in a fixed order — boss, wild, player start, enemy start, the
 * rest of the periphery — so the same seed always builds the same world, down to
 * the biome of every tile.
 *
 * Islands are scattered by rejection sampling: a candidate anchor is drawn from
 * the zone's annulus and accepted only if every one of its hexes sits at least
 * `world.minIslandGap` hex steps away from every hex already placed. The check
 * runs against a dilated occupancy set rather than a pairwise sweep, so it stays
 * cheap however many islands the config asks for.
 */

const TAU = Math.PI * 2;

type ZoneId = "boss" | "wild" | "peripheral";

/**
 * How each zone tilts the biome roll. The weights multiply the ones in the
 * config, so a designer still owns the base mix and the zone only flavours it.
 *
 * Peripheral reads as green and lived-in, the wild lands as bare rock and ice,
 * the boss lands as a dead wasteland: no meadow at all and barely a tree.
 */
const ZONE_PROFILES: Record<ZoneId, TerrainProfile> = {
  peripheral: { snow: 0.3, grass: 3.2, ice: 0.2, forest: 1.1, sand: 0.4 },
  wild: { snow: 1.7, grass: 0.1, ice: 1.6, forest: 0.3, sand: 2.1 },
  boss: { snow: 0.5, grass: 0, ice: 1.5, forest: 0.1, sand: 3 },
};

/** The starting islands owe the build roster one hex of each buildable biome. */
const START_QUOTA: TerrainQuota = { grass: 2, forest: 1, sand: 1 };

const NO_QUOTA: TerrainQuota = {};

/** How many anchors a single island is allowed to try before it is given up on. */
const PLACEMENT_ATTEMPTS = 400;

type Rect = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type Island = {
  id: number;
  zone: ZoneId;
  owner: number;
  /** True for the one island in the middle of the world. */
  boss: boolean;
  /** Anchor hex; always a tile of the island, and the hex the boss marker sits on. */
  origin: Axial;
  /** World-space centre of the silhouette, used by the minimap. */
  centre: Point;
  tiles: readonly Tile[];
  /** World-space extent including the cliff walls, used to cull the island. */
  bounds: Rect;
};

type WorldMap = {
  islands: readonly Island[];
  /** Every tile of every island, in one back-to-front painting order. */
  tiles: readonly Tile[];
  byKey: ReadonlyMap<string, Tile>;
  tileAt: (q: number, r: number) => Tile | null;
  ownerAt: (q: number, r: number) => number | null;
  /** World-space extent of everything, cliff walls included. */
  bounds: Rect;
  /** Radii of the three zone boundaries, in world units. */
  zoneRadii: Record<ZoneId, number>;
  playerIsland: Island;
  enemyIsland: Island;
  bossIsland: Island;
};

/** World-space box of one tile, cliff wall included. */
function tileBounds(hex: Axial): Rect {
  const centre = hexToWorld(hex);
  return {
    minX: centre.x - HEX_HALF_WIDTH,
    maxX: centre.x + HEX_HALF_WIDTH,
    minY: centre.y - HEX_HALF_HEIGHT,
    maxY: centre.y + HEX_HALF_HEIGHT + WALL_DEPTH,
  };
}

function growRect(into: Rect, add: Rect): void {
  into.minX = Math.min(into.minX, add.minX);
  into.maxX = Math.max(into.maxX, add.maxX);
  into.minY = Math.min(into.minY, add.minY);
  into.maxY = Math.max(into.maxY, add.maxY);
}

function emptyRect(): Rect {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

/**
 * Adds every hex within `radius` steps of `hex` to `blocked`.
 *
 * `blocked` is the dilation of the occupied hexes by `minIslandGap - 1`, so a
 * candidate that avoids it is guaranteed to sit at least `minIslandGap` steps
 * from every placed hex. Testing one set membership per candidate hex replaces
 * the pairwise distance sweep.
 */
function blockAround(blocked: Set<string>, hex: Axial, radius: number): void {
  for (let dq = -radius; dq <= radius; dq += 1) {
    const from = Math.max(-radius, -dq - radius);
    const to = Math.min(radius, -dq + radius);
    for (let dr = from; dr <= to; dr += 1) {
      blocked.add(hexKey(hex.q + dq, hex.r + dr));
    }
  }
}

/**
 * Anchor hex of a point in the ring `inner`…`outer`.
 *
 * `sector` of `sectors` narrows the angle to one slice of the circle, which is
 * how a zone is kept from bunching every island into the same quarter and
 * leaving the other three empty. The radius is still free across the whole band
 * and the angle is free inside its slice, so the result reads as a scattered
 * field rather than as beads on a ring. Passing one sector leaves the angle free.
 */
function sampleRing(rng: Rng, inner: number, outer: number, sector: number, sectors: number): Axial {
  const angle = ((sector + rng()) / sectors) * TAU;
  const low = Math.max(0, inner);
  const radius = Math.sqrt(low * low + rng() * (outer * outer - low * low));
  return worldToHex(Math.cos(angle) * radius, Math.sin(angle) * radius);
}

/** Whether an anchor hex sits in the ring `inner`…`outer` around the world centre. */
function insideRing(origin: Axial, inner: number, outer: number): boolean {
  const point = hexToWorld(origin);
  const radius = Math.hypot(point.x, point.y);
  return radius >= inner && radius <= outer;
}

type Placement = {
  zone: ZoneId;
  size: number;
  owner: number;
  boss: boolean;
  quota: TerrainQuota;
  /** Draws one candidate anchor. Called until the gap check accepts one. */
  sample: (rng: Rng) => Axial;
  /** Extra condition on an anchor, checked before the gap. Missing means anywhere. */
  accept?: (origin: Axial) => boolean;
};

/** Everything the generator carries from one island to the next. */
type Builder = {
  rng: Rng;
  seed: number;
  blocked: Set<string>;
  gap: number;
  islands: Island[];
};

/**
 * Grows one island, finds it an anchor and commits it. Returns null when no
 * anchor in `PLACEMENT_ATTEMPTS` tries kept the gap, which leaves the world one
 * island short rather than letting two clusters touch.
 */
function addIsland(builder: Builder, placement: Placement): Island | null {
  const shape = growCluster(builder.rng, placement.size);
  let origin: Axial | null = null;
  for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS && origin === null; attempt += 1) {
    const candidate = placement.sample(builder.rng);
    if (placement.accept && !placement.accept(candidate)) {
      continue;
    }
    let clear = true;
    for (const hex of shape) {
      if (builder.blocked.has(hexKey(candidate.q + hex.q, candidate.r + hex.r))) {
        clear = false;
        break;
      }
    }
    if (clear) {
      origin = candidate;
    }
  }
  if (!origin) {
    return null;
  }

  const id = builder.islands.length;
  const tiles = paintCluster(builder.rng, {
    shape,
    origin,
    islandId: id,
    owner: placement.owner,
    seed: builder.seed,
    profile: ZONE_PROFILES[placement.zone],
    quota: placement.quota,
  });

  const bounds = emptyRect();
  let sumX = 0;
  let sumY = 0;
  for (const tile of tiles) {
    growRect(bounds, tileBounds(tile));
    const centre = hexToWorld(tile);
    sumX += centre.x;
    sumY += centre.y;
    blockAround(builder.blocked, tile, builder.gap - 1);
  }

  const island: Island = {
    id,
    zone: placement.zone,
    owner: placement.owner,
    boss: placement.boss,
    origin,
    centre: { x: sumX / tiles.length, y: sumY / tiles.length },
    tiles,
    bounds,
  };
  builder.islands.push(island);
  return island;
}

/** Inclusive integer in `min`…`max`, with the pair swapped when a designer inverts it. */
function sizeBetween(rng: Rng, min: number, max: number): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return low + Math.floor(rng() * (high - low + 1));
}

function generateWorld(seed: number): WorldMap {
  const knobs = config.world;
  const rng = createRng(seed);
  const builder: Builder = {
    rng,
    seed,
    blocked: new Set<string>(),
    gap: knobs.minIslandGap,
    islands: [],
  };

  // Keeps a silhouette from crossing the zone line it belongs behind: an island
  // reaches at most `maxSpread` hexes out from its anchor.
  const reach = config.island.maxSpread * HEX_HALF_WIDTH * 1.5;

  const boss = addIsland(builder, {
    zone: "boss",
    size: knobs.bossIslandSize,
    owner: OWNER_WILD,
    boss: true,
    quota: NO_QUOTA,
    sample: () => ({ q: 0, r: 0 }),
  });
  if (!boss) {
    throw new Error("Мир не построен: остров босса не встал в центр");
  }

  const wildInner = knobs.bossZoneRadius + reach;
  const wildOuter = Math.max(wildInner + reach, knobs.wildZoneRadius - reach);
  for (let index = 0; index < knobs.wildIslandCount; index += 1) {
    addIsland(builder, {
      zone: "wild",
      size: sizeBetween(rng, knobs.wildIslandSizeMin, knobs.wildIslandSizeMax),
      owner: OWNER_WILD,
      boss: false,
      quota: NO_QUOTA,
      sample: (source) => sampleRing(source, wildInner, wildOuter, index, knobs.wildIslandCount),
    });
  }

  const rimInner = knobs.wildZoneRadius + reach;
  const rimOuter = Math.max(rimInner + reach, knobs.peripheralZoneRadius - reach);
  const player = addIsland(builder, {
    zone: "peripheral",
    size: knobs.startIslandSize,
    owner: OWNER_PLAYER,
    boss: false,
    quota: START_QUOTA,
    sample: (source) => sampleRing(source, rimInner, rimOuter, 0, 1),
  });
  if (!player) {
    throw new Error("Мир не построен: стартовому острову игрока не нашлось места");
  }

  // The enemy starts as a neighbour, not as a mirror image on the far side: the
  // anchor is drawn on a circle of `enemyStartDistance` around the player, and
  // only the angle and a little slack on the radius are left to chance. Half of
  // that circle points inwards, so the anchor is refused unless it still lands
  // on the periphery — otherwise the enemy would set up camp in the wild lands.
  const enemy = addIsland(builder, {
    zone: "peripheral",
    size: knobs.startIslandSize,
    owner: OWNER_ENEMY,
    boss: false,
    quota: START_QUOTA,
    sample: (source) => {
      const angle = source() * TAU;
      const distance = knobs.enemyStartDistance * (0.85 + source() * 0.4);
      return worldToHex(player.centre.x + Math.cos(angle) * distance, player.centre.y + Math.sin(angle) * distance);
    },
    accept: (origin) => insideRing(origin, rimInner, rimOuter),
  });
  if (!enemy) {
    throw new Error("Мир не построен: стартовому острову врага не нашлось места рядом с игроком");
  }

  for (let index = 0; index < knobs.peripheralIslandCount; index += 1) {
    addIsland(builder, {
      zone: "peripheral",
      size: sizeBetween(rng, knobs.peripheralIslandSizeMin, knobs.peripheralIslandSizeMax),
      owner: OWNER_WILD,
      boss: false,
      quota: NO_QUOTA,
      sample: (source) => sampleRing(source, rimInner, rimOuter, index, knobs.peripheralIslandCount),
    });
  }

  const tiles = builder.islands.flatMap((island) => island.tiles).sort(compareByRow);
  const byKey = new Map<string, Tile>();
  const bounds = emptyRect();
  for (const tile of tiles) {
    byKey.set(hexKey(tile.q, tile.r), tile);
  }
  for (const island of builder.islands) {
    growRect(bounds, island.bounds);
  }

  const tileAt = (q: number, r: number): Tile | null => byKey.get(hexKey(q, r)) ?? null;

  return {
    islands: builder.islands,
    tiles,
    byKey,
    tileAt,
    ownerAt: (q, r) => tileAt(q, r)?.owner ?? null,
    bounds,
    zoneRadii: {
      boss: knobs.bossZoneRadius,
      wild: knobs.wildZoneRadius,
      peripheral: knobs.peripheralZoneRadius,
    },
    playerIsland: player,
    enemyIsland: enemy,
    bossIsland: boss,
  };
}

export type { Island, Rect, WorldMap, ZoneId };
export { generateWorld };
