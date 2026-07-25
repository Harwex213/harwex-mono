import { offsetToAxial, axialToOffset } from "./hex-layout.js";

const FACING_COUNT = 6;

// edge index 0..5, fixed order used everywhere
const AXIAL_DIRECTIONS = [
  { q: 1, r: 0 }, // 0 E
  { q: 1, r: -1 }, // 1 NE
  { q: 0, r: -1 }, // 2 NW
  { q: -1, r: 0 }, // 3 W
  { q: -1, r: 1 }, // 4 SW
  { q: 0, r: 1 }, // 5 SE
];

const HEX_ZONE = {
  FRONT: "front",
  FLANK: "flank",
  REAR: "rear",
};

/**
 * @param {{row: number, col: number}} position
 * @param {number} dir edge index 0..5
 * @returns {{row: number, col: number}}
 */
const neighbor = (position, dir) => {
  const a = offsetToAxial(position.col, position.row);
  const d = AXIAL_DIRECTIONS[dir];
  const off = axialToOffset(a.q + d.q, a.r + d.r);
  return { row: off.row, col: off.col };
};

/**
 * @param {{row: number, col: number}} position
 * @returns {{row: number, col: number}[]} all 6 neighbors, index === edge dir
 */
const neighbors = (position) => AXIAL_DIRECTIONS.map((_, dir) => neighbor(position, dir));

/**
 * @param {{row: number, col: number}} position
 * @param {number} facing vertex orientation 0..5
 * @returns {{row: number, col: number}[]}
 */
const frontHexes = (position, facing) => [
  neighbor(position, facing),
  neighbor(position, (facing + 1) % FACING_COUNT),
];

/**
 * @param {{row: number, col: number}} position
 * @param {number} facing vertex orientation 0..5
 * @returns {{row: number, col: number}[]}
 */
const flankHexes = (position, facing) => [
  neighbor(position, (facing + 5) % FACING_COUNT),
  neighbor(position, (facing + 2) % FACING_COUNT),
];

/**
 * @param {{row: number, col: number}} position
 * @param {number} facing vertex orientation 0..5
 * @returns {{row: number, col: number}[]}
 */
const rearHexes = (position, facing) => [
  neighbor(position, (facing + 3) % FACING_COUNT),
  neighbor(position, (facing + 4) % FACING_COUNT),
];

/**
 * @param {{row: number, col: number}} fromPos
 * @param {{row: number, col: number}} toPos
 * @returns {number} edge index 0..5, or -1 when not adjacent
 */
const directionTo = (fromPos, toPos) => {
  const aFrom = offsetToAxial(fromPos.col, fromPos.row);
  const aTo = offsetToAxial(toPos.col, toPos.row);
  const dq = aTo.q - aFrom.q;
  const dr = aTo.r - aFrom.r;
  return AXIAL_DIRECTIONS.findIndex((d) => d.q === dq && d.r === dr);
};

/**
 * @param {number} dir edge index 0..5
 * @param {number} facing vertex orientation 0..5
 * @returns {string} `HEX_ZONE` value
 */
const zoneFromDir = (dir, facing) => {
  const d = (dir - facing + FACING_COUNT) % FACING_COUNT;
  if (d <= 1) {
    return HEX_ZONE.FRONT;
  }
  return d === 2 || d === 5 ? HEX_ZONE.FLANK : HEX_ZONE.REAR;
};

/**
 * Where `otherPos` sits relative to `unitPos`'s facing.
 * @param {{row: number, col: number}} unitPos
 * @param {number} unitFacing
 * @param {{row: number, col: number}} otherPos
 * @returns {string | null} `HEX_ZONE` value, or null when not adjacent
 */
const zoneOf = (unitPos, unitFacing, otherPos) => {
  const dir = directionTo(unitPos, otherPos);
  if (dir < 0) {
    return null;
  }
  return zoneFromDir(dir, unitFacing);
};

