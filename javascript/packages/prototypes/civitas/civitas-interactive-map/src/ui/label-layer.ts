import { labelFontSize, layoutLabels } from "../map/label-layout";
import type {
  ContainsFn,
  CountryLabelSource,
  LabelCandidate,
  LabelPlacement,
} from "../map/label-layout";
import type { Size, View } from "../map/view";

// The only file in the project that calls `measureText`. It measures, hands the
// numbers to the pure layout in `../map/label-layout`, and draws what comes
// back. No signals, no DOM beyond the 2D context it is given.

// Mirrors `--font` in `src/index.css`. Canvas cannot read a CSS custom property
// without a `getComputedStyle` call per frame, so the stack is duplicated here.
// If `--font` changes, change this line too.
const LABEL_FONT_STACK = "\"Inter\", \"Segoe UI\", system-ui, sans-serif";
const LABEL_FONT_WEIGHT = "600";
const METRIC_FONT_PX = 100;
const METRIC_CACHE_LIMIT = 256;
const LETTER_SPACING_EM = 0.18;
// Dark type on a light casing, matching T04's dark border ink.
const LABEL_FILL = "rgba(24, 20, 14, 0.92)";
const LABEL_HALO = "rgba(248, 246, 240, 0.80)";
const HALO_WIDTH_RATIO = 0.24;
const HALO_WIDTH_MIN = 2;

type LabelMetrics = {
  // One advance per CODE POINT, measured at METRIC_FONT_PX. Letter spacing is
  // NOT included.
  advances: readonly number[];
  total: number;
};

type LabelLayoutInput = {
  sources: readonly CountryLabelSource[];
  // The SNAPPED view.
  view: View;
  viewport: Size;
  contains?: ContainsFn;
};

type LabelStats = { candidates: number; placed: number; drawn: number };

const metricCache = new Map<string, LabelMetrics>();
let lastStats: LabelStats = { candidates: 0, placed: 0, drawn: 0 };

function labelFont(sizePx: number): string {
  return LABEL_FONT_WEIGHT + " " + sizePx + "px " + LABEL_FONT_STACK;
}

// Per GLYPH, not per string: the draw advances the pen glyph by glyph, so the
// measurement must too. `measureText(wholeString).width` includes kerning the
// draw never applies, and the two would disagree by a few pixels per label —
// enough to make the fit test and every collision rect wrong.
//
// Measured once at 100 px and scaled thereafter. Advance widths are linear in
// font size to within sub-pixel hinting noise, and the live size changes on
// every wheel notch.
function measureLabelMetrics(ctx: CanvasRenderingContext2D, text: string): LabelMetrics {
  const cached = metricCache.get(text);
  if (cached) {
    return cached;
  }

  // Save and restore. `drawCountryLabels` calls this AFTER it has set the draw
  // font, and a leaked 100 px font would render that label at 100 px.
  const previous = ctx.font;
  ctx.font = labelFont(METRIC_FONT_PX);

  // `Array.from`, never `split("")`. A surrogate pair split in half measures and
  // draws as two replacement glyphs.
  const glyphs = Array.from(text);
  const advances: number[] = [];
  let total = 0;
  for (const glyph of glyphs) {
    const width = ctx.measureText(glyph).width;
    const safe = Number.isFinite(width) && width >= 0 ? width : 0;
    advances.push(safe);
    total += safe;
  }
  ctx.font = previous;

  if (metricCache.size >= METRIC_CACHE_LIMIT) {
    const oldest = metricCache.keys().next();
    if (!oldest.done) {
      metricCache.delete(oldest.value);
    }
  }
  const metrics: LabelMetrics = { advances, total };
  metricCache.set(text, metrics);
  return metrics;
}

// `n - 1` tracking gaps, not `n`. There is no trailing space after the last
// glyph, and an off-by-one here inflates every collision rect by one tracking
// unit.
function labelTextWidth(metrics: LabelMetrics, fontSize: number): number {
  const gaps = Math.max(0, metrics.advances.length - 1);
  return (metrics.total * fontSize) / METRIC_FONT_PX + LETTER_SPACING_EM * fontSize * gaps;
}

