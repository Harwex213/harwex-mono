import assert from "node:assert/strict";
import test from "node:test";
import {
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
} from "./label-layer";
import { NAME_MAX } from "../state/schema";
import type { CountryLabelSource, LabelPlacement } from "../map/label-layout";
import type { Size, View } from "../map/view";

// T07 regression tests for the metric bookkeeping. `label-layer.test.ts` covers
// the measure-scale-draw path; this file covers the cache lifetime, the
// degenerate strings, and the style state the draw leaves behind. Recorder
// context only — no DOM, no real canvas.

const VIEWPORT: Size = { width: 1200, height: 800 };

type TextCall = { name: string; text: string; x: number; y: number };

type Recorder = {
  ctx: CanvasRenderingContext2D;
  calls: TextCall[];
  measured: string[];
  state: {
    font: string;
    textAlign: string;
    textBaseline: string;
    lineJoin: string;
    miterLimit: number;
    lineWidth: number;
    strokeStyle: string;
    fillStyle: string;
  };
};

function baseAdvance(glyph: string): number {
  return 40 + ((glyph.codePointAt(0) ?? 0) % 11) * 4;
}

function parseFontPx(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  return match ? Number(match[1]) : 10;
}

function createRecorder(widthOf?: (glyph: string, px: number) => number): Recorder {
  const calls: TextCall[] = [];
  const measured: string[] = [];
  const ctx = {
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    lineJoin: "miter",
    miterLimit: 10,
    lineWidth: 1,
    strokeStyle: "",
    fillStyle: "",
    measureText: (text: string): TextMetrics => {
      measured.push(text);
      const px = parseFontPx(ctx.font);
      let width = 0;
      for (const glyph of Array.from(text)) {
        width += widthOf ? widthOf(glyph, px) : (baseAdvance(glyph) * px) / 100;
      }
      return { width } as TextMetrics;
    },
    fillText: (text: string, x: number, y: number): void => {
      calls.push({ name: "fillText", text, x, y });
    },
    strokeText: (text: string, x: number, y: number): void => {
      calls.push({ name: "strokeText", text, x, y });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, measured, state: ctx };
}

function source(patch: Partial<CountryLabelSource>): CountryLabelSource {
  return {
    countryId: 1,
    text: "ALPHA",
    anchor: { x: 400, y: 300 },
    bounds: { x: 0, y: 0, width: 4000, height: 4000 },
    area: 1000,
    ...patch,
  };
}

function placement(patch: Partial<LabelPlacement>): LabelPlacement {
  const fontSize = patch.fontSize ?? 20;
  return {
    countryId: 1,
    text: "ALPHA",
    x: 100,
    y: 200,
    fontSize,
    rect: { x: 94, y: 200 - fontSize / 2 - 3, width: 200, height: fontSize + 6 },
    offsetIndex: 0,
    visible: true,
    ...patch,
  };
}

function view(scale: number): View {
  return { scale, x: 0, y: 0 };
}

// --- the cache ------------------------------------------------------------

test("the metric cache evicts the OLDEST entry once it is full", () => {
  clearLabelMetricsCache();
  const recorder = createRecorder();

  for (let i = 0; i < METRIC_CACHE_LIMIT; i += 1) {
    measureLabelMetrics(recorder.ctx, "NAME" + i);
  }
  const filled = recorder.measured.length;
  assert.ok(filled > 0);

  // Every one of them is still cached.
  measureLabelMetrics(recorder.ctx, "NAME0");
  measureLabelMetrics(recorder.ctx, "NAME" + (METRIC_CACHE_LIMIT - 1));
  assert.equal(recorder.measured.length, filled, "a full cache must still be a cache");

  // One more distinct name pushes the cache over the limit.
  measureLabelMetrics(recorder.ctx, "OVERFLOW");
  const afterOverflow = recorder.measured.length;
  assert.ok(afterOverflow > filled, "the new name was measured");

  measureLabelMetrics(recorder.ctx, "NAME" + (METRIC_CACHE_LIMIT - 1));
  assert.equal(recorder.measured.length, afterOverflow, "the newest entries survive");

  measureLabelMetrics(recorder.ctx, "NAME0");
  assert.ok(recorder.measured.length > afterOverflow, "the oldest entry was the one evicted");
});

test("the layout and the draw share one cache — a name is measured once per frame", () => {
  clearLabelMetricsCache();
  const recorder = createRecorder();
  const placements = layoutCountryLabels(recorder.ctx, {
    sources: [source({})],
    view: view(1),
    viewport: VIEWPORT,
  });
  assert.equal(placements.length, 1);
  const afterLayout = recorder.measured.length;
  assert.ok(afterLayout > 0, "the layout must measure");

  drawCountryLabels(recorder.ctx, placements);
  assert.equal(recorder.measured.length, afterLayout, "the draw must reuse the layout's metrics");
});

// --- degenerate strings ----------------------------------------------------

test("an empty name measures nothing and is zero wide", () => {
  clearLabelMetricsCache();
  const recorder = createRecorder();
  const metrics = measureLabelMetrics(recorder.ctx, "");

  assert.deepEqual(metrics.advances, []);
  assert.equal(metrics.total, 0);
  // `Math.max(0, n - 1)` — a bare `n - 1` here would return a NEGATIVE width.
  assert.equal(labelTextWidth(metrics, 20), 0);
});

test("a one-glyph name carries no tracking at all", () => {
  clearLabelMetricsCache();
  const recorder = createRecorder();
  const metrics = measureLabelMetrics(recorder.ctx, "X");

  assert.equal(metrics.advances.length, 1);
  assert.equal(labelTextWidth(metrics, 50), (metrics.total * 50) / METRIC_FONT_PX);
});

test("a broken measureText cannot put NaN into a collision rect", () => {
  clearLabelMetricsCache();
  const recorder = createRecorder(() => {
    return Number.NaN;
  });
  const metrics = measureLabelMetrics(recorder.ctx, "ABC");

  assert.deepEqual(metrics.advances, [0, 0, 0]);
  assert.equal(metrics.total, 0);
  const width = labelTextWidth(metrics, 20);
  assert.ok(Number.isFinite(width), "width is " + width);
  assert.equal(width, LETTER_SPACING_EM * 20 * 2);

  clearLabelMetricsCache();
  const negative = createRecorder(() => {
    return -5;
  });
  assert.deepEqual(measureLabelMetrics(negative.ctx, "AB").advances, [0, 0]);
});

test("a name at the schema's NAME_MAX is measured whole, with n - 1 gaps", () => {
  // DESIGN section 10: a maximum-length name is measured normally and hidden by
  // the fit test. It is never truncated, ellipsised or wrapped.
  clearLabelMetricsCache();
  const recorder = createRecorder();
  const text = "A".repeat(NAME_MAX);
  const metrics = measureLabelMetrics(recorder.ctx, text);

  assert.equal(NAME_MAX, 120);
  assert.equal(metrics.advances.length, NAME_MAX);
  assert.equal(
    labelTextWidth(metrics, 20),
    (metrics.total * 20) / METRIC_FONT_PX + LETTER_SPACING_EM * 20 * (NAME_MAX - 1),
  );
});

// --- the font string and the draw state ------------------------------------

test("labelFont keeps a fractional size intact", () => {
  assert.equal(labelFont(20.5), "600 20.5px " + LABEL_FONT_STACK);
  assert.equal(labelFont(9), "600 9px " + LABEL_FONT_STACK);
});

test("the draw leaves the exact type state the design specifies", () => {
  clearLabelMetricsCache();
  const recorder = createRecorder();
  drawCountryLabels(recorder.ctx, [placement({ fontSize: 24 })]);

  assert.equal(recorder.state.font, labelFont(24), "the 100 px metric font must not leak");
  assert.equal(recorder.state.textAlign, "left");
  assert.equal(recorder.state.textBaseline, "middle");
  assert.equal(recorder.state.lineJoin, "round");
  assert.equal(recorder.state.miterLimit, 2);
  assert.equal(recorder.state.strokeStyle, LABEL_HALO);
  assert.equal(recorder.state.fillStyle, LABEL_FILL);
});

// --- the stats instrument --------------------------------------------------

test("an empty source list resets the stats instead of leaving them stale", () => {
  clearLabelMetricsCache();
  const recorder = createRecorder();
  layoutCountryLabels(recorder.ctx, {
    sources: [source({})],
    view: view(1),
    viewport: VIEWPORT,
  });
  assert.ok(getLastLabelStats().candidates > 0);

  const empty = layoutCountryLabels(recorder.ctx, {
    sources: [],
    view: view(1),
    viewport: VIEWPORT,
  });
  assert.deepEqual(empty, []);
  assert.deepEqual(getLastLabelStats(), { candidates: 0, placed: 0, drawn: 0 });
});

test("layoutCountryLabels forwards contains to the collision pass", () => {
  clearLabelMetricsCache();
  const recorder = createRecorder();
  const anchor = { x: 500, y: 400 };
  const sources = [
    source({ countryId: 1, area: 900, anchor }),
    source({ countryId: 2, area: 100, anchor }),
  ];

  const open = layoutCountryLabels(recorder.ctx, {
    sources,
    view: view(1),
    viewport: VIEWPORT,
    contains: () => {
      return true;
    },
  });
  assert.equal(open.length, 2, "with room to move, both labels are placed");

  const asked: number[] = [];
  const closed = layoutCountryLabels(recorder.ctx, {
    sources,
    view: view(1),
    viewport: VIEWPORT,
    contains: (countryId) => {
      asked.push(countryId);
      return false;
    },
  });
  assert.equal(closed.length, 1, "with nowhere in-country to move, the smaller is dropped");
  assert.equal(closed[0].countryId, 1);
  assert.deepEqual(new Set(asked), new Set([2]), "only the nudged country is ever asked about");
});
