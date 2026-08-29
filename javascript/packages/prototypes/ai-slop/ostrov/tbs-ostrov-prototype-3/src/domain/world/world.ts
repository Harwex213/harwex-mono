import { hexDistance, hexKey, neighboursOf } from "../hex/coords";
import { insideGrid } from "../hex/grid";
import type { TAxial } from "../hex/coords";
import type { TIsland, TTile } from "../island/generator";

/** Radius of the sky the islands float in. */
const SKY_RADIUS = 9;

/** Radius of the local grid an island is grown on. */
const ISLAND_RADIUS = 2;

/** How many sky steps an island can fly in one move. */
const MOVE_RANGE = 3;

type TOwner = "player" | "neutral";

type TWorldIsland = {
  id: string;
  owner: TOwner;
  /** Sky cell the island's local origin sits on. */
  anchor: TAxial;
  island: TIsland;
};

type TWorld = {
  seed: number;
  islands: TWorldIsland[];
};

/** Land tiles in sky coordinates. */
const footprintOf = (worldIsland: TWorldIsland, anchor = worldIsland.anchor): TAxial[] => {
  return worldIsland.island.tiles
    .filter((tile: TTile) => tile.land)
    .map((tile: TTile) => ({ q: tile.q + anchor.q, r: tile.r + anchor.r }));
};

/** Sky cell key to the island that stands on it. */
const occupancyOf = (islands: readonly TWorldIsland[], skip?: string) => {
  const occupied = new Map<string, TWorldIsland>();

  for (const worldIsland of islands) {
    if (worldIsland.id === skip) {
      continue;
    }

    for (const cell of footprintOf(worldIsland)) {
      occupied.set(hexKey(cell.q, cell.r), worldIsland);
    }
  }

  return occupied;
};

/** The island fits at `anchor`: every land tile is in the sky and on free air. */
const fitsAt = (worldIsland: TWorldIsland, anchor: TAxial, occupied: Map<string, TWorldIsland>) => {
  return footprintOf(worldIsland, anchor).every((cell) => {
    return insideGrid(cell, SKY_RADIUS) && !occupied.has(hexKey(cell.q, cell.r));
  });
};

/** Every anchor the island can fly to this move. */
const moveTargetsOf = (world: TWorld, islandId: string, range = MOVE_RANGE): TAxial[] => {
  const worldIsland = world.islands.find((entry) => entry.id === islandId);
  if (!worldIsland) {
    return [];
  }

  const occupied = occupancyOf(world.islands, islandId);
  const targets: TAxial[] = [];

  for (let dq = -range; dq <= range; dq += 1) {
    for (let dr = -range; dr <= range; dr += 1) {
      const anchor = { q: worldIsland.anchor.q + dq, r: worldIsland.anchor.r + dr };
      const steps = hexDistance(anchor, worldIsland.anchor);

      if (steps === 0 || steps > range) {
        continue;
      }

      if (fitsAt(worldIsland, anchor, occupied)) {
        targets.push(anchor);
      }
    }
  }

  return targets;
};

type TLink = {
  from: TWorldIsland;
  to: TWorldIsland;
  /** The touching tiles the bridge is drawn between, in sky coordinates. */
  cellFrom: TAxial;
  cellTo: TAxial;
};

/**
 * The bridge between two islands, or `null` when no tile of one touches a
 * tile of the other. Several tiles may touch; the pair nearest the middle of
 * the two anchors is picked, so the bridge sits between the island bodies.
 */
const linkBetween = (a: TWorldIsland, b: TWorldIsland): TLink | null => {
  const cellsOfB = new Map(footprintOf(b).map((cell) => [hexKey(cell.q, cell.r), cell]));
  const middle = { q: (a.anchor.q + b.anchor.q) / 2, r: (a.anchor.r + b.anchor.r) / 2 };
  let best: TLink | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const cell of footprintOf(a)) {
    for (const neighbour of neighboursOf(cell)) {
      const other = cellsOfB.get(hexKey(neighbour.q, neighbour.r));
      if (!other) {
        continue;
      }

      const score = hexDistance(cell, middle) + hexDistance(other, middle);
      if (score < bestScore) {
        bestScore = score;
        best = { from: a, to: b, cellFrom: cell, cellTo: other };
      }
    }
  }

  return best;
};

const areLinked = (a: TWorldIsland, b: TWorldIsland) => linkBetween(a, b) !== null;

/** Every linked pair, each pair once. */
const linksOf = (world: TWorld): TLink[] => {
  const links: TLink[] = [];

  world.islands.forEach((a, index) => {
    for (const b of world.islands.slice(index + 1)) {
      const link = linkBetween(a, b);
      if (link) {
        links.push(link);
      }
    }
  });

  return links;
};

/** Ids of the islands linked to the one given. */
const linkedIdsOf = (world: TWorld, islandId: string): string[] => {
  return linksOf(world)
    .filter((link) => link.from.id === islandId || link.to.id === islandId)
    .map((link) => (link.from.id === islandId ? link.to.id : link.from.id));
};

const moveIsland = (world: TWorld, islandId: string, anchor: TAxial): TWorld => ({
  ...world,
  islands: world.islands.map((entry) => (entry.id === islandId ? { ...entry, anchor } : entry)),
});

export type { TLink, TOwner, TWorld, TWorldIsland };
export {
  ISLAND_RADIUS,
  MOVE_RANGE,
  SKY_RADIUS,
  areLinked,
  fitsAt,
  linkBetween,
  footprintOf,
  linkedIdsOf,
  linksOf,
  moveIsland,
  moveTargetsOf,
  occupancyOf,
};
