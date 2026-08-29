/**
 * The island lives on a rectangle of pointy-top hexes stored in `odd-r` offset
 * layout: every odd row is pushed half a hex to the right. Offset coordinates
 * make the rectangle trivial to iterate, axial coordinates make neighbour maths
 * trivial, so both live here.
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
 * Indices of the six neighbours of tile `index`, in a map `width` wide and
 * `height` tall. Neighbours outside the rectangle are dropped, so a border tile
 * reports fewer than six.
 */
const neighbourIndices = (index: number, width: number, height: number): number[] => {
  const col = index % width;
  const row = Math.floor(index / width);
  const axial = offsetToAxial(col, row);
  const result: number[] = [];

  for (const direction of HEX_DIRECTIONS) {
    const neighbour = axialToOffset(axial.q + direction.q, axial.r + direction.r);
    if (neighbour.col < 0 || neighbour.col >= width) {
      continue;
    }
    if (neighbour.row < 0 || neighbour.row >= height) {
      continue;
    }
    result.push(neighbour.row * width + neighbour.col);
  }

  return result;
};

/**
 * Index of the neighbour of tile `index` in direction `direction`, or `-1` when
 * that neighbour falls outside the rectangle. Direction `i` is also the index of
 * the shared hex edge, which is what the coastline pass needs.
 */
const neighbourIndexInDirection = (index: number, direction: number, width: number, height: number): number => {
  const col = index % width;
  const row = Math.floor(index / width);
  const axial = offsetToAxial(col, row);
  const offset = HEX_DIRECTIONS[direction]!;
  const neighbour = axialToOffset(axial.q + offset.q, axial.r + offset.r);

  if (neighbour.col < 0 || neighbour.col >= width) {
    return -1;
  }
  if (neighbour.row < 0 || neighbour.row >= height) {
    return -1;
  }

  return neighbour.row * width + neighbour.col;
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
export { HEX_DIRECTIONS, axialToOffset, neighbourIndexInDirection, neighbourIndices, offsetToAxial, roundAxial };