/**
 * Decompose the vector shooter→target into the two front edge-direction basis
 * vectors (DIR[facing], DIR[facing+1]). On a hex grid every target in the 60°
 * frontal wedge has integer a,b ≥ 0 and lies at hex-distance a+b.
 * @param {{row: number, col: number}} shooterPos
 * @param {number} facing 0..5
 * @param {{row: number, col: number}} targetPos
 * @returns {{a: number, b: number}}
 */
const frontalConeCoords = (shooterPos, facing, targetPos) => {
  const aS = offsetToAxial(shooterPos.col, shooterPos.row);
  const aT = offsetToAxial(targetPos.col, targetPos.row);
  const dq = aT.q - aS.q;
  const dr = aT.r - aS.r;
  const d1 = AXIAL_DIRECTIONS[facing];
  const d2 = AXIAL_DIRECTIONS[(facing + 1) % FACING_COUNT];
  const det = d1.q * d2.r - d2.q * d1.r;
  const a = (dq * d2.r - dr * d2.q) / det;
  const b = (d1.q * dr - d1.r * dq) / det;
  return { a, b };
};

/**
 * @param {{row: number, col: number}} shooterPos
 * @param {number} facing 0..5
 * @param {{row: number, col: number}} targetPos
 * @returns {number | null} distance to target if it lies in the frontal cone, else null
 */
const frontalConeReach = (shooterPos, facing, targetPos) => {
  const { a, b } = frontalConeCoords(shooterPos, facing, targetPos);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a + b < 1) {
    return null;
  }
  return a + b;
};

/**
 * @param {{row: number, col: number}} shooterPos
 * @param {number} facing 0..5
 * @param {{row: number, col: number}} targetPos
 * @returns {boolean}
 */
const inFrontalCone = (shooterPos, facing, targetPos) => frontalConeReach(shooterPos, facing, targetPos) !== null;

/**
 * Which edge direction (0..5) best points from `fromPos` to `toPos` at any
 * range; equals `directionTo` when the hexes are adjacent.
 * @param {{row: number, col: number}} fromPos
 * @param {{row: number, col: number}} toPos
 * @returns {number} edge index 0..5, or -1 when `toPos` is `fromPos`
 */
const bearingDir = (fromPos, toPos) => {
  for (let f = 0; f < FACING_COUNT; f += 1) {
    const { a, b } = frontalConeCoords(fromPos, f, toPos);
    if (Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a + b >= 1) {
      return b > a ? (f + 1) % FACING_COUNT : f;
    }
  }
  return -1;
};

/**
 * Target-relative zone that works at range (uses `bearingDir`, never null for
 * distinct hexes).
 * @param {{row: number, col: number}} unitPos
 * @param {number} unitFacing
 * @param {{row: number, col: number}} otherPos
 * @returns {string} `HEX_ZONE` value
 */
const zoneAtRange = (unitPos, unitFacing, otherPos) => {
  const dir = bearingDir(unitPos, otherPos);
  if (dir < 0) {
    return HEX_ZONE.FRONT;
  }
  return zoneFromDir(dir, unitFacing);
};

/**
 * @param {{row: number, col: number}} a
 * @param {{row: number, col: number}} b
 * @returns {number} hex distance (odd-r offset → axial cube distance)
 */
const hexDistance = (a, b) => {
  const aa = offsetToAxial(a.col, a.row);
  const ab = offsetToAxial(b.col, b.row);
  return (Math.abs(aa.q - ab.q) + Math.abs(aa.q + aa.r - ab.q - ab.r) + Math.abs(aa.r - ab.r)) / 2;
};

export {
  neighbor,
  neighbors,
  frontHexes,
  flankHexes,
  rearHexes,
  directionTo,
  zoneOf,
  zoneFromDir,
  hexDistance,
  frontalConeCoords,
  frontalConeReach,
  inFrontalCone,
  bearingDir,
  zoneAtRange,
  HEX_ZONE,
  FACING_COUNT,
  AXIAL_DIRECTIONS,
};
