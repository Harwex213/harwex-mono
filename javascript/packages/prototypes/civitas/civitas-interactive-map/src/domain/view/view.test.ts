import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  clampTranslate,
  clampView,
  fitScale,
  fittedScale,
  fitView,
  isFittedScale,
  mapToScreen,
  resizeView,
  screenToMap,
  shouldSmooth,
  snapView,
  sourceRect,
  translateTo,
  zoomAt,
  type Size,
  type View,
} from "./view";

// The art bitmap is one column narrower than the map.
const MAP: Size = { width: 3653, height: 2855 };
const ART: Size = { width: 3652, height: 2855 };
const WIDE: Size = { width: 1200, height: 800 };
const SQUARE: Size = { width: 900, height: 900 };

const EPSILON = 1e-9;

function near(actual: number, expected: number, message: string, epsilon = EPSILON): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    message + ": expected " + expected + ", got " + actual + " (delta " +
      Math.abs(actual - expected) + ")",
  );
}

test("screenToMap and mapToScreen round-trip at every scale", () => {
  for (const scale of [0.1, 1, 8]) {
    const view: View = { scale, x: -137.25, y: 42.5 };
    for (const point of [
      { x: 0, y: 0 },
      { x: 640, y: 360 },
      { x: 1199.5, y: 799.5 },
    ]) {
      const asMap = screenToMap(view, point.x, point.y);
      const back = mapToScreen(view, asMap.x, asMap.y);
      near(back.x, point.x, "x round-trip at scale " + scale, 1e-6);
      near(back.y, point.y, "y round-trip at scale " + scale, 1e-6);
    }
  }
});

test("fitScale is the smaller of the two axis ratios", () => {
  // WIDE fits on height, SQUARE fits on width: both branches of the `min`.
  near(fitScale(MAP, WIDE), Math.min(1200 / 3653, 800 / 2855), "wide viewport");
  near(fitScale(MAP, WIDE), 800 / 2855, "wide viewport fits on height");
  near(fitScale(MAP, SQUARE), Math.min(900 / 3653, 900 / 2855), "square viewport");
  near(fitScale(MAP, SQUARE), 900 / 3653, "square viewport fits on width");
});

test("fitView centres the map and leaves no slack on the fitting axis", () => {
  const view = fitView(MAP, WIDE);
  near(view.scale, fitScale(MAP, WIDE), "fit view uses the fit scale");

  const centre = mapToScreen(view, MAP.width / 2, MAP.height / 2);
  near(centre.x, WIDE.width / 2, "map centre sits at the viewport centre on x", 1e-6);
  near(centre.y, WIDE.height / 2, "map centre sits at the viewport centre on y", 1e-6);

  // Height is the fitting axis for this viewport: zero slack on y, positive on x.
  near(view.y, 0, "no slack on the fitting axis", 1e-6);
  assert.ok(view.x > 0, "the non-fitting axis is letterboxed, got x=" + view.x);
  near(MAP.height * view.scale, WIDE.height, "the map exactly spans the viewport height", 1e-6);

  // The mirror case: a transposed `fitScale` cannot pass both.
  const squareView = fitView(MAP, SQUARE);
  near(squareView.x, 0, "no slack on the fitting axis of the square viewport", 1e-6);
  assert.ok(squareView.y > 0, "the square viewport letterboxes on y, got " + squareView.y);
});

test("clampScale floors at the fit scale and caps at MAX_SCALE", () => {
  assert.equal(MAX_SCALE, 8);
  const fit = fitScale(MAP, WIDE);

  near(clampScale(fit / 100, MAP, WIDE), fit, "below the fit scale is pulled up");
  near(clampScale(fit, MAP, WIDE), fit, "the fit scale itself survives");
  assert.equal(clampScale(1000, MAP, WIDE), 8, "above the cap is pulled down");
  assert.equal(clampScale(8, MAP, WIDE), 8, "the cap itself survives");
  near(clampScale(2.5, MAP, WIDE), 2.5, "a mid-range scale is untouched");
});

test("clampScale never inverts its range, even for a viewport 20x the map", () => {
  const huge: Size = { width: 20 * MAP.width, height: 20 * MAP.height };
  assert.equal(clampScale(1, MAP, huge), 8);
  assert.equal(clampScale(100, MAP, huge), 8);
  assert.equal(clampScale(0.001, MAP, huge), 8);
});

