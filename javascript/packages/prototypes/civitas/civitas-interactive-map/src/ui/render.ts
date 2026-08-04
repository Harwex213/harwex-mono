import { COUNTRY_BORDER, PROVINCE_BORDER, drawBorders } from "./border-layer";
import { drawProvinceHighlight } from "./highlight-layer";
import { mapToScreen, shouldSmooth, snapView, sourceRect } from "../map/view";
import type { BorderPaths } from "./border-layer";
import type { DrawRect, Size, View } from "../map/view";
import type { HighlightRequest } from "./highlight-layer";
import type { ProvinceIndex } from "../map/province-index";

// Canvas drawing, kept out of React. Both functions take a context and plain
// values — no signals, no refs, no hooks. Both assume `MapCanvas` has already
// sized the backing store, and both start by clearing it.

type SceneInput = {
  ctx: CanvasRenderingContext2D;
  view: View;
  viewport: Size;
  dpr: number;
  art: ImageBitmap;
  mapSize: Size;
};

// Every field T04 added is OPTIONAL, and with all of them omitted `drawOverlay`
// produces byte-identical output to the T03 version.
type OverlayInput = {
  ctx: CanvasRenderingContext2D;
  view: View;
  viewport: Size;
  dpr: number;
  mapSize: Size;
  provinceBorders?: BorderPaths | null;
  countryBorders?: BorderPaths | null;
  // Drawn in array order, so the caller puts "select" last.
  highlights?: readonly HighlightRequest[];
  provinceIndex?: ProvinceIndex | null;
};

const BOUNDS_STROKE = "rgba(216, 162, 74, 0.35)";

// `setTransform` rather than `scale()`, so there is no save/restore bookkeeping
// and a leaked transform from a previous frame cannot accumulate. Everything
// after this draws in CSS pixels at the device resolution.
function prepare(ctx: CanvasRenderingContext2D, viewport: Size, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
}

// The art is 3652 wide; the authoritative map is 3653. Column 3652 has no art.
// Rather than leave a `scale`-wide background sliver at the right edge, the
// art's last column is repeated. Guarded on `gap > 0`, so a future re-export at
// the full 3653 width silently does nothing instead of drawing a stray column.
function drawEdgeColumn(
  ctx: CanvasRenderingContext2D,
  view: View,
  art: ImageBitmap,
  mapSize: Size,
  rect: DrawRect,
): void {
  const gap = mapSize.width - art.width;
  if (gap <= 0) {
    return;
  }
  if (rect.sx + rect.sw < art.width) {
    return;
  }
  ctx.drawImage(
    art,
    art.width - 1,
    rect.sy,
    1,
    rect.sh,
    view.x + art.width * view.scale,
    rect.dy,
    gap * view.scale,
    rect.dh,
  );
}

function drawScene(input: SceneInput): void {
  const { ctx, art, dpr: ratio, viewport } = input;
  prepare(ctx, viewport, ratio);

  // Both canvases snap with the same function and the same dpr, so the overlay
  // can never disagree with the scene by even a fraction of a pixel.
  const view = snapView(input.view, ratio);
  const rect = sourceRect(view, viewport, { width: art.width, height: art.height });
  if (!rect) {
    return;
  }

  ctx.imageSmoothingEnabled = shouldSmooth(view.scale, ratio);
  ctx.imageSmoothingQuality = "high";
  // The 9-argument form is mandatory. At scale 8 the source rect is roughly
  // viewport/8 source pixels instead of the whole 10.4 MP image.
  ctx.drawImage(art, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
  drawEdgeColumn(ctx, view, art, input.mapSize, rect);
}

// Draw order: highlights, province borders, country borders, then the bounds
// hairline. A country line covers the province line underneath it, which is why
// it goes second.
//
// The hairline is an instrument, not decoration — if it ever detaches from the
// art edge, the scene and overlay transforms have diverged. Keep it.
//
// Everything below draws from `snapView(input.view, ratio)`, the same value
// `drawScene` uses. The raw view would put the borders up to half a device pixel
// off the art.
function drawOverlay(input: OverlayInput): void {
  const { ctx, dpr: ratio, viewport, mapSize } = input;
  prepare(ctx, viewport, ratio);

  const view = snapView(input.view, ratio);
  if (!Number.isFinite(view.scale) || view.scale <= 0) {
    return;
  }

  const index = input.provinceIndex;
  if (index && input.highlights) {
    for (const request of input.highlights) {
      drawProvinceHighlight(ctx, index, request, view, ratio);
    }
  }

  if (input.provinceBorders) {
    drawBorders(ctx, input.provinceBorders, view, viewport, ratio, PROVINCE_BORDER);
  }
  if (input.countryBorders) {
    drawBorders(ctx, input.countryBorders, view, viewport, ratio, COUNTRY_BORDER);
  }

  const topLeft = mapToScreen(view, 0, 0);
  ctx.strokeStyle = BOUNDS_STROKE;
  ctx.lineWidth = 1;
  ctx.strokeRect(
    topLeft.x + 0.5,
    topLeft.y + 0.5,
    mapSize.width * view.scale,
    mapSize.height * view.scale,
  );
}

export { drawOverlay, drawScene, type OverlayInput, type SceneInput };
