// Pointy-top hexes in an odd-r offset layout: every odd row is shifted half a
// hex to the right, which is what gives the grid its brick-like interlock.

const SQRT3 = Math.sqrt(3);

// Circumradius: distance from the hex centre to a corner, in px.
const HEX_SIZE = 40;

// Corners are drawn on a slightly smaller hex so neighbours keep a visible gap.
const HEX_INSET = 2;

// Width of that gap, measured perpendicular to an edge — the distance from one
// hex outline to its neighbour's. The inset shortens the circumradius, and an
// edge sits `SQRT3 / 2` of that closer to the centre, from both hexes at once.
const HEX_GAP = HEX_INSET * SQRT3;

// A facing is clockwise degrees from straight up, and it points at a corner of
// the hex. Neighbours sit across the edges instead, and an edge lies halfway
// between the two corners it joins — which is why every neighbour direction is
// a facing turned by this much.
const NEIGHBOR_OFFSET = 30;

// Column and row step to the neighbour in each direction. Odd rows are shifted
// half a hex to the right, so a step that crosses a row leaves an odd row one
// column further along than it leaves an even one.
const NEIGHBOR_STEPS: Record<number, { even: [number, number]; odd: [number, number] }> = {
  30: { even: [0, -1], odd: [1, -1] },
  90: { even: [1, 0], odd: [1, 0] },
  150: { even: [0, 1], odd: [1, 1] },
  210: { even: [-1, 1], odd: [0, 1] },
  270: { even: [-1, 0], odd: [-1, 0] },
  330: { even: [-1, -1], odd: [0, -1] },
};

type HexCell = {
  key: string;
  col: number;
  row: number;
  x: number;
  y: number;
};

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type HexGrid = {
  cells: HexCell[];
  bounds: Bounds;
};

function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

function hexWidth(size: number): number {
  return SQRT3 * size;
}

function hexHeight(size: number): number {
  return 2 * size;
}

function hexCenter(col: number, row: number, size: number): { x: number; y: number } {
  const isOddRow = row % 2 === 1;
  const x = hexWidth(size) * (col + (isOddRow ? 0.5 : 0));
  const y = 1.5 * size * row;
  return { x, y };
}

// Six corners of a pointy-top hex around (0, 0), as an SVG `points` string.
function hexPoints(size: number): string {
  const corners: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = (Math.PI / 180) * (60 * index - 30);
    const x = size * Math.cos(angle);
    const y = size * Math.sin(angle);
    corners.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return corners.join(" ");
}

// A highlight fill stops this far inside the hex outline, measured perpendicular
// to an edge. The outline is a 2px stroke straddling the edge, so its inner half
// reaches one px in: a fill that ran the whole way would paint over the line, and
// one that stopped at it would leave a hairline of terrain between the two.
// Ending a quarter px past the line covers the seam, and the hover and select
// bands start half a px further in still, so neither of them is touched.
const FILL_INSET = 0.75;

// Corners for a fill that covers a hex's terrain. One px perpendicular to an
// edge is `2 / SQRT3` of circumradius, and `hexWidth(1)` is that SQRT3.
const HEX_FILL_POINTS = hexPoints(HEX_SIZE - HEX_INSET - (FILL_INSET * 2) / hexWidth(1));

// Corners for a highlight ring drawn around a hex. `width` is the stroke width
// the ring will be given, `inset` how far inside the hex outline its inner edge
// should start. An SVG stroke straddles its outline, so the corners go out by
// half a stroke less the inset, measured perpendicular to an edge — one px of
// that distance is `2 / SQRT3` of circumradius. Whatever is left over past the
// inset grows outward, into the gap between neighbours.
function hexRingPoints(width: number, inset = 0): string {
  return hexPoints(HEX_SIZE - HEX_INSET + (width - 2 * inset) / SQRT3);
}

function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

// The two directions a unit looks between. The facing itself points at a
// corner, so it has no neighbour of its own: the unit faces the seam between
// the two hexes these directions lead to.
function frontDirections(facing: number): [number, number] {
  return [
    normalizeAngle(facing - NEIGHBOR_OFFSET),
    normalizeAngle(facing + NEIGHBOR_OFFSET),
  ];
}

// The cell one step from (`col`, `row`) in `direction`. Offset coordinates
// only: whether the board actually has that cell is the grid's question, not
// this one's.
function neighborCell(col: number, row: number, direction: number): { col: number; row: number } | null {
  const step = NEIGHBOR_STEPS[normalizeAngle(direction)];
  if (step === undefined) {
    return null;
  }

  const [dcol, drow] = row % 2 === 1 ? step.odd : step.even;
  return { col: col + dcol, row: row + drow };
}

function buildGrid(cols: number, rows: number, size = HEX_SIZE): HexGrid {
  const cells: HexCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const { x, y } = hexCenter(col, row, size);
      cells.push({ key: cellKey(col, row), col, row, x, y });
    }
  }

  // The first centre sits at (0, 0), so the grid reaches half a hex up and to
  // the left of the origin. Odd rows stick out half a hex to the right, which
  // makes the box one half-hex wider than the plain column count suggests.
  const bounds: Bounds = {
    x: -hexWidth(size) / 2,
    y: -size,
    width: hexWidth(size) * (cols + (rows > 1 ? 0.5 : 0)),
    height: 1.5 * size * (rows - 1) + hexHeight(size),
  };

  return { cells, bounds };
}

export {
  HEX_FILL_POINTS,
  HEX_GAP,
  HEX_INSET,
  HEX_SIZE,
  buildGrid,
  cellKey,
  frontDirections,
  hexPoints,
  hexRingPoints,
  hexWidth,
  neighborCell,
};
export type { Bounds, HexCell, HexGrid };
