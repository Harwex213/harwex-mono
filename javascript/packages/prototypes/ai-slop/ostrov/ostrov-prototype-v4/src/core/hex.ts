/**
 * The only place in the prototype that knows the hex layout (plan §7).
 * Pointy-top axial: a hex has a corner at the top, neighbours sit at 60 degree steps.
 */

type TPixelPoint = {
  x: number;
  y: number;
};

type TAxialCoord = {
  q: number;
  r: number;
};

/** Pointy-top axial layout size, in pixels. */
const HEX_SIZE_PX = 56;

const HEX_CORNER_COUNT = 6;
const HEX_TOP_ANGLE_DEG = -90;
const HEX_CORNER_STEP_DEG = 60;
const DEG_TO_RAD = Math.PI / 180;
const SQRT_3 = Math.sqrt(3);
const ROW_HEIGHT_FACTOR = 1.5;

const AXIAL_DIRECTIONS: readonly TAxialCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

const hexId = (q: number, r: number): string => {
  return `${q}:${r}`;
};

/** The inverse of `hexId`. Returns `null` when the text is not an id. */
const parseHexId = (id: string): TAxialCoord | null => {
  const parts = id.split(":");
  if (parts.length !== 2) {
    return null;
  }
  const q = Number(parts[0]);
  const r = Number(parts[1]);
  if (Number.isNaN(q) === true || Number.isNaN(r) === true) {
    return null;
  }
  return { q, r };
};

const hexToPixel = (q: number, r: number, size: number): { x: number; y: number } => {
  return {
    x: size * SQRT_3 * (q + r / 2),
    y: size * ROW_HEIGHT_FACTOR * r,
  };
};

const pixelToHex = (x: number, y: number, size: number): { q: number; r: number } => {
  const fractionalR = y / (size * ROW_HEIGHT_FACTOR);
  const fractionalQ = x / (size * SQRT_3) - fractionalR / 2;
  return roundAxial(fractionalQ, fractionalR);
};

/** Rounds a fractional axial coordinate in cube space, which is the only rounding that never drifts. */
const roundAxial = (fractionalQ: number, fractionalR: number): TAxialCoord => {
  const cubeX = fractionalQ;
  const cubeZ = fractionalR;
  const cubeY = -cubeX - cubeZ;
  let roundedX = Math.round(cubeX);
  let roundedY = Math.round(cubeY);
  let roundedZ = Math.round(cubeZ);
  const deltaX = Math.abs(roundedX - cubeX);
  const deltaY = Math.abs(roundedY - cubeY);
  const deltaZ = Math.abs(roundedZ - cubeZ);
  if (deltaX > deltaY && deltaX > deltaZ) {
    roundedX = -roundedY - roundedZ;
  } else if (deltaY > deltaZ) {
    roundedY = -roundedX - roundedZ;
  } else {
    roundedZ = -roundedX - roundedY;
  }
  return { q: roundedX, r: roundedZ };
};

/** Six corners of the hex centred on `(cx, cy)`, the first one at the top. */
const hexCorners = (cx: number, cy: number, size: number): readonly { x: number; y: number }[] => {
  const corners: TPixelPoint[] = [];
  for (let index = 0; index < HEX_CORNER_COUNT; index += 1) {
    const angleRad = (HEX_TOP_ANGLE_DEG + HEX_CORNER_STEP_DEG * index) * DEG_TO_RAD;
    corners.push({
      x: cx + size * Math.cos(angleRad),
      y: cy + size * Math.sin(angleRad),
    });
  }
  return corners;
};

const hexNeighbours = (q: number, r: number): readonly { q: number; r: number }[] => {
  return AXIAL_DIRECTIONS.map((direction) => {
    return { q: q + direction.q, r: r + direction.r };
  });
};

/** The number of steps between two axial coordinates. */
const hexDistance = (aq: number, ar: number, bq: number, br: number): number => {
  const dq = aq - bq;
  const dr = ar - br;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
};

export type { TAxialCoord, TPixelPoint };

export {
  HEX_SIZE_PX,
  hexCorners,
  hexDistance,
  hexId,
  hexNeighbours,
  hexToPixel,
  parseHexId,
  pixelToHex,
};
