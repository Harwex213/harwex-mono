import {
  shouldSmooth,
  sourceRect,
  type DrawRect,
  type Size,
  type View,
} from "../../../../domain/index";

// The artistic map `map.png`, the only layer of the scene canvas.

// The art is 1 px narrower than the map. The last art column is repeated, so no
// background sliver shows at the right edge. A full-width art skips the repeat.
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

// `view` must already be snapped to the device pixel grid.
function drawArt(
  ctx: CanvasRenderingContext2D,
  view: View,
  viewport: Size,
  dpr: number,
  art: ImageBitmap,
  mapSize: Size,
): void {
  const rect = sourceRect(view, viewport, { width: art.width, height: art.height });
  if (!rect) {
    return;
  }

  ctx.imageSmoothingEnabled = shouldSmooth(view.scale, dpr);
  ctx.imageSmoothingQuality = "high";
  // The 9-argument form copies only the visible source rect, not the whole 10 MP image.
  ctx.drawImage(art, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
  drawEdgeColumn(ctx, view, art, mapSize, rect);
}

export { drawArt };
