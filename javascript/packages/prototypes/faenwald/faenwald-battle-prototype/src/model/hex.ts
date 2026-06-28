/**
 * Model layer — axial / cube hex math (GDD §2.1).
 *
 * A pure, side-effect-free utility. Coordinates are **axial** `{ q, r }` with
 * the cube `s = -q - r` derived on demand, which makes distance, neighbour and
 * line-drawing trivial. The UI may render flat-top or pointy-top; this module
 * is the single source of truth for grid geometry regardless.
 */

import type { Axial } from './types.ts';

/**
 * The six unit direction vectors, indexed 0..5 going clockwise on a pointy-top
 * layout (see {@link axialToPixel}). A `Facing` (§2.2) points at the vertex
 * *between* direction `f` and `f + 1`.
 */
export const HEX_DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 }, // 0 — E
  { q: 1, r: -1 }, // 1 — NE
  { q: 0, r: -1 }, // 2 — NW
  { q: -1, r: 0 }, // 3 — W
  { q: -1, r: 1 }, // 4 — SW
  { q: 0, r: 1 }, // 5 — SE
];

/** Number of hex directions / neighbours. */
export const HEX_DIRECTION_COUNT = 6;

/** True when two axial coordinates refer to the same hex. */
export function hexEquals(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

/** Add two axial coordinates (vector addition). */
export function hexAdd(a: Axial, b: Axial): Axial {
  return { q: a.q + b.q, r: a.r + b.r };
}

/** Subtract `b` from `a` (the vector from `b` to `a`). */
export function hexSubtract(a: Axial, b: Axial): Axial {
  return { q: a.q - b.q, r: a.r - b.r };
}

/** Scale an axial vector by an integer factor. */
export function hexScale(a: Axial, factor: number): Axial {
  return { q: a.q * factor, r: a.r * factor };
}

/** The derived cube `s` coordinate (`-q - r`). */
export function cubeS(a: Axial): number {
  return -a.q - a.r || 0; // `|| 0` normalises -0 to 0
}

/**
 * The hex one step from `hex` in direction `dir` (0..5, wraps modulo 6).
 * @see HEX_DIRECTIONS
 */
export function neighbor(hex: Axial, dir: number): Axial {
  const direction = HEX_DIRECTIONS[((dir % HEX_DIRECTION_COUNT) + HEX_DIRECTION_COUNT) % HEX_DIRECTION_COUNT];
  return hexAdd(hex, direction);
}

/** All six neighbours of `hex`, ordered by direction index 0..5. */
export function neighbors(hex: Axial): Axial[] {
  return HEX_DIRECTIONS.map((direction) => hexAdd(hex, direction));
}

/**
 * Cube distance between two hexes — the minimum number of single-step moves
 * between them: `(|Δq| + |Δr| + |Δs|) / 2`.
 */
export function distance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = cubeS(a) - cubeS(b);
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

/** Round fractional cube coordinates to the nearest valid hex (constraint q+r+s=0). */
function cubeRound(qf: number, rf: number): Axial {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);

  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);

  // Reset the component with the largest rounding error so q + r + s stays 0.
  if (dq > dr && dq > ds) {
    q = -r - s;
  } else if (dr > ds) {
    r = -q - s;
  }

  return { q, r };
}

/**
 * The straight line of hexes from `a` to `b`, inclusive of both endpoints,
 * via cube linear interpolation + rounding. Used for line-of-fire and reach
 * checks (§2.3, §5.4).
 */
export function lineDraw(a: Axial, b: Axial): Axial[] {
  const n = distance(a, b);
  if (n === 0) return [{ q: a.q, r: a.r }];

  const line: Axial[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    line.push(cubeRound(a.q + (b.q - a.q) * t, a.r + (b.r - a.r) * t));
  }
  return line;
}

/**
 * Pixel centre of a hex on a **pointy-top** layout, used to derive bearings
 * (see `zones.ts`) and, later, to render. `size` is the hex circumradius.
 */
export function axialToPixel(hex: Axial, size = 1): { x: number; y: number } {
  const x = size * Math.sqrt(3) * (hex.q + hex.r / 2);
  const y = size * (3 / 2) * hex.r;
  return { x, y };
}
