/**
 * The whole game speaks axial coordinates: a tile is a pair `q, r` and nothing
 * else. Offset coordinates appear once, in the generator, to walk the
 * rectangular bounds of the board; every other module works in axial space.
 */

type TAxial = {
  q: number;
  r: number;
};

/** Neighbour steps in axial space, clockwise from the east neighbour. */
const AXIAL_DIRECTIONS: readonly TAxial[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

/** The string a tile is stored under, in every `Map` and `Set` in the game. */
const axialKey = (q: number, r: number): string => `${q},${r}`;

/** Distance in hex steps, via the cube coordinate that axial leaves implicit. */
const axialDistance = (a: TAxial, b: TAxial): number => {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -dq - dr;

  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
};

/** The six tiles around `cell`, in clockwise order. */
const axialNeighbours = (cell: TAxial): TAxial[] =>
  AXIAL_DIRECTIONS.map((direction) => ({ q: cell.q + direction.q, r: cell.r + direction.r }));

/** Rounds fractional axial coordinates to the hex that contains the point. */
const roundAxial = (q: number, r: number): TAxial => {
  const s = -q - r;
  let roundedQ = Math.round(q);
  let roundedR = Math.round(r);
  const roundedS = Math.round(s);
  const deltaQ = Math.abs(roundedQ - q);
  const deltaR = Math.abs(roundedR - r);
  const deltaS = Math.abs(roundedS - s);

  if (deltaQ > deltaR && deltaQ > deltaS) {
    roundedQ = -roundedR - roundedS;
  } else if (deltaR > deltaS) {
    roundedR = -roundedQ - roundedS;
  }

  return { q: roundedQ, r: roundedR };
};

/**
 * Row `row`, column `col` of an `odd-r` rectangle as an axial pair. The board is
 * a rectangle because a 5x5 rhombus of raw axial pairs reads as a slanted
 * lozenge on screen, and a board should look like a board.
 */
const offsetToAxial = (col: number, row: number): TAxial => ({
  q: col - (row - (row & 1)) / 2,
  r: row,
});

export type { TAxial };
export { AXIAL_DIRECTIONS, axialDistance, axialKey, axialNeighbours, offsetToAxial, roundAxial };
