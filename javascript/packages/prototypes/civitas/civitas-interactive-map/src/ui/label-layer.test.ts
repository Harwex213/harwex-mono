import assert from "node:assert/strict";
import test from "node:test";
import {
  HALO_WIDTH_MIN,
  HALO_WIDTH_RATIO,
  LABEL_FILL,
  LABEL_FONT_STACK,
  LABEL_HALO,
  LETTER_SPACING_EM,
  METRIC_FONT_PX,
  clearLabelMetricsCache,
  drawCountryLabels,
  getLastLabelStats,
  labelFont,
  labelTextWidth,
  layoutCountryLabels,
  measureLabelMetrics,
} from "./label-layer";
import { labelFontSize } from "../map/label-layout";
import type { CountryLabelSource, LabelPlacement } from "../map/label-layout";
import type { Size, View } from "../map/view";

// NOT canvas tests. The context is a plain recorder, exactly as
// `render.test.ts` does it. `measureText` derives its width from the px size
// parsed out of the `font` string the context currently holds, so the 100 px
// reference measurement and the linear rescaling are genuinely under test.

const VIEWPORT: Size = { width: 1200, height: 800 };

type TextCall = { name: string; text: string; x: number; y: number };

type Recorder = {
  ctx: CanvasRenderingContext2D;
  calls: TextCall[];
  measured: string[];
  fontAt: string[];
};

// A stable per-code-point advance at 100 px, scaled linearly by the live size.
// It is deliberately NOT the same for every glyph, so a pen that advances by a
// constant would fail the pen-advance test.
function baseAdvance(glyph: string): number {
  return 40 + ((glyph.codePointAt(0) ?? 0) % 11) * 4;
}

function parseFontPx(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  return match ? Number(match[1]) : 10;
}

