/**
 * Axial hex coordinate. The board is pointy-top: `q` runs left to right along a
 * row, `r` runs down the rows and shifts every row half a hex to the right.
 */
type TAxial = {
  q: number;
  r: number;
};

/** Neighbour offsets in axial space, clockwise from "east". */
const HEX_DIRECTIONS: readonly TAxial[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

/** Stable string key over axial coordinates, used for map and set lookups. */
const hexKey = (q: number, r: number) => `${q},${r}`;

const neighboursOf = (hex: TAxial): TAxial[] => {
  return HEX_DIRECTIONS.map((offset) => ({ q: hex.q + offset.q, r: hex.r + offset.r }));
};

/** Distance in hex steps between two cells. */
const hexDistance = (a: TAxial, b: TAxial) => {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -dq - dr;

  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
};

export type { TAxial };
export { HEX_DIRECTIONS, hexDistance, hexKey, neighboursOf };
