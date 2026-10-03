const SQRT3 = Math.sqrt(3);

/** Circumradius of one decorative hex, in world units. */
const HEX_SIZE = 44;

/** The board is a hexagon of hexes: every axial coordinate inside this ring. */
const BOARD_RADIUS = 4;

/** Whole board bounds in world units. Corner tiles stick out by half a hex. */
const ARENA_WIDTH = SQRT3 * HEX_SIZE * (2 * BOARD_RADIUS + 1);
const ARENA_HEIGHT = HEX_SIZE * (2 + 3 * BOARD_RADIUS);

const ARENA_CENTER_X = ARENA_WIDTH / 2;
const ARENA_CENTER_Y = ARENA_HEIGHT / 2;

type TPoint = {
  x: number;
  y: number;
};

type TAxial = {
  q: number;
  r: number;
};

/** Corner `i` of a pointy-top hex sits at `60 * i - 30` degrees. */
const HEX_CORNER_ANGLES: readonly number[] = [0, 1, 2, 3, 4, 5].map((index) => (Math.PI / 180) * (60 * index - 30));

/** Centre of an axial tile in world pixels, with the board centred on the canvas. */
const axialToPixel = (q: number, r: number): TPoint => ({
  x: ARENA_CENTER_X + HEX_SIZE * SQRT3 * (q + r / 2),
  y: ARENA_CENTER_Y + HEX_SIZE * 1.5 * r,
});

/** Inverse of `axialToPixel`, kept fractional: the grid is decoration, not a lattice. */
const pixelToAxial = (x: number, y: number): TAxial => {
  const localX = x - ARENA_CENTER_X;
  const localY = y - ARENA_CENTER_Y;

  return {
    q: ((SQRT3 / 3) * localX - localY / 3) / HEX_SIZE,
    r: ((2 / 3) * localY) / HEX_SIZE,
  };
};

/** Every tile of the hexagonal board, ordered top row first. */
const boardTiles = (): TAxial[] => {
  const tiles: TAxial[] = [];

  for (let r = -BOARD_RADIUS; r <= BOARD_RADIUS; r += 1) {
    const from = Math.max(-BOARD_RADIUS, -BOARD_RADIUS - r);
    const to = Math.min(BOARD_RADIUS, BOARD_RADIUS - r);

    for (let q = from; q <= to; q += 1) {
      tiles.push({ q, r });
    }
  }

  return tiles;
};

/** Six corners of the hex drawn around `center`. */
const hexCorners = (center: TPoint): TPoint[] => {
  return HEX_CORNER_ANGLES.map((angle) => ({
    x: center.x + HEX_SIZE * Math.cos(angle),
    y: center.y + HEX_SIZE * Math.sin(angle),
  }));
};

export type { TAxial, TPoint };
export {
  ARENA_CENTER_X,
  ARENA_CENTER_Y,
  ARENA_HEIGHT,
  ARENA_WIDTH,
  BOARD_RADIUS,
  HEX_SIZE,
  SQRT3,
  axialToPixel,
  boardTiles,
  hexCorners,
  pixelToAxial,
};