test("clampScale turns a non-finite scale into the fit scale, never NaN", () => {
  const fit = fitScale(MAP, WIDE);
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const out = clampScale(bad, MAP, WIDE);
    assert.ok(Number.isFinite(out), "clampScale(" + bad + ") must be finite, got " + out);
    near(out, fit, "clampScale(" + bad + ") falls back to the fit scale");
  }
});

test("clampTranslate holds the edges when the scaled map exceeds the viewport", () => {
  const scale = 1;
  const view: View = { scale, x: 0, y: 0 };
  const far = WIDE.width - MAP.width * scale;

  assert.equal(clampTranslate(view, MAP, WIDE).x, 0, "x=0 is the far-left limit");
  assert.equal(
    clampTranslate({ scale, x: 5000, y: 0 }, MAP, WIDE).x,
    0,
    "a positive x is pulled back to 0",
  );
  near(
    clampTranslate({ scale, x: far, y: 0 }, MAP, WIDE).x,
    far,
    "the far-right limit survives",
  );
  near(
    clampTranslate({ scale, x: far - 5000, y: 0 }, MAP, WIDE).x,
    far,
    "past the far-right limit is pulled back",
  );

  const farY = WIDE.height - MAP.height * scale;
  assert.equal(clampTranslate(view, MAP, WIDE).y, 0, "y=0 is the top limit");
  near(clampTranslate({ scale, x: 0, y: -9999 }, MAP, WIDE).y, farY, "the bottom limit holds");
});

test("clampTranslate locks an axis smaller than the viewport to its centre", () => {
  // At the fit scale the map is narrower than the viewport, so x is centred.
  const scale = fitScale(MAP, WIDE);
  const centred = (WIDE.width - MAP.width * scale) / 2;
  assert.ok(centred > 0, "precondition: the scaled map is narrower than the viewport");

  const fromHigh = clampTranslate({ scale, x: 100000, y: 0 }, MAP, WIDE);
  const fromLow = clampTranslate({ scale, x: -100000, y: 0 }, MAP, WIDE);

  near(fromHigh.x, centred, "a large positive x centres");
  near(fromLow.x, centred, "a large negative x centres");
  assert.equal(fromHigh.x, fromLow.x, "both extremes land on the same centred value");
});

test("zoom pins the map point under the cursor", () => {
  const base = clampView({ scale: 1, x: -900, y: -700 }, MAP, WIDE);
  const cursorX = 400;
  const cursorY = 300;
  const before = screenToMap(base, cursorX, cursorY);

  for (const factor of [1.2, 1 / 1.2]) {
    const next = zoomAt(base, cursorX, cursorY, factor, MAP, WIDE);
    const after = screenToMap(next, cursorX, cursorY);
    near(after.x, before.x, "the anchor x stays under the cursor at factor " + factor, 1e-6);
    near(after.y, before.y, "the anchor y stays under the cursor at factor " + factor, 1e-6);
    assert.notEqual(next.scale, base.scale, "the scale actually changed at factor " + factor);
  }
});

test("zoomAt returns the same reference when the clamp swallows the change", () => {
  const atCap = clampView({ scale: MAX_SCALE, x: -5000, y: -4000 }, MAP, WIDE);
  assert.equal(zoomAt(atCap, 400, 300, 1.2, MAP, WIDE), atCap, "already at the cap");

  const atFit = fitView(MAP, WIDE);
  assert.equal(zoomAt(atFit, 400, 300, 0.8, MAP, WIDE), atFit, "already at the fit scale");
});

test("zoomAt rejects a non-finite or non-positive factor", () => {
  const base = clampView({ scale: 1, x: -900, y: -700 }, MAP, WIDE);
  for (const factor of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
    assert.equal(
      zoomAt(base, 400, 300, factor, MAP, WIDE),
      base,
      "factor " + factor + " must be a no-op",
    );
  }
});

test("200 alternating zooms at the same cursor do not drift", () => {
  const start = clampView({ scale: 2, x: -2000, y: -1500 }, MAP, WIDE);
  let view = start;
  for (let step = 0; step < 100; step += 1) {
    view = zoomAt(view, 517, 233, 1.1, MAP, WIDE);
    view = zoomAt(view, 517, 233, 1 / 1.1, MAP, WIDE);
  }
  near(view.scale, start.scale, "scale returns to its starting value", 1e-6);
  near(view.x, start.x, "x returns to its starting value", 1e-6);
  near(view.y, start.y, "y returns to its starting value", 1e-6);
});

