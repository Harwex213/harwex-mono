import {
  labelFontSize,
  layoutLabels,
  type ContainsFn,
  type CountryLabelSource,
  type LabelCandidate,
  type LabelPlacement,
  type Size,
  type View,
} from "../../../../domain/index";

// Measures label text, runs the pure layout from `src/domain`, and draws the result.
// The only `measureText` caller in the project.

// A copy of `--font` in `src/index.css`. Reading the CSS variable would need `getComputedStyle` per frame.
const LABEL_FONT_STACK = "\"Inter\", \"Segoe UI\", system-ui, sans-serif";
const LABEL_FONT_WEIGHT = "600";
const METRIC_FONT_PX = 100;
const METRIC_CACHE_LIMIT = 256;
const LETTER_SPACING_EM = 0.18;
// Dark type on a light casing, to match the dark border ink.
const LABEL_FILL = "rgba(24, 20, 14, 0.92)";
const LABEL_HALO = "rgba(248, 246, 240, 0.80)";
const HALO_WIDTH_RATIO = 0.24;
const HALO_WIDTH_MIN = 2;

type LabelMetrics = {
  // One advance per code point at METRIC_FONT_PX, without letter spacing.
  advances: readonly number[];
  total: number;
};

type LabelLayoutInput = {
  sources: readonly CountryLabelSource[];
  // The snapped view.
  view: View;
  viewport: Size;
  contains?: ContainsFn;
  probeEnds?: boolean;
};

type LabelStats = { candidates: number; placed: number; drawn: number };

const metricCache = new Map<string, LabelMetrics>();
let lastStats: LabelStats = { candidates: 0, placed: 0, drawn: 0 };

function labelFont(sizePx: number): string {
  return LABEL_FONT_WEIGHT + " " + sizePx + "px " + LABEL_FONT_STACK;
}

// Decisions:
// - Measure per glyph, because the draw places glyph by glyph. A whole-string width includes kerning the draw skips.
// - Measure once at 100 px and scale, because the size changes on every wheel notch.
function measureLabelMetrics(ctx: CanvasRenderingContext2D, text: string): LabelMetrics {
  const cached = metricCache.get(text);
  if (cached) {
    return cached;
  }

  // Restore the font: `drawCountryLabels` calls this after it sets the draw font.
  const previous = ctx.font;
  ctx.font = labelFont(METRIC_FONT_PX);

  // `Array.from` keeps surrogate pairs whole. `split("")` would break them.
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

// `n - 1` tracking gaps: no gap follows the last glyph.
function labelTextWidth(metrics: LabelMetrics, fontSize: number): number {
  const gaps = Math.max(0, metrics.advances.length - 1);
  return (metrics.total * fontSize) / METRIC_FONT_PX + LETTER_SPACING_EM * fontSize * gaps;
}

// Decisions:
// - One font size for every label, like a political map. Area-scaled sizes make small countries unreadable.
// - No layout cache: every pan changes the inputs, and the layout is cheap.
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
    probeEnds: input.probeEnds,
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

// Decisions:
// - No save/restore: labels draw last, and `prepare` resets the context each frame.
//   Add save/restore if a layer ever draws after labels.
// - The halo is a stroke, not `shadowBlur`. A stroke is fast and gives a crisp casing.
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

    // Two passes: all halos, then all fills. Otherwise a halo covers the edge of the previous glyph.
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

// For tests and a future web font. The app loads no web font, so the cache never goes stale.
function clearLabelMetricsCache(): void {
  metricCache.clear();
}

// A debug instrument, one frame stale. Not app state.
function getLastLabelStats(): LabelStats {
  return lastStats;
}

export {
  HALO_WIDTH_MIN,
  HALO_WIDTH_RATIO,
  LABEL_FILL,
  LABEL_FONT_STACK,
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
};