// Every label takes the SAME font size. A political map uses one type size per
// rank, and a size scaled by area makes small countries illegible exactly where
// the fit test was going to hide them anyway.
//
// No layout cache: the layout is a pure function of (sources, view, viewport),
// all of which change on every pan, and the pass is tens of rect comparisons
// once the metric cache is warm.
function layoutCountryLabels(
  ctx: CanvasRenderingContext2D,
  input: LabelLayoutInput,
): LabelPlacement[] {
  const fontSize = labelFontSize(input.view.scale);
  const candidates: LabelCandidate[] = [];
  for (const source of input.sources) {
    const metrics = measureLabelMetrics(ctx, source.text);
    candidates.push({
      ...source,
      fontSize,
      textWidth: labelTextWidth(metrics, fontSize),
    });
  }

  const placements = layoutLabels({
    candidates,
    view: input.view,
    viewport: input.viewport,
    contains: input.contains,
  });

  let drawn = 0;
  for (const placement of placements) {
    if (placement.visible) {
      drawn += 1;
    }
  }
  lastStats = { candidates: candidates.length, placed: placements.length, drawn };
  return placements;
}

// Runs in the CSS-pixel transform `prepare` installed and `drawBorders`
// restored. It sets context state and does NOT restore it, which is legal only
// because labels are the last thing `drawOverlay` draws and `prepare` resets the
// transform every frame. If anything is ever appended after labels, add the
// save/restore then.
//
// The halo is a STROKE, not `shadowBlur`. `shadowBlur` is the slow path in every
// 2D canvas implementation and produces a soft glow; a political map wants a
// crisp casing.
function drawCountryLabels(
  ctx: CanvasRenderingContext2D,
  placements: readonly LabelPlacement[],
): void {
  for (const placement of placements) {
    if (!placement.visible) {
      continue;
    }
    const metrics = measureLabelMetrics(ctx, placement.text);
    const glyphs = Array.from(placement.text);
    const scale = placement.fontSize / METRIC_FONT_PX;
    const tracking = LETTER_SPACING_EM * placement.fontSize;

    ctx.font = labelFont(placement.fontSize);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = Math.max(HALO_WIDTH_MIN, placement.fontSize * HALO_WIDTH_RATIO);
    ctx.strokeStyle = LABEL_HALO;
    ctx.fillStyle = LABEL_FILL;

    // TWO PASSES. Halo for every glyph first, then fill for every glyph. A
    // per-glyph stroke-then-fill lets glyph N's halo eat the right edge of
    // glyph N-1's fill wherever the tracking is tighter than the halo width.
    let pen = placement.x;
    for (let i = 0; i < glyphs.length; i += 1) {
      ctx.strokeText(glyphs[i], pen, placement.y);
      pen += (metrics.advances[i] ?? 0) * scale + tracking;
    }
    pen = placement.x;
    for (let i = 0; i < glyphs.length; i += 1) {
      ctx.fillText(glyphs[i], pen, placement.y);
      pen += (metrics.advances[i] ?? 0) * scale + tracking;
    }
  }
}

// `src/index.css` declares no `@font-face` and no `@import`, so the stack cannot
// resolve differently mid-session and the cache needs no `document.fonts.ready`
// invalidation. This exists for tests and for a future web font.
function clearLabelMetricsCache(): void {
  metricCache.clear();
}

// A plain module variable, one frame stale by construction. It is an
// instrument, not state.
function getLastLabelStats(): LabelStats {
  return lastStats;
}

export {
  HALO_WIDTH_MIN,
  HALO_WIDTH_RATIO,
  LABEL_FILL,
  LABEL_FONT_STACK,
  LABEL_FONT_WEIGHT,
  LABEL_HALO,
  LETTER_SPACING_EM,
  METRIC_CACHE_LIMIT,
  METRIC_FONT_PX,
  clearLabelMetricsCache,
  drawCountryLabels,
  getLastLabelStats,
  labelFont,
  labelTextWidth,
  layoutCountryLabels,
  measureLabelMetrics,
  type LabelLayoutInput,
  type LabelMetrics,
  type LabelStats,
};