test("zooming out repeatedly terminates at exactly the fit scale, centred", () => {
  let view = clampView({ scale: 6, x: -8000, y: -6000 }, MAP, WIDE);
  for (let step = 0; step < 500; step += 1) {
    view = zoomAt(view, 1000, 700, 1 / 1.2, MAP, WIDE);
  }
  const fit = fitView(MAP, WIDE);
  assert.equal(view.scale, fit.scale, "the scale settles on exactly the fit scale");
  near(view.x, fit.x, "x settles centred");
  near(view.y, fit.y, "y settles centred");
});

test("sourceRect returns whole source pixels", () => {
  const view = clampView({ scale: 3.7, x: -1234.56, y: -987.65 }, MAP, WIDE);
  const rect = sourceRect(view, WIDE, ART);
  assert.ok(rect, "a visible view must produce a rect");
  for (const key of ["sx", "sy", "sw", "sh"] as const) {
    assert.ok(Number.isInteger(rect[key]), key + " must be an integer, got " + rect[key]);
  }
  assert.ok(rect.sw > 0 && rect.sh > 0, "the rect must have positive extent");
});

test("the sourceRect destination agrees with the transform exactly", () => {
  for (const scale of [0.5, 1, 3.7, 8]) {
    const view = clampView({ scale, x: -1234.56, y: -987.65 }, MAP, WIDE);
    const rect = sourceRect(view, WIDE, ART);
    assert.ok(rect, "scale " + scale + " must produce a rect");

    near(rect.dx, mapToScreen(view, rect.sx, 0).x, "dx follows the transform at " + scale, 1e-6);
    near(rect.dy, mapToScreen(view, 0, rect.sy).y, "dy follows the transform at " + scale, 1e-6);
    // Anti-shimmer: the source is resampled by exactly the view scale.
    near(rect.dw / rect.sw, view.scale, "dw/sw is the scale at " + scale, 1e-9);
    near(rect.dh / rect.sh, view.scale, "dh/sh is the scale at " + scale, 1e-9);
  }
});

test("sourceRect leaves no uncovered strip when the map fills the viewport", () => {
  for (const scale of [1, 2.5, 8]) {
    for (const start of [
      { x: 0, y: 0 },
      { x: -12345.6, y: -9876.5 },
      { x: -100, y: -50 },
    ]) {
      const view = clampView({ scale, x: start.x, y: start.y }, MAP, WIDE);
      assert.ok(MAP.width * view.scale > WIDE.width, "precondition: the map exceeds the viewport");
      const rect = sourceRect(view, WIDE, ART);
      assert.ok(rect, "a filled viewport must produce a rect");

      assert.ok(rect.dx <= 0, "no gap at the left edge, dx=" + rect.dx);
      assert.ok(rect.dy <= 0, "no gap at the top edge, dy=" + rect.dy);
      // The art is one column narrower, so the right edge may fall short by one column.
      assert.ok(
        rect.dx + rect.dw >= WIDE.width - view.scale,
        "no gap at the right edge, dx+dw=" + (rect.dx + rect.dw),
      );
      assert.ok(
        rect.dy + rect.dh >= WIDE.height,
        "no gap at the bottom edge, dy+dh=" + (rect.dy + rect.dh),
      );
    }
  }
});

test("sourceRect clamps to the source when the whole map is visible", () => {
  const view = fitView(MAP, WIDE);
  const rect = sourceRect(view, WIDE, ART);
  assert.ok(rect, "the fitted view must produce a rect");

  assert.equal(rect.sx, 0);
  assert.equal(rect.sy, 0);
  assert.equal(rect.sw, ART.width);
  assert.equal(rect.sh, ART.height);
});

test("sourceRect refuses a degenerate view", () => {
  for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      sourceRect({ scale, x: 0, y: 0 }, WIDE, ART),
      null,
      "scale " + scale + " must yield null",
    );
  }
  // Source entirely off screen, both directions.
  assert.equal(sourceRect({ scale: 1, x: 5000, y: 0 }, WIDE, ART), null, "off to the right");
  assert.equal(sourceRect({ scale: 1, x: -9000, y: 0 }, WIDE, ART), null, "off to the left");
  assert.equal(sourceRect({ scale: 1, x: 0, y: -9000 }, WIDE, ART), null, "off the top");
});

