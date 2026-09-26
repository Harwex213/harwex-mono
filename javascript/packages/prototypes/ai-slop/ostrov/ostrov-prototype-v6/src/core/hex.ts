/**
 * Pointy-top hexes in axial coordinates (`q` to the right, `r` down-right).
 * The island canvas draws in this space and pans and zooms the whole layer, so
 * nothing here knows about the viewport.
 */

/** Radius of one hex in canvas units, before zoom. */
const HEX_SIZE = 52;
const HEX_CORNER_COUNT = 6;
const HEX_CORNER_ANGLE_DEG = 60;
/** Pointy-top means the first corner sits at -30°, not at 0°. */
const HEX_CORNER_OFFSET_DEG = -30;
const SQRT_3 = Math.sqrt(3);

type TAxial = {
  readonly q: number;
  readonly r: number;
};

type TPoint = {
  readonly x: number;
  readonly y: number;
};

const AXIAL_DIRECTIONS: readonly TAxial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

const hexId = (q: number, r: number) => `${q},${r}`;

const hexToPixel = (q: number, r: number, size: number): TPoint => ({
  x: size * SQRT_3 * (q + r / 2),
  y: size * 1.5 * r,
});

/** The polygon of one hex centred on the origin, ready for an SVG `points`. */
const hexCornerPoints = (size: number) => {
  const corners: string[] = [];

  for (let index = 0; index < HEX_CORNER_COUNT; index += 1) {
    const angleRad = ((HEX_CORNER_ANGLE_DEG * index + HEX_CORNER_OFFSET_DEG) * Math.PI) / 180;
    corners.push(`${(size * Math.cos(angleRad)).toFixed(3)},${(size * Math.sin(angleRad)).toFixed(3)}`);
  }

  return corners.join(" ");
};

const hexNeighbors = (q: number, r: number): readonly TAxial[] => {
  return AXIAL_DIRECTIONS.map((direction) => ({ q: q + direction.q, r: r + direction.r }));
};

const hexDistance = (a: TAxial, b: TAxial) => {
  const dq = a.q - b.q;
  const dr = a.r - b.r;

  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
};

/** Every axial coordinate within `radius` of the origin, centre first. */
const hexArea = (radius: number): readonly TAxial[] => {
  const area: TAxial[] = [];

  for (let q = -radius; q <= radius; q += 1) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);

    for (let r = rMin; r <= rMax; r += 1) {
      area.push({ q, r });
    }
  }

  return area.sort((a, b) => hexDistance(a, { q: 0, r: 0 }) - hexDistance(b, { q: 0, r: 0 }));
};

/**
 * The shared edge between a hex and its neighbour in `direction`, as the two
 * points of a line. The island outline is made of the edges whose neighbour is
 * missing, so it works whatever the hex orientation is.
 */
const hexEdge = (q: number, r: number, direction: number, size: number) => {
  const step = AXIAL_DIRECTIONS[direction % AXIAL_DIRECTIONS.length];
  if (!step) {
    throw new Error(`Unknown hex direction: ${direction}`);
  }

  const center = hexToPixel(q, r, size);
  const neighbor = hexToPixel(q + step.q, r + step.r, size);
  const length = Math.hypot(neighbor.x - center.x, neighbor.y - center.y);
  const unitX = (neighbor.x - center.x) / length;
  const unitY = (neighbor.y - center.y) / length;
  const midX = center.x + (unitX * length) / 2;
  const midY = center.y + (unitY * length) / 2;
  const halfEdge = size / 2;

  return {
    x1: midX - -unitY * halfEdge,
    y1: midY - unitX * halfEdge,
    x2: midX + -unitY * halfEdge,
    y2: midY + unitX * halfEdge,
  };
};

/** The bounding box of a set of hex centres, grown by one hex in every direction. */
const hexBounds = (cells: readonly TAxial[], size: number) => {
  const centers = cells.map((cell) => hexToPixel(cell.q, cell.r, size));
  const xs = centers.map((center) => center.x);
  const ys = centers.map((center) => center.y);
  const halfWidth = (size * SQRT_3) / 2;

  return {
    minX: Math.min(...xs) - halfWidth,
    maxX: Math.max(...xs) + halfWidth,
    minY: Math.min(...ys) - size,
    maxY: Math.max(...ys) + size,
  };
};

export type { TAxial, TPoint };
export {
  AXIAL_DIRECTIONS,
  HEX_SIZE,
  hexArea,
  hexBounds,
  hexCornerPoints,
  hexDistance,
  hexEdge,
  hexId,
  hexNeighbors,
  hexToPixel,
};
