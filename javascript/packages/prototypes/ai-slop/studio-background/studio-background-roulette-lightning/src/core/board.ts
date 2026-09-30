// Roulette number layout: 13 columns (the tall zero, then 12 number columns of 3 tiles).
// Each tile is drawn on the GPU as its own instance; only the numerals come from a texture.

const COLUMNS = 13;
const ROW_PITCH = 1.62;
const GAP = 0.13;
const BOARD_UNITS_W = COLUMNS;
const BOARD_UNITS_H = ROW_PITCH * 3;

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

// Aspect of the TV picture. It is the TV's own, not a background's: each background fits the
// picture into its glass, and a few percent of stretch does not show.
const SCREEN_ASPECT = 1146 / 654;

// Board rectangle in screen UV (y down): x, y, width, height.
const BOARD_W = 0.93;
const BOARD_H = (BOARD_W * SCREEN_ASPECT * BOARD_UNITS_H) / BOARD_UNITS_W;
const BOARD_RECT: [number, number, number, number] = [(1 - BOARD_W) / 2, (0.94 - BOARD_H) / 2, BOARD_W, BOARD_H];

type TileColor = "black" | "red" | "green";

type Tile = {
  column: number;
  row: number;
  // Screen UV rect: x, y, width, height.
  rect: [number, number, number, number];
  glyph: number;
  color: TileColor;
  isZero: boolean;
  seed: number;
};

// Multiplier labels live in the glyph atlas right after the numerals 0..36.
const MULTIPLIERS = [50, 100, 200, 300, 500];
const MULTIPLIER_GLYPH = 37;

function toScreen(x: number, y: number, w: number, h: number): [number, number, number, number] {
  const sx = BOARD_RECT[2] / BOARD_UNITS_W;
  const sy = BOARD_RECT[3] / BOARD_UNITS_H;
  return [BOARD_RECT[0] + x * sx, BOARD_RECT[1] + y * sy, w * sx, h * sy];
}

function buildTiles(): Tile[] {
  const tiles: Tile[] = [];
  const half = GAP / 2;
  tiles.push({
    column: 0,
    row: 1,
    rect: toScreen(half, half, 1 - GAP, BOARD_UNITS_H - GAP),
    glyph: 0,
    color: "green",
    isZero: true,
    seed: Math.random(),
  });
  for (let c = 0; c < 12; c++) {
    for (let r = 0; r < 3; r++) {
      const n = c * 3 + (3 - r);
      tiles.push({
        column: c + 1,
        row: r,
        rect: toScreen(c + 1 + half, r * ROW_PITCH + half, 1 - GAP, ROW_PITCH - GAP),
        glyph: n,
        color: RED.has(n) ? "red" : "black",
        isZero: false,
        seed: Math.random(),
      });
    }
  }
  return tiles;
}

// Screen-UV x of a column centre.
function columnCenterX(column: number): number {
  return BOARD_RECT[0] + ((column + 0.5) / COLUMNS) * BOARD_RECT[2];
}

// Screen-UV y where a bolt striking a column ends.
function columnBottomY(): number {
  return BOARD_RECT[1] + BOARD_RECT[3];
}

const GLYPH_SLOT = 256;
const GLYPH_COLS = 8;
const GLYPH_ROWS = 6;

// White numerals 0..36 and the multiplier labels on a transparent atlas; the shader colours them.
function drawGlyphAtlas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = GLYPH_SLOT * GLYPH_COLS;
  canvas.height = GLYPH_SLOT * GLYPH_ROWS;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2d context unavailable");
  }
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const labels = [...Array.from({ length: 37 }, (_, n) => String(n)), ...MULTIPLIERS.map((m) => `${m}x`)];
  labels.forEach((label, slot) => {
    const isMultiplier = slot >= MULTIPLIER_GLYPH;
    const size = isMultiplier ? GLYPH_SLOT * 0.4 : GLYPH_SLOT * 0.6;
    ctx.font = `700 ${size}px "Josefin Sans", sans-serif`;
    const metrics = ctx.measureText("0");
    const capHeight = metrics.actualBoundingBoxAscent;
    const cx = (slot % GLYPH_COLS) * GLYPH_SLOT + GLYPH_SLOT / 2;
    const cy = Math.floor(slot / GLYPH_COLS) * GLYPH_SLOT + GLYPH_SLOT / 2;
    ctx.fillText(label, cx, cy + capHeight / 2, GLYPH_SLOT * 0.92);
  });
  return canvas;
}

export {
  COLUMNS,
  BOARD_RECT,
  SCREEN_ASPECT,
  GLYPH_COLS,
  GLYPH_ROWS,
  MULTIPLIERS,
  MULTIPLIER_GLYPH,
  buildTiles,
  columnCenterX,
  columnBottomY,
  drawGlyphAtlas,
};
export type { Tile, TileColor };