test("sourceRect never asks the 3652-wide art for column 3652", () => {
  // Panned right against the map clamp. drawImage must not get a column the
  // art bitmap lacks: some browsers throw IndexSizeError.
  for (const scale of [fitScale(MAP, WIDE), 1, 4, 8]) {
    const view = clampView({ scale, x: -1e9, y: -1e9 }, MAP, WIDE);
    const rect = sourceRect(view, WIDE, ART);
    assert.ok(rect, "scale " + scale + " must produce a rect");
    assert.ok(rect.sx >= 0, "sx must not be negative, got " + rect.sx);
    assert.ok(rect.sy >= 0, "sy must not be negative, got " + rect.sy);
    assert.ok(rect.sx + rect.sw <= ART.width, "sx+sw=" + (rect.sx + rect.sw) + " exceeds the art");
    assert.ok(rect.sy + rect.sh <= ART.height, "sy+sh=" + (rect.sy + rect.sh) + " exceeds the art");
  }
});

test("shouldSmooth decides in device pixels, not CSS pixels", () => {
  assert.equal(shouldSmooth(0.5, 1), true, "minified on a 1x display");
  assert.equal(shouldSmooth(0.5, 2), false, "0.5 CSS px per map px is 1x on a 2x display");
  assert.equal(shouldSmooth(1, 1), false, "1:1 is not smoothed");
  assert.equal(shouldSmooth(0.4, 2), true, "still minified on a 2x display");
  assert.equal(shouldSmooth(8, 2), false, "magnified");
});

test("snapView puts the translate on the device pixel grid and leaves scale alone", () => {
  const view: View = { scale: 3.33333, x: -1234.567, y: 89.123 };
  for (const dpr of [1, 2, 1.25]) {
    const snapped = snapView(view, dpr);
    near(
      snapped.x * dpr,
      Math.round(snapped.x * dpr),
      "x lands on a device pixel at dpr " + dpr,
      1e-9,
    );
    near(
      snapped.y * dpr,
      Math.round(snapped.y * dpr),
      "y lands on a device pixel at dpr " + dpr,
      1e-9,
    );
    assert.equal(snapped.scale, view.scale, "scale is never quantised");
    assert.ok(Math.abs(snapped.x - view.x) <= 1 / dpr, "the snap moves by less than a pixel");
  }
});

test("snapView passes a degenerate dpr straight through", () => {
  const view: View = { scale: 2, x: 1.5, y: 2.5 };
  assert.equal(snapView(view, 0), view);
  assert.equal(snapView(view, Number.NaN), view);
  assert.equal(snapView(view, -2), view);
});

test("a zero-sized viewport never yields NaN or Infinity", () => {
  const zero: Size = { width: 0, height: 0 };

  const fit = fitScale(MAP, zero);
  assert.ok(Number.isFinite(fit) && fit > 0, "fitScale stays finite and positive, got " + fit);

  const fitted = fitView(MAP, zero);
  for (const key of ["scale", "x", "y"] as const) {
    assert.ok(Number.isFinite(fitted[key]), "fitView." + key + " is " + fitted[key]);
  }

  const clamped = clampView({ scale: 4, x: -100, y: -100 }, MAP, zero);
  for (const key of ["scale", "x", "y"] as const) {
    assert.ok(Number.isFinite(clamped[key]), "clampView." + key + " is " + clamped[key]);
  }

  const rect = sourceRect(fitted, zero, ART);
  if (rect !== null) {
    for (const key of ["sx", "sy", "sw", "sh", "dx", "dy", "dw", "dh"] as const) {
      assert.ok(Number.isFinite(rect[key]), "sourceRect." + key + " is " + rect[key]);
    }
  }
});

test("translateTo pans within the clamp and never past it", () => {
  const base = clampView({ scale: 2, x: -1000, y: -800 }, MAP, WIDE);
  const moved = translateTo(base, -1200, -900, MAP, WIDE);
  assert.equal(moved.scale, base.scale, "translateTo never changes the scale");
  near(moved.x, -1200, "an in-range x lands where asked");
  near(moved.y, -900, "an in-range y lands where asked");

  const pinned = translateTo(base, 1e9, 1e9, MAP, WIDE);
  assert.equal(pinned.x, 0, "past the left edge is pinned");
  assert.equal(pinned.y, 0, "past the top edge is pinned");

  const bad = translateTo(base, Number.NaN, Number.NaN, MAP, WIDE);
  assert.ok(Number.isFinite(bad.x) && Number.isFinite(bad.y), "a NaN pan cannot corrupt the view");
});

