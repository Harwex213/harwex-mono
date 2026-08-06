import { visibleTiles } from "../map/borders";
import type { BorderTiles } from "../map/borders";
import type { Size, View } from "../map/view";

// STROKE WIDTH IS IN SCREEN SPACE. A province border is 1 CSS px and a country
// border 2.25 CSS px at every zoom, from the 0.317 fit scale to the 8x cap.
//
// Map-space width was rejected with numbers: the zoom range is 25x, so a
// 1-map-pixel border draws 0.32 CSS px at the fit scale — below one device pixel,
// where it breaks into a dashed line — and 8 CSS px at the cap, fatter than the
// province blocks it separates. No constant map-space width works at both ends.
//
// That decision is what forces stroked paths over a blitted mask: scaling a
// bitmap scales its features, so a mask necessarily carries map-space width. Only
// `lineWidth = widthCss / view.scale` under a map->screen transform gives a width
// independent of the transform. Measured, tiled stroking is also the fastest of
// the three candidates at every zoom above the fit scale (`.plan/T04/DESIGN.md`
// section 0), so there is no tradeoff here.

type BorderPaths = {
  tiles: BorderTiles;
  // One Path2D per tile, indexed r * cols + c. Empty tiles keep an empty path so
  // indexing stays arithmetic.
  paths: readonly Path2D[];
};

type BorderStyle = {
  widthCss: number;
  color: string;
  cap: CanvasLineCap;
};

// `cap: "round"` on country borders hides the notches where a 2.25 px line
// changes direction between two separate subpaths. At 1 px the notch is
// invisible, so province borders take "butt" and stay crisper.
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

// Runs once per scan, never per frame. Measured 5.7 ms for the real map's 180
// tiles. Do not "simplify" the tiles into one whole-map path: tiled stroking beat
// whole-map stroking 4x at the fit scale because smaller path bounding boxes
// rasterise better, and culling only works per tile.
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

// `view` MUST be the `snapView(view, dpr)` result the scene draw uses. The raw
// view puts the borders up to half a device pixel off the art.
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
  // The whole point: the transform scales the geometry, this un-scales the width.
  ctx.lineWidth = style.widthCss / view.scale;
  ctx.lineCap = style.cap;
  ctx.lineJoin = "round";
  ctx.strokeStyle = style.color;

  for (let r = range.r0; r <= range.r1; r += 1) {
    for (let c = range.c0; c <= range.c1; c += 1) {
      ctx.stroke(borders.paths[r * cols + c]);
    }
  }

  // Required. The bounds hairline that follows draws in CSS pixels.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export {
  COUNTRY_BORDER,
  PROVINCE_BORDER,
  buildBorderPaths,
  drawBorders,
  type BorderPaths,
  type BorderStyle,
};
