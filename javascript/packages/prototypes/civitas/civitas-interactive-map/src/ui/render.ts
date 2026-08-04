import { mapToScreen, shouldSmooth, snapView, sourceRect } from "../map/view";
import type { DrawRect, Size, View } from "../map/view";

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

type OverlayInput = {
  ctx: CanvasRenderingContext2D;
  view: View;
  viewport: Size;
  dpr: number;
  mapSize: Size;
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

// T03 draws exactly one thing here: a 1 CSS px hairline around the
// authoritative map bounds, in screen space, so it stays one pixel wide at
// every zoom. It is an instrument, not decoration — if it ever detaches from
// the art edge, the scene and overlay transforms have diverged.
// T04 appends border drawing to this function and keeps the hairline.
function drawOverlay(input: OverlayInput): void {
  const { ctx, dpr: ratio, viewport, mapSize } = input;
  prepare(ctx, viewport, ratio);

  const view = snapView(input.view, ratio);
  if (!Number.isFinite(view.scale) || view.scale <= 0) {
    return;
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