test("clampView clamps the scale and the translate in one call", () => {
  // A scale below the fit is raised and the translate is recomputed.
  const fit = fitScale(MAP, WIDE);
  const clamped = clampView({ scale: fit / 10, x: -5000, y: -5000 }, MAP, WIDE);
  const fitted = fitView(MAP, WIDE);

  assert.equal(clamped.scale, fitted.scale, "the scale is raised to the fit scale");
  near(clamped.x, fitted.x, "x is recentred for the clamped scale");
  near(clamped.y, fitted.y, "y is recentred for the clamped scale");

  // The cap end of the same call.
  const capped = clampView({ scale: 100, x: -1e9, y: -1e9 }, MAP, WIDE);
  assert.equal(capped.scale, MAX_SCALE);
  near(capped.x, WIDE.width - MAP.width * MAX_SCALE, "the translate follows the capped scale");
  near(capped.y, WIDE.height - MAP.height * MAX_SCALE, "the same on y");
});

test("snapView passes a non-finite translate straight through", () => {
  // snapView must not turn NaN into a plausible number.
  const bad: View = { scale: 2, x: Number.NaN, y: 0 };
  assert.equal(snapView(bad, 2), bad);
  const infinite: View = { scale: 2, x: 0, y: Number.POSITIVE_INFINITY };
  assert.equal(snapView(infinite, 2), infinite);
});

test("a square viewport exercises the other fit axis end to end", () => {
  const view = fitView(MAP, SQUARE);
  near(view.scale, 900 / 3653, "the square viewport still fits on width");
  const centre = mapToScreen(view, MAP.width / 2, MAP.height / 2);
  near(centre.x, 450, "centred on x", 1e-6);
  near(centre.y, 450, "centred on y", 1e-6);

  // A tall map centres on x instead.
  const tall: Size = { width: 500, height: 4000 };
  const tallView = fitView(tall, SQUARE);
  near(tallView.scale, 900 / 4000, "the tall map fits on height");
  near(tallView.y, 0, "no slack on the fitting axis", 1e-6);
  near(tallView.x, (900 - 500 * (900 / 4000)) / 2, "the narrow axis is centred", 1e-6);
});

// --- resizeView and the fitted scale -------------------------------------

test("resizeView preserves the scale where clampView would raise it", () => {
  // Grow then shrink the host: `clampView` keeps the raised scale,
  // `resizeView` keeps the user's scale.
  const short: Size = { width: 1728, height: 906 };
  const tall: Size = { width: 1728, height: 1400 };
  const zoomed: View = clampView({ scale: 0.47, x: -100, y: -200 }, MAP, short);

  const raised = clampView(zoomed, MAP, tall);
  const kept = resizeView(zoomed, MAP, tall);

  assert.ok(raised.scale > zoomed.scale, "precondition: clampView raises this scale");
  assert.equal(kept.scale, zoomed.scale, "resizeView does not");
  assert.notEqual(kept.scale, raised.scale, "the two disagree on exactly this input");

  // The translate is still clamped: the map is centred on y.
  near(kept.y, (tall.height - MAP.height * kept.scale) / 2, "the translate is re-clamped");
});

test("resizeView clamps to MIN_SCALE and MAX_SCALE and never returns NaN", () => {
  const huge = resizeView({ scale: 500, x: 0, y: 0 }, MAP, WIDE);
  assert.equal(huge.scale, MAX_SCALE, "capped at MAX_SCALE");

  const tiny = resizeView({ scale: 1e-9, x: 0, y: 0 }, MAP, WIDE);
  assert.equal(tiny.scale, MIN_SCALE, "floored at MIN_SCALE, not at the fit scale");

  for (const scale of [Number.NaN, Number.POSITIVE_INFINITY, 0, -3]) {
    const out = resizeView({ scale, x: 10, y: 10 }, MAP, WIDE);
    assert.equal(out.scale, fittedScale(MAP, WIDE), "a degenerate scale falls back to the fit");
    assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y), "and the translate is finite");
  }
});

