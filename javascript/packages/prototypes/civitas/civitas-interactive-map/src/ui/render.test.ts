import assert from "node:assert/strict";
import test from "node:test";
import { clampView, fitView, snapView, sourceRect } from "../map/view";
import { drawOverlay, drawScene } from "./render";
import type { Size, View } from "../map/view";

// These are NOT canvas tests. There is no canvas and no DOM here: the context is
// a plain recorder object, so what is under test is the pure geometry
// `render.ts` computes before it hands anything to `drawImage` / `strokeRect` —
// argument order, the source rect, the smoothing decision, the one-column edge
// fill, and the fact that both layers snap the view identically.

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
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
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
  // dpr in the a/d slots and zero translation: drawing happens in CSS pixels at
  // the device resolution, with no leftover transform from a previous frame.
  assert.deepEqual(recorder.calls[0].args, [2, 0, 0, 2, 0, 0]);
  assert.equal(recorder.calls[1].name, "clearRect", "the canvas is cleared second");
  assert.deepEqual(recorder.calls[1].args, [0, 0, WIDE.width, WIDE.height]);
  assert.ok(named(recorder.calls, "drawImage").length > 0, "the art is drawn after that");
});

test("drawScene hands drawImage the source rect in the 9-argument order", () => {
  // The 3-argument form under a scaled transform pushes the whole 10.4 MP image
  // at the compositor every frame; a transposed argument pair draws the map
  // stretched or from the wrong place. Both are regressions this pins.
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
  // The art is 3652 wide, the authoritative map 3653. A source rect built from
  // the map size asks drawImage for column 3652, which draws nothing in some
  // browsers and throws IndexSizeError in others.
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
  // Guarded on gap > 0, so a 3653-wide art draws no stray column.
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
  // scale 0.5 on a 2x display is already 1:1 in device pixels — smoothing there
  // turns the flat province colours to mush.
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
  // 3653, not the art's 3652: this rectangle is the instrument that proves the
  // scene and overlay share a coordinate system.
  near(stroke.args[2], MAP.width * snapped.scale, "the hairline spans the map width");
  near(stroke.args[3], MAP.height * snapped.scale, "the hairline spans the map height");
});

test("the overlay and the scene snap the view identically", () => {
  // If they disagreed by a fraction of a pixel the border would slide against
  // the art during a pan. A fractional view at dpr 2 is where that shows up.
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

test("drawOverlay clears and returns for a degenerate scale", () => {
  for (const scale of [0, -1, Number.NaN]) {
    const recorder = createRecorder();
    const view: View = { scale, x: 0, y: 0 };

    drawOverlay({ ctx: recorder.ctx, view, viewport: WIDE, dpr: 1, mapSize: MAP });

    assert.equal(named(recorder.calls, "clearRect").length, 1, "still cleared at scale " + scale);
    assert.equal(named(recorder.calls, "strokeRect").length, 0, "no hairline at scale " + scale);
  }
});
