// Pointy-top hex layout math, after https://www.redblobgames.com/grids/hexagons.
// Grids are stored as odd-r offset coordinates (cells[row][col], odd rows shift
// right by half a hex); rendering and hit-testing convert through axial (q, r).
// `size` is the circumradius: center to a top/bottom vertex.

const SQRT3 = Math.sqrt(3);

// (row & 1) keeps the odd-r shift correct for negative rows too
const offsetToAxial = (col, row) => ({ q: col - (row - (row & 1)) / 2, r: row });

const axialToOffset = (q, r) => ({ col: q + (r - (r & 1)) / 2, row: r });

const axialToPixel = (q, r, size) => ({
  x: size * SQRT3 * (q + r / 2),
  y: size * (3 / 2) * r,
});

// fractional axial — pass through axialRound before indexing a grid
const pixelToAxial = (x, y, size) => ({
  q: ((SQRT3 / 3) * x - y / 3) / size,
  r: ((2 / 3) * y) / size,
});

// cube rounding: round all three cube components (s = -q - r), then recompute
// the one that drifted furthest so q + r + s = 0 holds again
const axialRound = (q, r) => {
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
};

const offsetToPixel = (col, row, size) => {
  const { q, r } = offsetToAxial(col, row);
  return axialToPixel(q, r, size);
};

const pixelToOffset = (x, y, size) => {
  const frac = pixelToAxial(x, y, size);
  const { q, r } = axialRound(frac.q, frac.r);
  return axialToOffset(q, r);
};

// world-space bounding box (hex edges included) of a cols×rows odd-r grid
// whose (0, 0) hex is centered on the origin
const gridPixelBounds = (cols, rows, size) => {
  const hexWidth = SQRT3 * size;
  const oddRowShift = rows > 1 ? hexWidth / 2 : 0;
  return {
    minX: -hexWidth / 2,
    minY: -size,
    maxX: (cols - 1) * hexWidth + oddRowShift + hexWidth / 2,
    maxY: ((rows - 1) * size * 3) / 2 + size,
  };
};

export {
  offsetToAxial,
  axialToOffset,
  axialToPixel,
  pixelToAxial,
  axialRound,
  offsetToPixel,
  pixelToOffset,
  gridPixelBounds,
};