test("isFittedScale agrees with fitView on both fit axes and for a huge viewport", () => {
  for (const viewport of [WIDE, SQUARE, { width: 400, height: 4000 }]) {
    assert.equal(
      isFittedScale(fitView(MAP, viewport).scale, MAP, viewport),
      true,
      "the fitted view reads as fitted at " + viewport.width + "x" + viewport.height,
    );
    assert.equal(
      isFittedScale(fitView(MAP, viewport).scale * 2, MAP, viewport),
      false,
      "and a zoomed scale does not",
    );
  }

  // Viewport over 8x the map: compare against the capped fit scale, or the
  // view never re-fits.
  const tiny: Size = { width: 10, height: 10 };
  const roomy: Size = { width: 1200, height: 800 };
  assert.ok(fitScale(tiny, roomy) > MAX_SCALE, "precondition: the raw fit exceeds the cap");
  assert.equal(fittedScale(tiny, roomy), MAX_SCALE);
  assert.equal(isFittedScale(fitView(tiny, roomy).scale, tiny, roomy), true);
});

test("MIN_SCALE is 0.02, and 0.02 still leaves a map on screen", () => {
  // Pinned: the floor that keeps a resized scale away from 0, NaN and negatives.
  assert.equal(MIN_SCALE, 0.02);
  assert.ok(MIN_SCALE > 0, "a 0 scale propagates Infinity through screenToMap");
  assert.ok(MIN_SCALE < MAX_SCALE, "the range can never invert");
  // The map at MIN_SCALE is 73 x 57 CSS px: tiny but visible.
  assert.equal(Math.round(MAP.width * MIN_SCALE), 73);
  assert.equal(Math.round(MAP.height * MIN_SCALE), 57);
  // Below the fit scale of a phone viewport, so no fitted view sits on the floor.
  assert.ok(MIN_SCALE < fitScale(MAP, { width: 320, height: 240 }));
});

test("resizeView returns every legal scale unchanged, at every viewport, idempotently", () => {
  // Contract: a resize may re-clamp the translation but never moves the scale.
  const viewports: Size[] = [
    WIDE,
    SQUARE,
    { width: 1728, height: 906 },
    { width: 1728, height: 1400 },
    { width: 320, height: 240 },
    { width: 3600, height: 2800 },
  ];
  for (const viewport of viewports) {
    for (const scale of [MIN_SCALE, 0.05, 0.317338003502627, 1, 3.5, MAX_SCALE]) {
      const label = "scale " + scale + " at " + viewport.width + "x" + viewport.height;
      const out = resizeView({ scale, x: -321.5, y: -87.25 }, MAP, viewport);
      assert.equal(out.scale, scale, label + ": the scale moved");
      assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y), label + ": non-finite translate");
      // Repeated reports of the same size must be no-ops, or the view drifts.
      assert.deepEqual(resizeView(out, MAP, viewport), out, label + ": not idempotent");
    }
  }
});

test("THE RATCHET: a grow-then-shrink round trip moves clampView and not resizeView", () => {
  // Grow then shrink must not leave the scale high and the map cropped.
  const base: Size = { width: 1728, height: 906 };
  const start = fitView(MAP, base);
  for (const grown of [
    { width: 1728, height: 1400 },
    { width: 1900, height: 1000 },
    { width: 2600, height: 2000 },
  ]) {
    const label = grown.width + "x" + grown.height;
    assert.ok(fitScale(MAP, grown) > start.scale, label + ": precondition, the fit really grows");

    const ratcheted = clampView(clampView(start, MAP, grown), MAP, base);
    assert.ok(ratcheted.scale > start.scale, label + ": clampView must ratchet, or nothing is proven");

    const round = resizeView(resizeView(start, MAP, grown), MAP, base);
    assert.equal(round.scale, start.scale, label + ": resizeView ratcheted too");
    assert.deepEqual(round, start, label + ": the round trip did not land on the original view");
  }
});

test("isFittedScale rejects a non-finite scale and the UNCAPPED fit scale", () => {
  for (const scale of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(isFittedScale(scale, MAP, WIDE), false, "scale " + scale + " is not fitted");
  }

  // Viewport over 8x the map: the raw fit scale is unreachable, so the flag
  // must compare against the capped one.
  const tiny: Size = { width: 10, height: 10 };
  const roomy: Size = { width: 1200, height: 800 };
  assert.ok(fitScale(tiny, roomy) > MAX_SCALE, "precondition: the raw fit is past the cap");
  assert.equal(isFittedScale(fitScale(tiny, roomy), tiny, roomy), false);
  assert.equal(isFittedScale(MAX_SCALE, tiny, roomy), true);
});
