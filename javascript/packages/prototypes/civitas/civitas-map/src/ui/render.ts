import type { BrushMask } from "../map/brush";
import { unpack } from "../map/colors";
import type { ProvinceLayer } from "../map/province-layer";
import type { View } from "../map/view";

type SceneInput = {
  ctx: CanvasRenderingContext2D;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  view: View;
  bitmap: ImageBitmap | null;
  layer: ProvinceLayer | null;
  showBaseMap: boolean;
  showLayer: boolean;
  layerOpacity: number;
};

type PreviewInput = {
  ctx: CanvasRenderingContext2D;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  view: View;
  mask: BrushMask;
  cursor: { x: number; y: number } | null;
  color: number;
  erasing: boolean;
  crosshairOnly: boolean;
};

// The canvas is backed at device resolution and driven in CSS pixels, so a 1px
// outline is one device pixel on a 2x display instead of two.
function applyScreenSpace(ctx: CanvasRenderingContext2D, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function clear(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): void {
  applyScreenSpace(ctx, dpr);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
}

function applyView(ctx: CanvasRenderingContext2D, view: View, dpr: number): void {
  const scale = view.scale * dpr;

  ctx.setTransform(scale, 0, 0, scale, view.x * dpr, view.y * dpr);
}

function drawScene(input: SceneInput): void {
  const { ctx, view, bitmap, layer } = input;

  clear(ctx, input.cssWidth, input.cssHeight, input.dpr);

  if (!bitmap || !layer) {
    return;
  }

  applyView(ctx, view, input.dpr);
  // Smoothing while shrinking, none while magnifying. Magnified province paint
  // has to show its real pixel edges — that is what the operator is aligning.
  ctx.imageSmoothingEnabled = view.scale < 1;
  ctx.imageSmoothingQuality = "high";

  if (input.showBaseMap) {
    ctx.drawImage(bitmap, 0, 0);
  }

  if (input.showLayer) {
    ctx.globalAlpha = input.layerOpacity;
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.globalAlpha = 1;
  }

  // Map bounds, drawn in screen space so the hairline stays one pixel wide at
  // every zoom level. Transform only — clearing here would wipe what was just
  // drawn.
  applyScreenSpace(ctx, input.dpr);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    view.x + 0.5,
    view.y + 0.5,
    layer.width * view.scale,
    layer.height * view.scale,
  );
}

const MIN_PREVIEW_SCREEN_SIZE = 7;

function drawPreview(input: PreviewInput): void {
  const { ctx, view, mask, cursor } = input;

  clear(ctx, input.cssWidth, input.cssHeight, input.dpr);

  if (!cursor) {
    return;
  }

  const screenX = cursor.x * view.scale + view.x;
  const screenY = cursor.y * view.scale + view.y;

  if (input.crosshairOnly) {
    drawCrosshair(ctx, screenX + view.scale / 2, screenY + view.scale / 2);

    return;
  }

  const rgb = unpack(input.color);
  const fill = input.erasing
    ? "rgba(255, 255, 255, 0.35)"
    : `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.55)`;

  // The preview is filled from the same span list the stroke uses, so the shape
  // under the cursor is exactly the pixels a click would write.
  ctx.fillStyle = fill;

  for (const span of mask.spans) {
    ctx.fillRect(
      (cursor.x + span.x0) * view.scale + view.x,
      (cursor.y + span.dy) * view.scale + view.y,
      (span.x1 - span.x0 + 1) * view.scale,
      view.scale,
    );
  }

  const footprintWidth = (mask.maxX - mask.minX + 1) * view.scale;
  const footprintHeight = (mask.maxY - mask.minY + 1) * view.scale;

  // Zoomed far out the footprint can be a fraction of a pixel. A ring at a fixed
  // screen size keeps the cursor findable without lying about the brush size.
  if (footprintWidth < MIN_PREVIEW_SCREEN_SIZE || footprintHeight < MIN_PREVIEW_SCREEN_SIZE) {
    ctx.beginPath();
    ctx.arc(screenX, screenY, MIN_PREVIEW_SCREEN_SIZE, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 1;
    ctx.stroke();

    return;
  }

  ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    Math.round((cursor.x + mask.minX) * view.scale + view.x) - 0.5,
    Math.round((cursor.y + mask.minY) * view.scale + view.y) - 0.5,
    footprintWidth + 1,
    footprintHeight + 1,
  );
}

function drawCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const arm = 9;

  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - arm, y + 0.5);
  ctx.lineTo(x + arm, y + 0.5);
  ctx.moveTo(x + 0.5, y - arm);
  ctx.lineTo(x + 0.5, y + arm);
  ctx.stroke();
}

export { drawPreview, drawScene };
