import type { Axial } from "../hex/coords";
import { hexKey, neighboursOf } from "../hex/coords";
import type { Rng } from "./rng";
import { createRng, hashCoords, weightedPick } from "./rng";
import type { TerrainKind } from "./terrain";

/** Owner id 0 means "wild", 1 means "the player's kingdom". */
const OWNER_WILD = 0;
const OWNER_PLAYER = 1;

type Tile = {
  q: number;
  r: number;
  terrain: TerrainKind;
  owner: number;
  /** Per-tile seed for decoration; never changes, so nothing shimmers on pan. */
  seed: number;
};

type IslandMap = {
  /** Painting order: back to front. */
  tiles: readonly Tile[];
  byKey: ReadonlyMap<string, Tile>;
  tileAt: (q: number, r: number) => Tile | null;
  ownerAt: (q: number, r: number) => number | null;
};

type GenerateOptions = {
  seed: number;
  /** How many hexes the island should end up with. */
  size: number;
};

/**
 * Grows the island one hex at a time. Frontier cells that touch few existing
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
        if (spread > 3) {
          continue;
        }
        // Two- and three-neighbour cells win most rolls, which keeps the island
        // a compact blob; the occasional one-neighbour win grows an arm.
        const armBias = [0, 2.6, 4.2, 2.4, 0.9, 0.4, 0.2][touching] ?? 0.2;
        frontier.push(candidate);
        weights.push(armBias / (1 + 0.5 * spread));
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

function pickTerrain(rng: Rng, exposure: number, neighbourKinds: readonly TerrainKind[]): TerrainKind {
  // Patches: most tiles copy a neighbour, so terrain comes in clumps.
  if (neighbourKinds.length > 0 && rng() < 0.42) {
    return neighbourKinds[Math.floor(rng() * neighbourKinds.length)]!;
  }
  // Exposed tips are where the ice shelves sit in the reference.
  const iceWeight = exposure >= 4 ? 2.6 : exposure >= 3 ? 1.4 : 0.5;
  const weights = [1.5, 1.0, iceWeight, 0.85, 1.05];
  return ORDERED_KINDS[weightedPick(rng, weights)]!;
}

function generateIsland(options: GenerateOptions): IslandMap {
  const rng = createRng(options.seed);
  const hexes = growCluster(rng, options.size);
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
      terrain: pickTerrain(rng, 6 - touching, neighbourKinds),
      owner: OWNER_PLAYER,
      seed: hashCoords(hex.q, hex.r, options.seed),
    });
  }

  ensureVariety(rng, byKey);
  claimWilds(rng, hexes, byKey);

  const tiles = [...byKey.values()].sort((left, right) => {
    const leftRow = left.r + left.q / 2;
    const rightRow = right.r + right.q / 2;
    if (leftRow !== rightRow) {
      return leftRow - rightRow;
    }
    return left.q - right.q;
  });

  const tileAt = (q: number, r: number): Tile | null => byKey.get(hexKey(q, r)) ?? null;

  return {
    tiles,
    byKey,
    tileAt,
    ownerAt: (q, r) => tileAt(q, r)?.owner ?? null,
  };
}

/**
 * Every terrain has to show up at least once, otherwise a roll of the dice can
 * hand back an island with no forest and no ice at all.
 */
function ensureVariety(rng: Rng, byKey: Map<string, Tile>): void {
  const tiles = [...byKey.values()];
  const wanted: Record<TerrainKind, number> = { snow: 3, grass: 2, ice: 2, forest: 2, sand: 2 };
  for (const kind of ORDERED_KINDS) {
    for (;;) {
      const present = tiles.filter((tile) => tile.terrain === kind).length;
      if (present >= wanted[kind]) {
        break;
      }
      // Take from whichever terrain is currently the most over-represented.
      const counts = new Map<TerrainKind, number>();
      for (const tile of tiles) {
        counts.set(tile.terrain, (counts.get(tile.terrain) ?? 0) + 1);
      }
      const donors = tiles.filter((tile) => tile.terrain !== kind && (counts.get(tile.terrain) ?? 0) > wanted[tile.terrain]);
      if (donors.length === 0) {
        break;
      }
      donors[Math.floor(rng() * donors.length)]!.terrain = kind;
    }
  }
}

/**
 * Leaves a small pocket of unclaimed land so the territory outline also has to
 * run along an internal boundary, not just around the silhouette.
 */
function claimWilds(rng: Rng, hexes: readonly Axial[], byKey: Map<string, Tile>): void {
  const ranked = [...hexes].sort((left, right) => {
    const leftSpread = Math.max(Math.abs(left.q), Math.abs(left.r), Math.abs(left.q + left.r));
    const rightSpread = Math.max(Math.abs(right.q), Math.abs(right.r), Math.abs(right.q + right.r));
    return rightSpread - leftSpread;
  });
  const anchor = ranked[Math.floor(rng() * Math.min(3, ranked.length))];
  if (!anchor) {
    return;
  }
  const pocket = [anchor, ...neighboursOf(anchor)];
  let claimed = 0;
  for (const hex of pocket) {
    const tile = byKey.get(hexKey(hex.q, hex.r));
    if (!tile || claimed >= 3) {
      continue;
    }
    tile.owner = OWNER_WILD;
    claimed += 1;
  }
}

export type { GenerateOptions, IslandMap, Tile };
export { OWNER_PLAYER, OWNER_WILD, generateIsland };
