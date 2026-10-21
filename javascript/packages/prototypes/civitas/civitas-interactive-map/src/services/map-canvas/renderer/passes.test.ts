import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTRY_BORDER,
  PROVINCE_BORDER,
  type BorderPaths,
} from "./layers/border-layer";
import { buildBorderTiles } from "../../../domain/borders/borders";
import { clampView, fitView, snapView, sourceRect } from "../../../domain/view/view";
import { drawOverlay, drawScene } from "./passes";
import type { BorderTiles, Size, View } from "../../../domain/index";

// A recorder context, not a canvas. The tests cover the geometry `passes.ts` hands to the context:
// argument order, source rect, smoothing, the edge column and identical view snapping.

const MAP: Size = { width: 3653, height: 2855 };
const ART: Size = { width: 3652, height: 2855 };
const WIDE: Size = { width: 1200, height: 800 };

type Call = { name: string; source: unknown; args: number[] };

type Recorder = {
  ctx: CanvasRenderingContext2D;
  calls: Call[];
};

function createRecorder(): Recorder {
  const calls: Call[] = [];
  const ctx = {
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "low",
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "butt",
    lineJoin: "miter",
    // `measureText` scales with the px size of the live `font`, as a real context does.
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    miterLimit: 10,
    fillStyle: "",
    measureText: (text: string): TextMetrics => {
      calls.push({ name: "measureText", source: text, args: [] });
      return { width: Array.from(text).length * 50 } as TextMetrics;
    },
    fillText: (text: string, x: number, y: number): void => {
      calls.push({ name: "fillText", source: text, args: [x, y] });
    },
    strokeText: (text: string, x: number, y: number): void => {
      calls.push({ name: "strokeText", source: text, args: [x, y] });
    },
    setTransform: (...args: number[]): void => {
      calls.push({ name: "setTransform", source: null, args });
    },
    clearRect: (...args: number[]): void => {
      calls.push({ name: "clearRect", source: null, args });
    },
    drawImage: (source: unknown, ...args: number[]): void => {
      calls.push({ name: "drawImage", source, args });
    },
    strokeRect: (...args: number[]): void => {
      calls.push({ name: "strokeRect", source: null, args });
    },
    stroke: (source: unknown): void => {
      calls.push({ name: "stroke", source, args: [] });
    },
  };
  // Assigned after the literal, so the closure records the width and style live at the call.
  ctx.stroke = (source: unknown): void => {
    calls.push({ name: "stroke", source, args: [ctx.lineWidth] });
  };
  // Same reason: the width follows the px size live at the call.
  ctx.measureText = (text: string): TextMetrics => {
    const match = /(\d+(?:\.\d+)?)px/.exec(ctx.font);
    const px = match ? Number(match[1]) : 10;
    calls.push({ name: "measureText", source: text, args: [px] });
    return { width: (Array.from(text).length * 50 * px) / 100 } as TextMetrics;
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

// Fake Path2D objects: real ones need a DOM. The tests check which path is stroked and how.
function fakeBorderPaths(tiles: BorderTiles, label: string): BorderPaths {
  const paths: Path2D[] = [];
  for (let t = 0; t < tiles.cols * tiles.rows; t += 1) {
    paths.push({ label, tile: t } as unknown as Path2D);
  }
  return { tiles, paths };
}

function borderFixture(label: string): BorderPaths {
  const runs = {
    vertical: new Int32Array([100, 40, 90]),
    horizontal: new Int32Array([200, 10, 60]),
  };
  return fakeBorderPaths(buildBorderTiles(runs, MAP.width, MAP.height), label);
}

function bitmap(size: Size): ImageBitmap {
  return { width: size.width, height: size.height } as unknown as ImageBitmap;
}

function named(calls: Call[], name: string): Call[] {
  return calls.filter((call) => {
    return call.name === name;
  });
}

function near(actual: number, expected: number, message: string): void {
  assert.ok(
    Math.abs(actual - expected) <= 1e-9,
    message + ": expected " + expected + ", got " + actual,
  );
}

test("drawScene sets the device transform and clears before it draws anything", () => {
  const recorder = createRecorder();
  const view = clampView({ scale: 2, x: -1000, y: -800 }, MAP, WIDE);

  drawScene({
    ctx: recorder.ctx,
    view,
    viewport: WIDE,
    dpr: 2,
    art: bitmap(ART),
    mapSize: MAP,
  });

  assert.equal(recorder.calls[0].name, "setTransform", "the transform is set first");
  // CSS pixels at device resolution, with no transform left from a previous frame.
  assert.deepEqual(recorder.calls[0].args, [2, 0, 0, 2, 0, 0]);
  assert.equal(recorder.calls[1].name, "clearRect", "the canvas is cleared second");
  assert.deepEqual(recorder.calls[1].args, [0, 0, WIDE.width, WIDE.height]);
  assert.ok(named(recorder.calls, "drawImage").length > 0, "the art is drawn after that");
});

test("drawScene hands drawImage the source rect in the 9-argument order", () => {
  // Pins the 9-argument form and its argument order.
  const recorder = createRecorder();
  const view = clampView({ scale: 3.7, x: -1234.56, y: -987.65 }, MAP, WIDE);

  drawScene({
    ctx: recorder.ctx,
    view,
    viewport: WIDE,
    dpr: 1,
    art: bitmap(ART),
    mapSize: MAP,
  });

  const draws = named(recorder.calls, "drawImage");
  const main = draws[0];
  const expected = sourceRect(snapView(view, 1), WIDE, ART);
  assert.ok(expected, "the fixture view must produce a rect");

  assert.equal(main.args.length, 8, "the 9-argument form, i.e. source plus 8 numbers");
  assert.deepEqual(main.args, [
    expected.sx,
    expected.sy,
    expected.sw,
    expected.sh,
    expected.dx,
    expected.dy,
    expected.dw,
    expected.dh,
  ]);
});

test("drawScene reads the source rect from the ART size, never the map size", () => {
  // A source rect from the map size would ask for a missing art column.
  // Some browsers draw nothing for it, others throw.
  for (const scale of [1, 4, 8]) {
    const recorder = createRecorder();
    const view = clampView({ scale, x: -1e9, y: -1e9 }, MAP, WIDE);

    drawScene({
      ctx: recorder.ctx,
      view,
      viewport: WIDE,
      dpr: 1,
      art: bitmap(ART),
      mapSize: MAP,
    });

    for (const call of named(recorder.calls, "drawImage")) {
      const sx = call.args[0];
      const sw = call.args[2];
      const sy = call.args[1];
      const sh = call.args[3];
      assert.ok(sx >= 0, "sx must not be negative at scale " + scale + ", got " + sx);
      assert.ok(
        sx + sw <= ART.width,
        "sx+sw=" + (sx + sw) + " exceeds the art width at scale " + scale,
      );
      assert.ok(
        sy + sh <= ART.height,
        "sy+sh=" + (sy + sh) + " exceeds the art height at scale " + scale,
      );
    }
  }
});

test("the edge column fills map column 3652 exactly, from the art's last column", () => {
  const scale = 4;
  const recorder = createRecorder();
  // Panned hard right, so the map's right edge is on screen.
  const view = clampView({ scale, x: -1e9, y: -1e9 }, MAP, WIDE);

  drawScene({
    ctx: recorder.ctx,
    view,
    viewport: WIDE,
    dpr: 1,
    art: bitmap(ART),
    mapSize: MAP,
  });

  const draws = named(recorder.calls, "drawImage");
  assert.equal(draws.length, 2, "the main draw plus the edge column");

  const main = draws[0];
  const edge = draws[1];
  assert.equal(edge.args[0], ART.width - 1, "the source is the art's last column");
  assert.equal(edge.args[2], 1, "one source column wide");
  assert.equal(edge.args[1], main.args[1], "the same source rows as the main draw");
  assert.equal(edge.args[3], main.args[3], "the same source height as the main draw");

  near(edge.args[4], view.x + ART.width * scale, "the fill starts where the art ends");
  near(edge.args[6], scale, "the fill is exactly one map column wide");
  assert.equal(edge.args[5], main.args[5], "the same destination y as the main draw");
  assert.equal(edge.args[7], main.args[7], "the same destination height as the main draw");

  // No sliver: the main draw plus the fill reach the map's right edge.
  near(
    main.args[4] + main.args[6] + edge.args[6],
    view.x + MAP.width * scale,
    "the two draws together cover the whole map width in view",
  );
});

test("the edge column is skipped when the map's right edge is off screen", () => {
  const recorder = createRecorder();
  const view = clampView({ scale: 4, x: 0, y: 0 }, MAP, WIDE);

  drawScene({
    ctx: recorder.ctx,
    view,
    viewport: WIDE,
    dpr: 1,
    art: bitmap(ART),
    mapSize: MAP,
  });

  assert.equal(named(recorder.calls, "drawImage").length, 1, "one draw, no edge fill");
});

test("the edge column disappears if the art is ever re-exported at the full map width", () => {
  // A full-width art draws no extra column.
  const recorder = createRecorder();
  const view = clampView({ scale: 4, x: -1e9, y: -1e9 }, MAP, WIDE);

  drawScene({
    ctx: recorder.ctx,
    view,
    viewport: WIDE,
    dpr: 1,
    art: bitmap(MAP),
    mapSize: MAP,
  });

  assert.equal(named(recorder.calls, "drawImage").length, 1, "no gap, so no edge fill");
});

test("smoothing is decided in device pixels", () => {
  // Scale 0.5 at dpr 2 is 1:1 in device pixels, where smoothing would blur flat colours.
  const cases = [
    { scale: 0.5, dpr: 1, expected: true },
    { scale: 0.5, dpr: 2, expected: false },
    { scale: 8, dpr: 1, expected: false },
  ];

  for (const item of cases) {
    const recorder = createRecorder();
    const view = clampView({ scale: item.scale, x: -100, y: -100 }, MAP, WIDE);
    assert.equal(view.scale, item.scale, "the fixture scale must survive the clamp");

    drawScene({
      ctx: recorder.ctx,
      view,
      viewport: WIDE,
      dpr: item.dpr,
      art: bitmap(ART),
      mapSize: MAP,
    });

    assert.equal(
      recorder.ctx.imageSmoothingEnabled,
      item.expected,
      "scale " + item.scale + " at dpr " + item.dpr,
    );
  }
});

test("drawScene clears but draws nothing for a view that produces no source rect", () => {
  for (const view of [
    { scale: 0, x: 0, y: 0 },
    { scale: Number.NaN, x: 0, y: 0 },
    { scale: 1, x: 5000, y: 0 },
  ]) {
    const recorder = createRecorder();

    drawScene({
      ctx: recorder.ctx,
      view,
      viewport: WIDE,
      dpr: 1,
      art: bitmap(ART),
      mapSize: MAP,
    });

    assert.equal(named(recorder.calls, "clearRect").length, 1, "the stale frame is still cleared");
    assert.equal(named(recorder.calls, "drawImage").length, 0, "nothing is drawn");
  }
});

test("drawOverlay strokes the AUTHORITATIVE map bounds as a 1 px hairline", () => {
  const recorder = createRecorder();
  const view = fitView(MAP, WIDE);

  drawOverlay({ ctx: recorder.ctx, view, viewport: WIDE, dpr: 1, mapSize: MAP });

  assert.equal(recorder.ctx.lineWidth, 1, "one CSS pixel at every zoom");
  const stroke = named(recorder.calls, "strokeRect")[0];
  const snapped = snapView(view, 1);
  near(stroke.args[0], snapped.x + 0.5, "the half-pixel offset keeps the hairline crisp");
  near(stroke.args[1], snapped.y + 0.5, "the same on y");
  // The map width, not the art width: the hairline proves both canvases share coordinates.
  near(stroke.args[2], MAP.width * snapped.scale, "the hairline spans the map width");
  near(stroke.args[3], MAP.height * snapped.scale, "the hairline spans the map height");
});

test("the overlay and the scene snap the view identically", () => {
  // A fractional view at dpr 2 exposes any sub-pixel mismatch between the layers.
  const dpr = 2;
  const view = clampView({ scale: 2.5, x: -1234.567, y: -987.654 }, MAP, WIDE);

  const scene = createRecorder();
  drawScene({ ctx: scene.ctx, view, viewport: WIDE, dpr, art: bitmap(ART), mapSize: MAP });
  const overlay = createRecorder();
  drawOverlay({ ctx: overlay.ctx, view, viewport: WIDE, dpr, mapSize: MAP });

  const main = named(scene.calls, "drawImage")[0];
  const stroke = named(overlay.calls, "strokeRect")[0];
  const snapped = snapView(view, dpr);

  // Map pixel (sx, sy) of the scene draw, expressed on the overlay's origin.
  near(
    main.args[4],
    stroke.args[0] - 0.5 + main.args[0] * snapped.scale,
    "the scene's destination x sits on the overlay's grid",
  );
  near(
    main.args[5],
    stroke.args[1] - 0.5 + main.args[1] * snapped.scale,
    "the scene's destination y sits on the overlay's grid",
  );
  assert.notEqual(snapped.x, view.x, "the fixture really does exercise the snap");
});

test("drawOverlay with the T04 fields omitted draws exactly what T03 drew", () => {
  // Optional fields passed as null or empty change nothing.
  const view = fitView(MAP, WIDE);

  const bare = createRecorder();
  drawOverlay({ ctx: bare.ctx, view, viewport: WIDE, dpr: 1, mapSize: MAP });

  const explicit = createRecorder();
  drawOverlay({
    ctx: explicit.ctx,
    view,
    viewport: WIDE,
    dpr: 1,
    mapSize: MAP,
    provinceBorders: null,
    countryBorders: null,
    highlights: [],
    provinceIndex: null,
  });

  assert.deepEqual(explicit.calls, bare.calls);
});

test("the country tint draws FIRST, from the map size, under the snapped view", () => {
  // The tint sits under the hover and select fills, so a hover stays visible.
  // The tint source rect uses the map size. The art size would drop a column and drift at high zoom.
  const dpr = 2;
  const view = clampView({ scale: 2.5, x: -1234.567, y: -987.654 }, MAP, WIDE);
  const tint = bitmap(MAP);

  const recorder = createRecorder();
  drawOverlay({
    ctx: recorder.ctx,
    view,
    viewport: WIDE,
    dpr,
    mapSize: MAP,
    tint,
    tintSize: MAP,
    provinceBorders: borderFixture("province"),
    countryBorders: borderFixture("country"),
  });

  const draws = named(recorder.calls, "drawImage");
  assert.equal(draws.length, 1, "one drawImage — a single map-sized layer, not a stamp per province");
  assert.equal(draws[0].source, tint);

  const expected = sourceRect(snapView(view, dpr), WIDE, MAP);
  assert.ok(expected, "the fixture view must produce a rect");
  assert.deepEqual(draws[0].args, [
    expected.sx,
    expected.sy,
    expected.sw,
    expected.sh,
    expected.dx,
    expected.dy,
    expected.dw,
    expected.dh,
  ]);

  const tintAt = recorder.calls.indexOf(draws[0]);
  const firstStroke = recorder.calls.findIndex((call) => {
    return call.name === "stroke";
  });
  assert.ok(tintAt < firstStroke, "the tint goes under the borders");
});

test("omitting the tint leaves the overlay byte-identical to the T04 output", () => {
  const view = clampView({ scale: 2.5, x: -1234.567, y: -987.654 }, MAP, WIDE);

  function callsFor(extra: { tint?: ImageBitmap | null; tintSize?: Size | null }): Call[] {
    const recorder = createRecorder();
    drawOverlay({
      ctx: recorder.ctx,
      view,
      viewport: WIDE,
      dpr: 1,
      mapSize: MAP,
      provinceBorders: borderFixture("province"),
      countryBorders: borderFixture("country"),
      ...extra,
    });
    return recorder.calls;
  }

  const bare = callsFor({});
  assert.deepEqual(callsFor({ tint: null, tintSize: MAP }), bare, "a null tint draws nothing");
  assert.deepEqual(
    callsFor({ tint: bitmap(MAP), tintSize: null }),
    bare,
    "a tint with no size draws nothing",
  );
});

test("borders draw under the map transform and the hairline still comes last", () => {
  const dpr = 2;
  const view = clampView({ scale: 2.5, x: -1234.567, y: -987.654 }, MAP, WIDE);
  const snapped = snapView(view, dpr);
  const province = borderFixture("province");
  const country = borderFixture("country");

  const recorder = createRecorder();
  drawOverlay({
    ctx: recorder.ctx,
    view,
    viewport: WIDE,
    dpr,
    mapSize: MAP,
    provinceBorders: province,
    countryBorders: country,
  });

  const strokes = named(recorder.calls, "stroke");
  assert.ok(strokes.length > 0, "something must be stroked");

  const labels = strokes.map((call) => {
    return (call.source as { label: string }).label;
  });
  const firstCountry = labels.indexOf("country");
  assert.ok(firstCountry > 0, "province borders are stroked first");
  assert.ok(
    labels.slice(firstCountry).every((label) => {
      return label === "country";
    }),
    "a country line must cover the province line under it, so it goes second",
  );

  // The map-to-screen transform must use the snapped view.
  const mapTransform = recorder.calls.find((call) => {
    return call.name === "setTransform" && call.args[0] === snapped.scale * dpr;
  });
  assert.ok(mapTransform, "a map-space transform must be installed");
  assert.deepEqual(mapTransform.args, [
    snapped.scale * dpr,
    0,
    0,
    snapped.scale * dpr,
    snapped.x * dpr,
    snapped.y * dpr,
  ]);

  // The hairline draws in CSS pixels, so the map transform must be undone first.
  const last = recorder.calls[recorder.calls.length - 1];
  assert.equal(last.name, "strokeRect", "the bounds hairline is still last");
  const beforeLast = recorder.calls[recorder.calls.length - 2];
  assert.equal(beforeLast.name, "setTransform");
  assert.deepEqual(beforeLast.args, [dpr, 0, 0, dpr, 0, 0]);
  assert.equal(recorder.ctx.lineWidth, 1, "and the hairline is 1 CSS px again");
});

test("stroke width is screen space: lineWidth is the CSS width divided by the scale", () => {
  // The on-screen width stays constant at every zoom.
  for (const scale of [0.5, 1, 8]) {
    const view = clampView({ scale, x: -2000, y: -1500 }, MAP, WIDE);
    assert.equal(view.scale, scale, "the fixture scale must survive the clamp");

    const recorder = createRecorder();
    drawOverlay({
      ctx: recorder.ctx,
      view,
      viewport: WIDE,
      dpr: 1,
      mapSize: MAP,
      provinceBorders: borderFixture("province"),
      countryBorders: borderFixture("country"),
    });

    const strokes = named(recorder.calls, "stroke");
    const widths = new Set(
      strokes.map((call) => {
        return call.args[0];
      }),
    );
    assert.deepEqual(
      Array.from(widths).sort((a, b) => {
        return a - b;
      }),
      [PROVINCE_BORDER.widthCss / scale, COUNTRY_BORDER.widthCss / scale],
      "at scale " + scale,
    );
  }
});

test("highlights are skipped when no province index is supplied", () => {
  const view = fitView(MAP, WIDE);
  const recorder = createRecorder();

  drawOverlay({
    ctx: recorder.ctx,
    view,
    viewport: WIDE,
    dpr: 1,
    mapSize: MAP,
    highlights: [{ province: null as never, role: "hover" }],
    provinceIndex: null,
  });

  assert.equal(named(recorder.calls, "drawImage").length, 0, "nothing is stamped");
  assert.equal(named(recorder.calls, "strokeRect").length, 1, "the hairline still draws");
});

test("country labels draw LAST, after the bounds hairline", () => {
  // Labels draw on top of every other layer.
  const view = clampView({ scale: 2, x: -2000, y: -1500 }, MAP, WIDE);
  const recorder = createRecorder();

  drawOverlay({
    ctx: recorder.ctx,
    view,
    viewport: WIDE,
    dpr: 1,
    mapSize: MAP,
    provinceBorders: borderFixture("province"),
    countryBorders: borderFixture("country"),
    labelSources: [
      {
        countryId: 1,
        text: "AURELIA",
        anchor: { x: 1100, y: 820 },
        bounds: { x: 0, y: 0, width: 3000, height: 2000 },
        area: 500000,
      },
    ],
  });

  const hairline = recorder.calls.findIndex((call) => {
    return call.name === "strokeRect";
  });
  const firstFill = recorder.calls.findIndex((call) => {
    return call.name === "fillText";
  });
  assert.ok(hairline >= 0, "the hairline must still draw");
  assert.ok(firstFill > hairline, "the label must draw after the hairline");
  assert.equal(named(recorder.calls, "fillText").length, 7, "one call per glyph of AURELIA");
});

test("omitting labelSources leaves the overlay byte-identical to the T06 output", () => {
  const view = clampView({ scale: 2, x: -2000, y: -1500 }, MAP, WIDE);

  function callsFor(extra: Partial<Parameters<typeof drawOverlay>[0]>): Call[] {
    const recorder = createRecorder();
    drawOverlay({
      ctx: recorder.ctx,
      view,
      viewport: WIDE,
      dpr: 1,
      mapSize: MAP,
      provinceBorders: borderFixture("province"),
      countryBorders: borderFixture("country"),
      ...extra,
    });
    return recorder.calls;
  }

  const bare = callsFor({});
  assert.deepEqual(callsFor({ labelSources: null }), bare, "an explicit null draws nothing");
  assert.deepEqual(callsFor({ labelSources: [] }), bare, "an empty list draws nothing");
  assert.deepEqual(
    callsFor({ countryContains: null }),
    bare,
    "a contains callback with no sources draws nothing",
  );
  for (const name of ["fillText", "strokeText", "measureText"]) {
    assert.equal(named(bare, name).length, 0, "the T06 overlay issues no " + name);
  }
});

test("drawOverlay clears and returns for a degenerate scale", () => {
  for (const scale of [0, -1, Number.NaN]) {
    const recorder = createRecorder();
    const view: View = { scale, x: 0, y: 0 };

    drawOverlay({ ctx: recorder.ctx, view, viewport: WIDE, dpr: 1, mapSize: MAP });

    assert.equal(named(recorder.calls, "clearRect").length, 1, "still cleared at scale " + scale);
    assert.equal(named(recorder.calls, "strokeRect").length, 0, "no hairline at scale " + scale);
  }
});

test("drawOverlay turns the end probe ON for the production label path", () => {
  // `drawOverlay` is the only caller that turns the end probe on. This test pins that.
  const view = clampView({ scale: 2, x: -2000, y: -1500 }, MAP, WIDE);
  const recorder = createRecorder();
  const probes: { x: number; y: number }[] = [];

  drawOverlay({
    ctx: recorder.ctx,
    view,
    viewport: WIDE,
    dpr: 1,
    mapSize: MAP,
    labelSources: [
      {
        countryId: 1,
        text: "AURELIA",
        anchor: { x: 1100, y: 820 },
        bounds: { x: 0, y: 0, width: 3000, height: 2000 },
        area: 500000,
      },
    ],
    countryContains: (_id, x, y) => {
      probes.push({ x, y });
      return true;
    },
  });

  // Two calls, one per end of the text span, prove `probeEnds: true` reached `layoutLabels`.
  assert.equal(probes.length, 2, "the two ends of the text span, at offset 0");
  assert.equal(probes[0].y, probes[1].y, "both ends sit on the label's own line");
  assert.ok(probes[1].x > probes[0].x, "the left end is probed first, then the right");
  assert.equal(named(recorder.calls, "fillText").length, 7, "and the label still draws");
});
