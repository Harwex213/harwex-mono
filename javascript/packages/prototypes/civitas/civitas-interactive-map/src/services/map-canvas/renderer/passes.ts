import { drawArt } from "./layers/art-layer";
import {
  COUNTRY_BORDER,
  PROVINCE_BORDER,
  drawBorders,
  type BorderPaths,
} from "./layers/border-layer";
import { drawCountryLabels, layoutCountryLabels } from "./layers/label-layer";
import {
  drawProvinceHighlight,
  type HighlightRequest,
} from "./layers/highlight-layer";
import { drawTint } from "./layers/tint-layer";
import {
  mapToScreen,
  snapView,
  type ContainsFn,
  type CountryLabelSource,
  type ProvinceIndex,
  type Size,
  type View,
} from "../../../domain/index";

// The scene pass draws the art. The overlay pass draws every other layer.
// Both take a context and plain values, with no signals and no DOM lookups.

type SceneInput = {
  ctx: CanvasRenderingContext2D;
  view: View;
  viewport: Size;
  dpr: number;
  art: ImageBitmap;
  mapSize: Size;
};

// Optional fields, so a pass with only the base fields draws just the hairline.
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
  // One map-sized offscreen canvas, drawn with a single `drawImage`.
  tint?: CanvasImageSource | null;
  // The map size, not the 1 px narrower art size.
  tintSize?: Size | null;
  // Map pixels. The pass lays out labels itself, so no store type enters this module.
  labelSources?: readonly CountryLabelSource[] | null;
  countryContains?: ContainsFn | null;
};

const BOUNDS_STROKE = "rgba(216, 162, 74, 0.35)";

// `setTransform`, not `scale()`, so a leaked transform cannot accumulate across frames.
function prepare(ctx: CanvasRenderingContext2D, viewport: Size, dpr: number): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
}

function drawScene(input: SceneInput): void {
  const { ctx, dpr: ratio, viewport } = input;
  prepare(ctx, viewport, ratio);
  // Both canvases snap the same way, so the overlay matches the scene to the pixel.
  const view = snapView(input.view, ratio);
  drawArt(ctx, view, viewport, ratio, input.art, input.mapSize);
}

// A debug instrument: a hairline off the art edge means the two transforms diverged.
function drawBoundsHairline(ctx: CanvasRenderingContext2D, view: View, mapSize: Size): void {
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

// Labels draw in CSS pixels, the transform `drawBorders` restores.
function drawLabels(input: OverlayInput, view: View): void {
  if (!input.labelSources || input.labelSources.length === 0) {
    return;
  }
  const placements = layoutCountryLabels(input.ctx, {
    sources: input.labelSources,
    view,
    viewport: input.viewport,
    contains: input.countryContains ?? undefined,
    // Keeps a long thin country's name inside its shape.
    // Off by default, because tests pin the `contains` calls of the plain pass.
    probeEnds: true,
  });
  drawCountryLabels(input.ctx, placements);
}

// Layer order and why:
// - Tint first, so a hover reads on top of the country colour.
// - Country borders after province borders, so the country line wins.
// - Labels last, so nothing covers them.
// Every layer uses the snapped view of `drawScene`. The raw view is up to half a device pixel off.
function drawOverlay(input: OverlayInput): void {
  const { ctx, dpr: ratio, viewport, mapSize } = input;
  prepare(ctx, viewport, ratio);

  const view = snapView(input.view, ratio);
  if (!Number.isFinite(view.scale) || view.scale <= 0) {
    return;
  }

  if (input.tint && input.tintSize) {
    drawTint(ctx, input.tint, input.tintSize, view, viewport, ratio);
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

  drawBoundsHairline(ctx, view, mapSize);
  drawLabels(input, view);
}

export { drawOverlay, drawScene };
