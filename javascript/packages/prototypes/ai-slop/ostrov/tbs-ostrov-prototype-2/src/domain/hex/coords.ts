/**
 * The map is a rectangle of pointy-top hexes stored in `odd-r` offset layout:
 * every odd row is pushed half a hex to the right. Offset coordinates make the
 * rectangle trivial to iterate, axial coordinates make neighbour maths trivial,
 * so both live here and the generator converts between them as needed.
 */

type TOffset = {
  col: number;
  row: number;
};

type TAxial = {
  q: number;
  r: number;
};

/** Neighbour offsets in axial space, clockwise from the east neighbour. */
const HEX_DIRECTIONS: readonly TAxial[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

const offsetToAxial = (col: number, row: number): TAxial => {
  const q = col - (row - (row & 1)) / 2;

  return { q, r: row };
};

const axialToOffset = (q: number, r: number): TOffset => {
  const col = q + (r - (r & 1)) / 2;

  return { col, row: r };
};

/**
 * The same six directions as `HEX_DIRECTIONS`, precomputed as column and row
 * steps. In an offset layout the column step depends on the parity of the row,
 * so there is one table per parity. Going through these instead of converting to
 * axial and back saves two object allocations per neighbour, which matters when
 * a 400x400 map walks 160 000 cells several times over.
 */
const OFFSET_STEPS_EVEN: readonly number[] = [1, 0, 0, 1, -1, 1, -1, 0, -1, -1, 0, -1];
const OFFSET_STEPS_ODD: readonly number[] = [1, 0, 1, 1, 0, 1, -1, 0, 0, -1, 1, -1];

/**
 * Writes the indices of the six neighbours of cell `index` into `out` and returns
 * how many were written. Neighbours outside the rectangle are skipped, so a
 * border cell reports fewer than six. `out` must hold at least six entries.
 */
const fillNeighbours = (index: number, width: number, height: number, out: Int32Array): number => {
  const col = index % width;
  const row = (index - col) / width;
  const steps = (row & 1) === 0 ? OFFSET_STEPS_EVEN : OFFSET_STEPS_ODD;
  let found = 0;

  for (let direction = 0; direction < 6; direction += 1) {
    const neighbourCol = col + steps[direction * 2]!;
    const neighbourRow = row + steps[direction * 2 + 1]!;
    if (neighbourCol < 0 || neighbourCol >= width) {
      continue;
    }
    if (neighbourRow < 0 || neighbourRow >= height) {
      continue;
    }
    out[found] = neighbourRow * width + neighbourCol;
    found += 1;
  }

  return found;
};

/**
 * Index of the neighbour of cell `index` in direction `direction`, or `-1` when
 * that neighbour falls outside the rectangle. Direction `i` is also the index of
 * the shared hex edge, which is what the outline pass needs.
 */
const neighbourIndexInDirection = (index: number, direction: number, width: number, height: number): number => {
  const col = index % width;
  const row = (index - col) / width;
  const steps = (row & 1) === 0 ? OFFSET_STEPS_EVEN : OFFSET_STEPS_ODD;
  const neighbourCol = col + steps[direction * 2]!;
  const neighbourRow = row + steps[direction * 2 + 1]!;

  if (neighbourCol < 0 || neighbourCol >= width) {
    return -1;
  }
  if (neighbourRow < 0 || neighbourRow >= height) {
    return -1;
  }

  return neighbourRow * width + neighbourCol;
};

/** Rounds fractional axial coordinates to the nearest hex via cube rounding. */
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

export type { TAxial, TOffset };
export {
  HEX_DIRECTIONS,
  axialToOffset,
  fillNeighbours,
  neighbourIndexInDirection,
  offsetToAxial,
  roundAxial,
};
