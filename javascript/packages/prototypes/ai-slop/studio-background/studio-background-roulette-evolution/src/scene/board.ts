// Roulette number layout: 13 columns (zero, then 12 number columns) of separate tiles.
// Each tile is drawn on the GPU as its own instance; only the numerals come from a texture.

import { SCREEN_PIXEL_HEIGHT, SCREEN_PIXEL_WIDTH } from "./calibration";

const COLUMNS = 13;
const ROW_PITCH = 1.3;
const GAP = 0.11;
const BOARD_UNITS_W = COLUMNS;
const BOARD_UNITS_H = ROW_PITCH * 3;

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const SCREEN_ASPECT = SCREEN_PIXEL_WIDTH / SCREEN_PIXEL_HEIGHT;

// Board rectangle in screen UV (y down): x, y, width, height.
const BOARD_W = 0.94;
const BOARD_H = (BOARD_W * SCREEN_ASPECT * BOARD_UNITS_H) / BOARD_UNITS_W;
const BOARD_RECT: [number, number, number, number] = [(1 - BOARD_W) / 2, 0.26, BOARD_W, BOARD_H];

type TileColor = "cream" | "red" | "green";

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
        color: RED.has(n) ? "red" : "cream",
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
const GLYPH_ROWS = 5;

// White numerals 0..36 on a transparent atlas; the shader colours them.
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
  ctx.font = `600 ${GLYPH_SLOT * 0.62}px Inter, sans-serif`;
  const metrics = ctx.measureText("0");
  const capHeight = metrics.actualBoundingBoxAscent;
  for (let n = 0; n <= 36; n++) {
    const cx = (n % GLYPH_COLS) * GLYPH_SLOT + GLYPH_SLOT / 2;
    const cy = Math.floor(n / GLYPH_COLS) * GLYPH_SLOT + GLYPH_SLOT / 2;
    ctx.fillText(String(n), cx, cy + capHeight / 2);
  }
  return canvas;
}

export {
  COLUMNS,
  BOARD_RECT,
  SCREEN_ASPECT,
  GLYPH_COLS,
  GLYPH_ROWS,
  buildTiles,
  columnCenterX,
  columnBottomY,
  drawGlyphAtlas,
};
export type { Tile, TileColor };