function createRecorder(): Recorder {
  const calls: TextCall[] = [];
  const measured: string[] = [];
  const fontAt: string[] = [];
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
      fontAt.push(ctx.font);
      const px = parseFontPx(ctx.font);
      let width = 0;
      for (const glyph of Array.from(text)) {
        width += (baseAdvance(glyph) * px) / 100;
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
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, measured, fontAt };
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

function named(calls: readonly TextCall[], name: string): TextCall[] {
  return calls.filter((call) => {
    return call.name === name;
  });
}

test("labelFont mirrors the --font stack in index.css", () => {
  assert.equal(labelFont(20), "600 20px " + LABEL_FONT_STACK);
  assert.equal(labelFont(20), "600 20px \"Inter\", \"Segoe UI\", system-ui, sans-serif");
});

test("metrics are taken at 100 px and the caller's font is RESTORED", () => {
  // `drawCountryLabels` calls this after it has set the draw font. A leaked
  // 100 px font would render that label at 100 px.
  clearLabelMetricsCache();
  const recorder = createRecorder();
  recorder.ctx.font = labelFont(14);

  const metrics = measureLabelMetrics(recorder.ctx, "AB");

  assert.equal(recorder.ctx.font, labelFont(14), "the font on entry must come back");
  for (const font of recorder.fontAt) {
    assert.equal(parseFontPx(font), METRIC_FONT_PX, "every measurement is at the reference size");
  }
  assert.deepEqual(metrics.advances, [baseAdvance("A"), baseAdvance("B")]);
  assert.equal(metrics.total, baseAdvance("A") + baseAdvance("B"));
});

test("metrics are measured once per name and cached thereafter", () => {
  clearLabelMetricsCache();
  const recorder = createRecorder();

  measureLabelMetrics(recorder.ctx, "CACHED");
  const first = recorder.measured.length;
  assert.ok(first > 0, "the first call must measure");

  const again = measureLabelMetrics(recorder.ctx, "CACHED");
  assert.equal(recorder.measured.length, first, "the second call issues no measureText");
  assert.equal(again.total, Array.from("CACHED").reduce((sum, glyph) => {
    return sum + baseAdvance(glyph);
  }, 0));
});

test("clearLabelMetricsCache forces a re-measure", () => {
  clearLabelMetricsCache();
  const recorder = createRecorder();
  measureLabelMetrics(recorder.ctx, "AGAIN");
  const first = recorder.measured.length;
  clearLabelMetricsCache();
  measureLabelMetrics(recorder.ctx, "AGAIN");
  assert.equal(recorder.measured.length, first * 2);
});

test("text is split by CODE POINT, never by UTF-16 unit", () => {
  // `split("")` would cut the surrogate pair in half and yield three advances.
  clearLabelMetricsCache();
  const recorder = createRecorder();
  const metrics = measureLabelMetrics(recorder.ctx, "\u{1D400}A");
  assert.equal(metrics.advances.length, 2, "one astral glyph plus one BMP glyph");
});

test("labelTextWidth scales linearly and adds exactly n - 1 tracking gaps", () => {
  const metrics = { advances: [10, 20, 30], total: 60 };
  // 60 * 50 / 100 = 30, plus 0.18 * 50 * 2 gaps = 18.
  assert.equal(labelTextWidth(metrics, 50), 48);
  assert.equal(LETTER_SPACING_EM, 0.18);
  // A single glyph has no tracking at all.
  assert.equal(labelTextWidth({ advances: [10], total: 10 }, 50), 5);
  // Linear in the size: double the size, double the width.
  assert.equal(labelTextWidth(metrics, 100), 96);
});

test("EVERY glyph is haloed before ANY glyph is filled", () => {
  // A per-glyph stroke-then-fill lets glyph N's halo eat the right edge of
  // glyph N-1's fill wherever the tracking is tighter than the halo width.
  clearLabelMetricsCache();
  const recorder = createRecorder();
  drawCountryLabels(recorder.ctx, [placement({ text: "ALPHA" })]);

  const lastStroke = recorder.calls.findLastIndex((call) => {
    return call.name === "strokeText";
  });
  const firstFill = recorder.calls.findIndex((call) => {
    return call.name === "fillText";
  });
  assert.ok(lastStroke >= 0 && firstFill >= 0, "both passes must run");
  assert.ok(lastStroke < firstFill, "a stroke landed after a fill");
  assert.equal(named(recorder.calls, "strokeText").length, 5);
  assert.equal(named(recorder.calls, "fillText").length, 5);
  assert.equal(recorder.ctx.strokeStyle, LABEL_HALO);
  assert.equal(recorder.ctx.fillStyle, LABEL_FILL);
  assert.equal(recorder.ctx.textAlign, "left");
  assert.equal(recorder.ctx.textBaseline, "middle");
});

test("the pen advances by the scaled advance plus one tracking unit per glyph", () => {
  clearLabelMetricsCache();
  const recorder = createRecorder();
  const item = placement({ text: "ALPHA", fontSize: 25, x: 130, y: 240 });
  drawCountryLabels(recorder.ctx, [item]);

  const glyphs = Array.from("ALPHA");
  const tracking = LETTER_SPACING_EM * item.fontSize;
  let expected = item.x;
  for (let i = 0; i < glyphs.length - 1; i += 1) {
    expected += (baseAdvance(glyphs[i]) * item.fontSize) / METRIC_FONT_PX + tracking;
  }

  const fills = named(recorder.calls, "fillText");
  const strokes = named(recorder.calls, "strokeText");
  assert.ok(Math.abs(fills[fills.length - 1].x - expected) < 1e-9, "fill pen drifted");
  assert.ok(Math.abs(strokes[strokes.length - 1].x - expected) < 1e-9, "stroke pen drifted");
  assert.equal(fills[0].x, item.x, "the first glyph sits on the placement origin");
  for (const call of recorder.calls) {
    assert.equal(call.y, item.y, "every glyph shares the placement baseline");
  }
});

test("an invisible placement draws nothing at all", () => {
  clearLabelMetricsCache();
  const recorder = createRecorder();
  drawCountryLabels(recorder.ctx, [placement({ visible: false })]);
  assert.equal(recorder.calls.length, 0);
});

test("the halo width has a floor, so small type keeps a casing", () => {
  clearLabelMetricsCache();

  const small = createRecorder();
  drawCountryLabels(small.ctx, [placement({ fontSize: 5 })]);
  assert.equal(small.ctx.lineWidth, HALO_WIDTH_MIN, "the floor is in force at 5 px");

  const large = createRecorder();
  drawCountryLabels(large.ctx, [placement({ fontSize: 30 })]);
  assert.equal(large.ctx.lineWidth, 30 * HALO_WIDTH_RATIO, "the ratio is in force at 30 px");
  assert.ok(30 * HALO_WIDTH_RATIO > HALO_WIDTH_MIN, "the fixture must exercise both sides");
});

test("layoutCountryLabels gives every label the same size, from the view scale", () => {
  clearLabelMetricsCache();
  const recorder = createRecorder();
  const sources = [
    source({ countryId: 1, text: "ALPHA", anchor: { x: 200, y: 200 }, area: 900 }),
    source({ countryId: 2, text: "BETA", anchor: { x: 900, y: 600 }, area: 400 }),
  ];

  for (const scale of [0.3, 1, 4]) {
    const placements = layoutCountryLabels(recorder.ctx, {
      sources,
      view: view(scale),
      viewport: VIEWPORT,
    });
    assert.ok(placements.length > 0, "scale " + scale + " must place something");
    for (const item of placements) {
      assert.equal(item.fontSize, labelFontSize(scale), "scale " + scale);
    }
  }
});

test("getLastLabelStats reports drawn <= placed <= candidates", () => {
  clearLabelMetricsCache();
  const recorder = createRecorder();
  const sources = [
    source({ countryId: 1, text: "ALPHA", anchor: { x: 200, y: 200 }, area: 900 }),
    // Far off screen at this scale: placed, but never drawn.
    source({ countryId: 2, text: "BETA", anchor: { x: 3400, y: 2700 }, area: 400 }),
    // Too small to fit its name: not placed at all.
    source({
      countryId: 3,
      text: "GAMMA",
      anchor: { x: 500, y: 500 },
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      area: 4,
    }),
  ];

  const placements = layoutCountryLabels(recorder.ctx, {
    sources,
    view: view(1),
    viewport: VIEWPORT,
  });
  drawCountryLabels(recorder.ctx, placements);

  const stats = getLastLabelStats();
  assert.equal(stats.candidates, 3);
  assert.equal(stats.placed, placements.length);
  assert.ok(stats.placed < stats.candidates, "the fit test must have dropped one");
  assert.ok(stats.drawn < stats.placed, "the off-screen label must not be drawn");
  assert.ok(stats.drawn >= 1);
});

test("the measured width is what the layout is given — the two cannot disagree", () => {
  // The fit test and every collision rect are built from `labelTextWidth`, so
  // it must equal the width the pen actually walks.
  clearLabelMetricsCache();
  const recorder = createRecorder();
  const item = source({ text: "ALPHA", anchor: { x: 400, y: 300 } });
  const placements = layoutCountryLabels(recorder.ctx, {
    sources: [item],
    view: view(1),
    viewport: VIEWPORT,
  });
  assert.equal(placements.length, 1);

  const metrics = measureLabelMetrics(recorder.ctx, "ALPHA");
  const width = labelTextWidth(metrics, placements[0].fontSize);
  const glyphs = Array.from("ALPHA");
  const tracking = LETTER_SPACING_EM * placements[0].fontSize;
  let walked = 0;
  for (let i = 0; i < glyphs.length; i += 1) {
    walked += (baseAdvance(glyphs[i]) * placements[0].fontSize) / METRIC_FONT_PX;
    if (i < glyphs.length - 1) {
      walked += tracking;
    }
  }
  assert.ok(Math.abs(width - walked) < 1e-9, "measured " + width + " but the pen walks " + walked);
});
