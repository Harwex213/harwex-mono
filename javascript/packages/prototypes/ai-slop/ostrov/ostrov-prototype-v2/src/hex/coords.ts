/** Axial hex coordinate. `q` runs along the flat-top columns, `r` down the rows. */
type Axial = {
  q: number;
  r: number;
};

/**
 * Neighbour offsets, ordered so that index `i` is also the index of the hex
 * edge shared with that neighbour. Edge `i` spans corner `i` and corner `i + 1`
 * (see `HEX_CORNER_ANGLES` in `layout.ts`).
 */
const HEX_DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

/** Stable string key for map/set lookups. */
function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

function neighbourOf(hex: Axial, direction: number): Axial {
  const offset = HEX_DIRECTIONS[direction]!;
  return { q: hex.q + offset.q, r: hex.r + offset.r };
}

function neighboursOf(hex: Axial): Axial[] {
  return HEX_DIRECTIONS.map((offset) => ({ q: hex.q + offset.q, r: hex.r + offset.r }));
}

/** Distance in hex steps. */
function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

/** Rounds fractional axial coordinates to the nearest hex via cube rounding. */
function roundAxial(q: number, r: number): Axial {
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
}

export type { Axial };
export { HEX_DIRECTIONS, hexDistance, hexKey, neighbourOf, neighboursOf, roundAxial };
