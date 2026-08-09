import { config } from "@hw/ostrov-prototype-v2-config";
import type { Axial } from "../hex/coords";
import { hexKey, neighboursOf } from "../hex/coords";
import type { Rng } from "./rng";
import { hashCoords, weightedPick } from "./rng";
import type { TerrainKind } from "./terrain";
import { TERRAIN_KINDS } from "./terrain";

/**
 * One island: an irregular hex cluster and the biomes painted onto it.
 *
 * Nothing here knows where the island sits in the world. `growCluster` grows a
 * silhouette around the origin and `paintCluster` moves that silhouette to an
 * anchor hex and fills it in, so `world.ts` can call the pair once per island
 * and place the result wherever it likes.
 */

/**
 * Weight of a frontier cell, indexed by how many placed hexes it already
 * touches. Index 0 never comes up: a frontier cell touches at least one.
 */
const GROWTH_BIAS: readonly number[] = [
  0,
  config.island.growthBias1,
  config.island.growthBias2,
  config.island.growthBias3,
  config.island.growthBias4,
  config.island.growthBias5,
  config.island.growthBias6,
];

/**
 * Owner ids. `OWNER_WILD` is the neutral land that makes up most of the world;
 * the player and the enemy each own exactly one starting island.
 */
const OWNER_WILD = 0;
const OWNER_PLAYER = 1;
const OWNER_ENEMY = 2;

type Tile = {
  q: number;
  r: number;
  terrain: TerrainKind;
  owner: number;
  /** Per-tile seed for decoration; never changes, so nothing shimmers on pan. */
  seed: number;
  /** Which island this tile belongs to. The renderer culls on it. */
  islandId: number;
  /**
   * Position of the tile in the world's painting order, filled in once the
   * world is assembled. The fog field is a flat array indexed by it, so reading
   * a tile's fog state costs one array read and no hashing.
   */
  index: number;
};

/**
 * Per-zone flavouring of the biome roll: each weight in the config is multiplied
 * by the matching entry here. A zero shuts a biome out of the zone entirely.
 */
type TerrainProfile = Record<TerrainKind, number>;

/** Lower bound on how many tiles of a biome an island ends up with. */
type TerrainQuota = Partial<Record<TerrainKind, number>>;

type PaintOptions = {
  /** Silhouette from `growCluster`, still centred on the origin. */
  shape: readonly Axial[];
  /** Anchor hex the silhouette is moved to. */
  origin: Axial;
  islandId: number;
  owner: number;
  /** Salt of the per-tile decoration seeds. */
  seed: number;
  profile: TerrainProfile;
  quota: TerrainQuota;
};

/**
 * Grows an island one hex at a time. Frontier cells that touch few existing
 * hexes are strongly preferred, which is what produces the notches and the long
 * thin arms of the reference art instead of a compact blob.
 */
function growCluster(rng: Rng, size: number): Axial[] {
  const placed = new Map<string, Axial>();
  const start: Axial = { q: 0, r: 0 };
  placed.set(hexKey(0, 0), start);

  while (placed.size < size) {
    const frontier: Axial[] = [];
    const weights: number[] = [];
    const seen = new Set<string>();
    for (const hex of placed.values()) {
      for (const candidate of neighboursOf(hex)) {
        const key = hexKey(candidate.q, candidate.r);
        if (placed.has(key) || seen.has(key)) {
          continue;
        }
        seen.add(key);
        let touching = 0;
        for (const around of neighboursOf(candidate)) {
          if (placed.has(hexKey(around.q, around.r))) {
            touching += 1;
          }
        }
        const spread = Math.max(Math.abs(candidate.q), Math.abs(candidate.r), Math.abs(candidate.q + candidate.r));
        if (spread > config.island.maxSpread) {
          continue;
        }
        // Two- and three-neighbour cells win most rolls, which keeps the island
        // a compact blob; the occasional one-neighbour win grows an arm.
        const armBias = GROWTH_BIAS[touching] ?? GROWTH_BIAS[GROWTH_BIAS.length - 1]!;
        frontier.push(candidate);
        weights.push(armBias / (1 + config.island.spreadPenalty * spread));
      }
    }
    if (frontier.length === 0) {
      break;
    }
    const picked = frontier[weightedPick(rng, weights)]!;
    placed.set(hexKey(picked.q, picked.r), picked);
  }

  fillHoles(placed);
  return [...placed.values()];
}

/** Fills single-hex pits: a hole ringed by six tiles reads as a rendering fault. */
function fillHoles(placed: Map<string, Axial>): void {
  for (const hex of [...placed.values()]) {
    for (const candidate of neighboursOf(hex)) {
      const key = hexKey(candidate.q, candidate.r);
      if (placed.has(key)) {
        continue;
      }
      const ringed = neighboursOf(candidate).every((around) => placed.has(hexKey(around.q, around.r)));
      if (ringed) {
        placed.set(key, candidate);
      }
    }
  }
}

