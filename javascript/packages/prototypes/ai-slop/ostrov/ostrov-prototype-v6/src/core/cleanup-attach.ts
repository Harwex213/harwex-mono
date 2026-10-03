import { AXIAL_DIRECTIONS, HEX_SIZE, hexId, hexToPixel } from "./hex";
import type { TAxial } from "./hex";

/**
 * Snapping a cleared island onto the player's island. Islands never rotate,
 * so both hex lattices share one orientation: the only freedom is an axial
 * translation. The snap rounds the islands' relative position to the nearest
 * lattice translation, then tries its six neighbours too and keeps the one
 * with the fewest clashing hexes. Clashing hexes are dropped, and so is any
 * new hex that would not connect to the island: the island stays one piece.
 */

const SQRT_3 = Math.sqrt(3);

type TAttachPlan = {
  /** Axial translation from the joining island's frame to the player's frame. */
  readonly offsetQ: number;
  readonly offsetR: number;
  /** Indices of the joining island's hexes that join, in its own order. */
  readonly kept: readonly number[];
  /** How many of its hexes were dropped (clash or no connection). */
  readonly dropped: number;
};

type TSeamEdge = {
  /** Midpoint of the shared edge, in the player's island frame. */
  readonly x: number;
  readonly y: number;
  /** Unit vector across the edge, from the old hex into the new one. */
  readonly nx: number;
  readonly ny: number;
};

/** Fractional axial coordinates of a pixel offset (pointy-top). */
const pixelToAxial = (x: number, y: number) => ({
  q: ((SQRT_3 / 3) * x - y / 3) / HEX_SIZE,
  r: ((2 / 3) * y) / HEX_SIZE,
});

/** Cube rounding: the lattice cell that contains a fractional axial point. */
const roundAxial = (q: number, r: number): TAxial => {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);

  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }

  return { q: rq, r: rr };
};

/**
 * Where a joining island fits. `dx, dy` is its origin relative to the player
 * island's origin. Returns `null` when no hex of it would connect.
 */
const planAttachment = (
  base: readonly TAxial[],
  joining: readonly TAxial[],
  dx: number,
  dy: number,
): TAttachPlan | null => {
  const taken = new Set(base.map((hex) => hexId(hex.q, hex.r)));
  const fraction = pixelToAxial(dx, dy);
  const center = roundAxial(fraction.q, fraction.r);
  const candidates: TAxial[] = [center, ...AXIAL_DIRECTIONS.map((step) => ({ q: center.q + step.q, r: center.r + step.r }))];

  let best: { offset: TAxial; score: number } | null = null;

  for (const offset of candidates) {
    const clashes = joining.filter((hex) => taken.has(hexId(hex.q + offset.q, hex.r + offset.r))).length;
    const at = hexToPixel(offset.q, offset.r, HEX_SIZE);
    // A clash costs more than any distance, so the cleanest fit wins first.
    const score = clashes * 1e6 + Math.hypot(at.x - dx, at.y - dy);
    if (!best || score < best.score) {
      best = { offset, score };
    }
  }

  if (!best) {
    return null;
  }

  const { offset } = best;
  const free = joining
    .map((hex, index) => ({ index, key: hexId(hex.q + offset.q, hex.r + offset.r), q: hex.q + offset.q, r: hex.r + offset.r }))
    .filter((hex) => !taken.has(hex.key));

  // Keep only the new hexes that the old island reaches through new hexes.
  const freeByKey = new Map(free.map((hex) => [hex.key, hex]));
  const reached = new Set<string>();
  const queue = free.filter((hex) => {
    return AXIAL_DIRECTIONS.some((step) => taken.has(hexId(hex.q + step.q, hex.r + step.r)));
  });
  for (const hex of queue) {
    reached.add(hex.key);
  }

  for (let head = 0; head < queue.length; head += 1) {
    const hex = queue[head] as (typeof free)[number];
    for (const step of AXIAL_DIRECTIONS) {
      const next = freeByKey.get(hexId(hex.q + step.q, hex.r + step.r));
      if (next && !reached.has(next.key)) {
        reached.add(next.key);
        queue.push(next);
      }
    }
  }

  const kept = free.filter((hex) => reached.has(hex.key)).map((hex) => hex.index);
  if (kept.length === 0) {
    return null;
  }

  return { offsetQ: offset.q, offsetR: offset.r, kept, dropped: joining.length - kept.length };
};

/** The edges where old hexes meet new ones, for the ink stitching. */
const seamEdges = (base: readonly TAxial[], added: readonly TAxial[]): readonly TSeamEdge[] => {
  const old = new Set(base.map((hex) => hexId(hex.q, hex.r)));
  const edges: TSeamEdge[] = [];

  for (const hex of added) {
    const center = hexToPixel(hex.q, hex.r, HEX_SIZE);
    for (const step of AXIAL_DIRECTIONS) {
      if (!old.has(hexId(hex.q + step.q, hex.r + step.r))) {
        continue;
      }

      const other = hexToPixel(hex.q + step.q, hex.r + step.r, HEX_SIZE);
      const length = Math.hypot(center.x - other.x, center.y - other.y) || 1;
      edges.push({
        x: (center.x + other.x) / 2,
        y: (center.y + other.y) / 2,
        nx: (center.x - other.x) / length,
        ny: (center.y - other.y) / length,
      });
    }
  }

  return edges;
};

/** True when every hex reaches every other through neighbours. */
const isConnected = (hexes: readonly TAxial[]) => {
  if (hexes.length === 0) {
    return true;
  }

  const keys = new Set(hexes.map((hex) => hexId(hex.q, hex.r)));
  const first = hexes[0] as TAxial;
  const seen = new Set([hexId(first.q, first.r)]);
  const queue = [first];

  for (let head = 0; head < queue.length; head += 1) {
    const hex = queue[head] as TAxial;
    for (const step of AXIAL_DIRECTIONS) {
      const key = hexId(hex.q + step.q, hex.r + step.r);
      if (keys.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push({ q: hex.q + step.q, r: hex.r + step.r });
      }
    }
  }

  return seen.size === keys.size;
};

export type { TAttachPlan, TSeamEdge };
export { isConnected, planAttachment, roundAxial, seamEdges };
