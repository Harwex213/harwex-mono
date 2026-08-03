// Pointy-top hexes in an odd-r offset layout: every odd row is shifted half a
// hex to the right, which is what gives the grid its brick-like interlock.

const SQRT3 = Math.sqrt(3);

// Circumradius: distance from the hex centre to a corner, in px.
const HEX_SIZE = 40;

// Corners are drawn on a slightly smaller hex so neighbours keep a visible gap.
const HEX_INSET = 2;

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

export { HEX_INSET, HEX_SIZE, buildGrid, cellKey, hexPoints, hexWidth };
export type { Bounds, HexCell, HexGrid };