/** Terrain weights, indexed the same way as `ORDERED_KINDS`. */
const ORDERED_KINDS: readonly TerrainKind[] = ["snow", "grass", "ice", "forest", "sand"];

function pickTerrain(
  rng: Rng,
  exposure: number,
  neighbourKinds: readonly TerrainKind[],
  profile: TerrainProfile,
): TerrainKind {
  // Patches: most tiles copy a neighbour, so terrain comes in clumps.
  if (neighbourKinds.length > 0 && rng() < config.island.patchChance) {
    return neighbourKinds[Math.floor(rng() * neighbourKinds.length)]!;
  }
  // Exposed tips are where the ice shelves sit in the reference.
  const iceWeight =
    exposure >= 4
      ? config.island.terrainWeightIceExposed
      : exposure >= 3
        ? config.island.terrainWeightIceEdge
        : config.island.terrainWeightIceInner;
  const weights = [
    config.island.terrainWeightSnow * profile.snow,
    config.island.terrainWeightGrass * profile.grass,
    iceWeight * profile.ice,
    config.island.terrainWeightForest * profile.forest,
    config.island.terrainWeightSand * profile.sand,
  ];
  return ORDERED_KINDS[weightedPick(rng, weights)]!;
}

/** Moves a silhouette onto its anchor hex and fills it in. Tiles come back back-to-front. */
function paintCluster(rng: Rng, options: PaintOptions): Tile[] {
  const hexes = options.shape.map((hex) => ({ q: hex.q + options.origin.q, r: hex.r + options.origin.r }));
  const present = new Set(hexes.map((hex) => hexKey(hex.q, hex.r)));

  const byKey = new Map<string, Tile>();
  for (const hex of hexes) {
    let touching = 0;
    const neighbourKinds: TerrainKind[] = [];
    for (const around of neighboursOf(hex)) {
      const key = hexKey(around.q, around.r);
      if (!present.has(key)) {
        continue;
      }
      touching += 1;
      const already = byKey.get(key);
      if (already) {
        neighbourKinds.push(already.terrain);
      }
    }
    byKey.set(hexKey(hex.q, hex.r), {
      q: hex.q,
      r: hex.r,
      terrain: pickTerrain(rng, 6 - touching, neighbourKinds, options.profile),
      owner: options.owner,
      seed: hashCoords(hex.q, hex.r, options.seed),
      islandId: options.islandId,
      // The world assigns the real one once every island is placed and sorted.
      index: -1,
    });
  }

  ensureVariety(rng, [...byKey.values()], options.quota);

  return [...byKey.values()].sort(compareByRow);
}

/** Back-to-front order: rows away from the camera first, then left to right. */
function compareByRow(left: Tile, right: Tile): number {
  const leftRow = left.r + left.q / 2;
  const rightRow = right.r + right.q / 2;
  if (leftRow !== rightRow) {
    return leftRow - rightRow;
  }
  return left.q - right.q;
}

/**
 * Repaints tiles until every biome the quota asks for is present.
 *
 * The starting islands are the only ones with a quota: the build roster wants a
 * meadow, a wood and a wasteland hex, and a run of unlucky rolls could leave an
 * island without one. Wild islands carry no quota at all, so their zone profile
 * decides the whole mix on its own and the three zones stay visibly different.
 *
 * A biome whose profile weight is zero can never be rolled and is never copied
 * from a neighbour that does not have it, so nothing has to scrub it afterwards.
 */
function ensureVariety(rng: Rng, tiles: readonly Tile[], quota: TerrainQuota): void {
  for (const kind of TERRAIN_KINDS) {
    const wanted = quota[kind] ?? 0;
    for (;;) {
      const present = tiles.filter((tile) => tile.terrain === kind).length;
      if (present >= wanted) {
        break;
      }
      // Take from whichever biome has the most tiles to spare, and never from
      // one the quota is still short of.
      const counts = new Map<TerrainKind, number>();
      for (const tile of tiles) {
        counts.set(tile.terrain, (counts.get(tile.terrain) ?? 0) + 1);
      }
      const donors = tiles.filter(
        (tile) => tile.terrain !== kind && (counts.get(tile.terrain) ?? 0) > (quota[tile.terrain] ?? 0),
      );
      if (donors.length === 0) {
        break;
      }
      donors[Math.floor(rng() * donors.length)]!.terrain = kind;
    }
  }
}

export type { PaintOptions, TerrainProfile, TerrainQuota, Tile };
export { OWNER_ENEMY, OWNER_PLAYER, OWNER_WILD, compareByRow, growCluster, paintCluster };
