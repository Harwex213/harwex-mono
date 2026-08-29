import { axialToOffset, inRange, offsetToAxial } from "../hex/offset";
import { hexKey, neighboursOf } from "@hw/ostrov-utils";
import type { TAxial } from "@hw/ostrov-utils";
import type { TOffset, TRange } from "../hex/offset";

/**
 * How many anchor cells one island may try before the generator gives up on it.
 * The cap only bites on a crowded world, where almost every anchor fails.
 */
const ANCHOR_LIMIT = 4000;

/**
 * Cells an island may not touch. It holds every land tile already placed plus
 * every neighbour of those tiles, so a new island that misses the whole set is
 * at least two hex steps away from every other island. That leaves one empty
 * world hex between any two islands, which is the rule the world asks for.
 *
 * Keys are axial. Adjacency is a plain offset addition in axial space, which it
 * is not in offset space.
 */
class BlockedCells {
  private readonly keys = new Set<string>();

  /** Marks the tiles of a placed island, and the ring of sea around them. */
  block(tiles: readonly TAxial[]) {
    for (const tile of tiles) {
      this.keys.add(hexKey(tile.q, tile.r));

      for (const neighbour of neighboursOf(tile)) {
        this.keys.add(hexKey(neighbour.q, neighbour.r));
      }
    }
  }

  has(hex: TAxial) {
    return this.keys.has(hexKey(hex.q, hex.r));
  }
}

/**
 * Moves the footprint by `delta` and checks the result. The island has to sit
 * inside the world rectangle and miss every blocked cell. The moved tiles come
 * back on success, so the caller does not translate them a second time.
 */
const tryDelta = (
  footprint: readonly TAxial[],
  delta: TAxial,
  xRange: TRange,
  yRange: TRange,
  blocked: BlockedCells
): TAxial[] | null => {
  const moved: TAxial[] = [];

  for (const tile of footprint) {
    const hex = { q: tile.q + delta.q, r: tile.r + delta.r };
    const cell = axialToOffset(hex);

    if (!inRange(xRange, cell.x) || !inRange(yRange, cell.y)) {
      return null;
    }

    if (blocked.has(hex)) {
      return null;
    }

    moved.push(hex);
  }

  return moved;
};

type TPlacement = {
  /** The axial translation that puts the footprint where it landed. */
  delta: TAxial;
  /** The footprint after that translation. */
  tiles: TAxial[];
};

/**
 * Looks for a spot for one island. Anchors are walked in the order they were
 * given, which the generator shuffles, so the search is random but repeatable.
 * The island's own local origin is what lands on the anchor cell; the island
 * generator grows the land around that origin, so this centres the island there.
 */
const placeFootprint = (
  footprint: readonly TAxial[],
  anchors: readonly TOffset[],
  xRange: TRange,
  yRange: TRange,
  blocked: BlockedCells
): TPlacement | null => {
  const limit = Math.min(anchors.length, ANCHOR_LIMIT);

  for (let index = 0; index < limit; index += 1) {
    const delta = offsetToAxial(anchors[index]!);
    const tiles = tryDelta(footprint, delta, xRange, yRange, blocked);

    if (tiles !== null) {
      return { delta, tiles };
    }
  }

  return null;
};

export type { TPlacement };
export { ANCHOR_LIMIT, BlockedCells, placeFootprint };
