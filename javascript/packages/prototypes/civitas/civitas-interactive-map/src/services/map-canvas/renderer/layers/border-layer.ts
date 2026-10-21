import {
  visibleTiles,
  type BorderTiles,
  type Size,
  type View,
} from "../../../../domain/index";

// Decisions:
// - Stroke width is fixed in screen pixels at every zoom.
//   The zoom range is 25x, so any map-space width is sub-pixel at fit or too fat at the cap.
// - Borders are stroked paths, not a bitmap mask. A scaled mask scales its line width.
// - Paths are tiled. Tiled stroking measured fastest and allows culling per tile.

type BorderPaths = {
  tiles: BorderTiles;
  // Indexed r * cols + c. An empty tile keeps an empty path, so the index stays arithmetic.
  paths: readonly Path2D[];
};

type BorderStyle = {
  widthCss: number;
  color: string;
  cap: CanvasLineCap;
};

// A round cap hides the notches of a thick country line at a turn.
// A 1 px province line shows no notch, so "butt" keeps the line crisper.
const PROVINCE_BORDER: BorderStyle = {
  widthCss: 1,
  color: "rgba(20, 16, 12, 0.38)",
  cap: "butt",
};

const COUNTRY_BORDER: BorderStyle = {
  widthCss: 2.25,
  color: "rgba(12, 9, 6, 0.85)",
  cap: "round",
};

// Runs once per scan, not per frame.
// Keep the tiles: one whole-map path strokes 4x slower and cannot be culled.
function buildBorderPaths(tiles: BorderTiles): BorderPaths {
  const count = tiles.cols * tiles.rows;
  const paths: Path2D[] = [];
  for (let t = 0; t < count; t += 1) {
    const path = new Path2D();
    const start = tiles.offsets[t];
    const end = tiles.offsets[t + 1];
    for (let at = start; at < end; at += 4) {
      path.moveTo(tiles.data[at], tiles.data[at + 1]);
      path.lineTo(tiles.data[at + 2], tiles.data[at + 3]);
    }
    paths.push(path);
  }
  return { tiles, paths };
}

// Keyed by tile identity, so paths are built once per worker answer and reused by every frame.
const pathCache = new WeakMap<BorderTiles, BorderPaths>();

function borderPathsFor(tiles: BorderTiles | null): BorderPaths | null {
  if (tiles === null) {
    return null;
  }
  const cached = pathCache.get(tiles);
  if (cached) {
    return cached;
  }
  const built = buildBorderPaths(tiles);
  pathCache.set(tiles, built);
  return built;
}

// `view` must be the snapped view of the scene draw, or the borders sit off the art.
function drawBorders(
  ctx: CanvasRenderingContext2D,
  borders: BorderPaths,
  view: View,
  viewport: Size,
  dpr: number,
  style: BorderStyle,
): void {
  const range = visibleTiles(view, viewport, borders.tiles);
  if (!range) {
    return;
  }

  const cols = borders.tiles.cols;
  ctx.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, view.x * dpr, view.y * dpr);
  // The transform scales the geometry. This line removes the scale from the width.
  ctx.lineWidth = style.widthCss / view.scale;
  ctx.lineCap = style.cap;
  ctx.lineJoin = "round";
  ctx.strokeStyle = style.color;

  for (let r = range.r0; r <= range.r1; r += 1) {
    for (let c = range.c0; c <= range.c1; c += 1) {
      ctx.stroke(borders.paths[r * cols + c]);
    }
  }

  // The hairline and labels that follow draw in CSS pixels.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export {
  COUNTRY_BORDER,
  PROVINCE_BORDER,
  borderPathsFor,
  drawBorders,
  type BorderPaths,
};
