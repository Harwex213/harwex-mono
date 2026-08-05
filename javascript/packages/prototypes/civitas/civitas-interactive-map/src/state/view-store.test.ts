import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SCALE, fitScale, fitView, screenToMap } from "../map/view";
import { mapSize } from "./map-store";
import {
  cursorMap,
  dpr,
  mapPixelAt,
  panTo,
  resetView,
  setCursor,
  setDpr,
  setViewport,
  syncView,
  view,
  viewFitted,
  viewport,
  zoomAtPoint,
} from "./view-store";
import type { Signal } from "@preact/signals-react";

// No DOM and no React here: the store is signals plus guarded actions, and both
// are plain values in Node. What is under test is the guard logic — when a write
// is skipped, when the view may not exist yet, and how a resize re-clamps.

const MAP = { width: 3653, height: 2855 };
const HOST = { width: 1728, height: 906 };

// The two verified probe pixels from T02, reused here so the screen -> map path
// of THIS task is pinned to the same numbers.
const PROVINCE_1000_PIXEL = { x: 1382, y: 1329 };
const PROVINCE_1_CENTROID = { x: 598, y: 391 };

// The store is a module singleton, so every test starts from a known state.
function reset(): void {
  view.value = null;
  viewport.value = { width: 0, height: 0 };
  mapSize.value = null;
  dpr.value = 1;
  cursorMap.value = null;
  // Without this a `false` left by an earlier test leaks into the next one and
  // its first resize preserves the scale instead of re-fitting.
  viewFitted.value = true;
}

function ready(width: number, height: number): void {
  reset();
  mapSize.value = { ...MAP };
  setViewport(width, height);
}

// `subscribe` fires once immediately, so the initial call is not a change.
function countWrites<T>(target: Signal<T>): () => number {
  let writes = -1;
  target.subscribe(() => {
    writes += 1;
  });
  return () => {
    return writes;
  };
}

function near(actual: number, expected: number, message: string, epsilon = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    message + ": expected " + expected + ", got " + actual,
  );
}

test("there is no view until BOTH the map size and a non-zero viewport exist", () => {
  reset();

  setViewport(HOST.width, HOST.height);
  assert.equal(view.value, null, "a viewport alone is not enough");

  mapSize.value = { ...MAP };
  assert.equal(view.value, null, "the map size arriving does not write the view by itself");

  syncView();
  assert.ok(view.value, "syncView is the single initialisation point");

  // The other arrival order — the load finishing first — must work too.
  reset();
  mapSize.value = { ...MAP };
  syncView();
  assert.equal(view.value, null, "a zero viewport still yields no view");
  setViewport(HOST.width, HOST.height);
  assert.ok(view.value, "the viewport arriving second initialises the view");
});

test("the first view is the fitted view for the real map in a real host", () => {
  ready(HOST.width, HOST.height);
  const current = view.value;
  assert.ok(current);

  const expected = fitView(MAP, HOST);
  assert.equal(current.scale, expected.scale);
  // 906 / 2855 = 0.3173 — this host fits on HEIGHT, not width.
  near(current.scale, HOST.height / MAP.height, "the fit axis is height");
  near(current.y, 0, "no slack on the fitting axis");
  assert.ok(current.x > 0, "the map is letterboxed on x, got " + current.x);
});

test("a zero-sized viewport report leaves the previous good view untouched", () => {
  // ResizeObserver fires 0 x 0 when an ancestor becomes display: none. Losing
  // the view there means the map jumps when the panel reopens.
  ready(HOST.width, HOST.height);
  const before = view.value;
  assert.ok(before);

  setViewport(0, 0);
  assert.equal(view.value, before, "the view survives, by reference");

  setViewport(HOST.width, HOST.height);
  assert.equal(view.value, before, "and it is still the same view when the host returns");
});

test("repeating the same viewport writes nothing", () => {
  ready(HOST.width, HOST.height);
  const viewWrites = countWrites(view);
  const viewportWrites = countWrites(viewport);

  setViewport(HOST.width, HOST.height);
  setViewport(HOST.width, HOST.height);

  assert.equal(viewportWrites(), 0, "the viewport signal is not rewritten");
  assert.equal(viewWrites(), 0, "and neither is the view, so no repaint is scheduled");
});

test("a resize that raises the fit scale re-clamps the view", () => {
  // A bigger host has a higher fit scale, so the old scale is now below the
  // minimum. Without the re-clamp the map ends up smaller than the host with the
  // old translate, and a gap opens on two edges.
  ready(600, 300);
  const before = view.value;
  assert.ok(before);

  setViewport(HOST.width, HOST.height);
  const after = view.value;
  assert.ok(after);

  const fit = fitScale(MAP, HOST);
  assert.ok(before.scale < fit, "precondition: the old scale is below the new fit");
  assert.equal(after.scale, fit, "the scale is raised to the new fit scale");
  near(after.y, 0, "and the view is re-centred on the fitting axis");
});

test("a resize that leaves the scale legal does not touch it", () => {
  ready(HOST.width, HOST.height);
  zoomAtPoint(800, 400, 2);
  const zoomed = view.value;
  assert.ok(zoomed);

  const narrow = { width: 600, height: HOST.height };
  setViewport(narrow.width, narrow.height);
  const after = view.value;
  assert.ok(after);

  assert.ok(zoomed.scale > fitScale(MAP, narrow), "precondition: the scale is still legal");
  assert.equal(after.scale, zoomed.scale, "a legal scale survives a resize untouched");
});

test("a wheel held at the zoom cap writes nothing at all", () => {
  // Without this guard the app repaints at 60 fps while the wheel spins, and the
  // view jitters from floating-point noise.
  ready(HOST.width, HOST.height);
  for (let step = 0; step < 60; step += 1) {
    zoomAtPoint(715, 449, 1.5);
  }
  const capped = view.value;
  assert.ok(capped);
  assert.equal(capped.scale, MAX_SCALE, "sixty wheel steps reach the cap");

  const writes = countWrites(view);
  for (let step = 0; step < 20; step += 1) {
    zoomAtPoint(715, 449, 1.5);
  }
  assert.equal(writes(), 0, "no signal write once the clamp swallows the change");
  assert.equal(view.value, capped, "and the view object is the very same reference");
});

test("zooming through the store keeps the same map pixel under the cursor", () => {
  ready(HOST.width, HOST.height);
  const cursor = { x: 715, y: 449 };

  // Zoom past the point where both axes exceed the host — below that the clamp
  // locks the translate to the centred value and a pan is a no-op by design.
  for (let step = 0; step < 6; step += 1) {
    zoomAtPoint(cursor.x, cursor.y, 1.5);
  }
  const zoomedIn = view.value;
  assert.ok(zoomedIn);
  assert.ok(MAP.width * zoomedIn.scale > HOST.width, "precondition: the map exceeds the host");

  // Pan the CENTRE of the probe pixel under the cursor, then zoom to the cap one
  // wheel step at a time.
  panTo(
    cursor.x - (PROVINCE_1000_PIXEL.x + 0.5) * zoomedIn.scale,
    cursor.y - (PROVINCE_1000_PIXEL.y + 0.5) * zoomedIn.scale,
  );
  const before = mapPixelAt(cursor.x, cursor.y);
  assert.deepEqual(before, PROVINCE_1000_PIXEL, "the probe pixel starts under the cursor");

  for (let step = 0; step < 60; step += 1) {
    zoomAtPoint(cursor.x, cursor.y, 1.15);
  }
  const zoomed = view.value;
  assert.ok(zoomed);
  assert.equal(zoomed.scale, MAX_SCALE, "the run ends at the cap");
  assert.deepEqual(
    mapPixelAt(cursor.x, cursor.y),
    PROVINCE_1000_PIXEL,
    "and the same map pixel is still under the cursor, with zero drift",
  );
});

test("zooming out through the store terminates at exactly the fit view", () => {
  ready(HOST.width, HOST.height);
  for (let step = 0; step < 20; step += 1) {
    zoomAtPoint(400, 300, 1.4);
  }
  for (let step = 0; step < 200; step += 1) {
    zoomAtPoint(400, 300, 1 / 1.4);
  }
  assert.deepEqual(view.value, fitView(MAP, HOST), "back to the fitted, centred view");
});

test("panTo clamps flush to the map edges and never accepts NaN", () => {
  ready(HOST.width, HOST.height);
  zoomAtPoint(800, 400, 2.5);
  const zoomed = view.value;
  assert.ok(zoomed);
  const scale = zoomed.scale;
  assert.ok(MAP.width * scale > HOST.width, "precondition: the map exceeds the host");

  panTo(1e9, 1e9);
  assert.deepEqual(
    { x: view.value?.x, y: view.value?.y },
    { x: 0, y: 0 },
    "the top-left limit is map pixel (0, 0) at the host origin",
  );

  panTo(-1e9, -1e9);
  const pinned = view.value;
  assert.ok(pinned);
  near(pinned.x, HOST.width - MAP.width * scale, "the right edge lands flush");
  near(pinned.y, HOST.height - MAP.height * scale, "the bottom edge lands flush");

  panTo(Number.NaN, Number.NaN);
  const after = view.value;
  assert.ok(after);
  assert.ok(
    Number.isFinite(after.x) && Number.isFinite(after.y),
    "a NaN pan can never corrupt the view beyond recovery",
  );
});

test("every action is a no-op before the map size exists", () => {
  reset();
  setViewport(HOST.width, HOST.height);
  const writes = countWrites(view);

  zoomAtPoint(400, 300, 2);
  panTo(-100, -100);
  resetView();
  syncView();

  assert.equal(writes(), 0, "nothing may be written without a map size");
  assert.equal(view.value, null);
  assert.equal(mapPixelAt(400, 300), null, "and there is no pixel to pick");
});

test("resetView returns the fitted view and then writes nothing", () => {
  ready(HOST.width, HOST.height);
  zoomAtPoint(800, 400, 4);
  resetView();
  assert.deepEqual(view.value, fitView(MAP, HOST));

  const writes = countWrites(view);
  resetView();
  assert.equal(writes(), 0, "a second reset changes nothing, so it writes nothing");
});

test("setDpr rejects a degenerate ratio and skips an unchanged one", () => {
  reset();
  const writes = countWrites(dpr);

  for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
    setDpr(bad);
  }
  assert.equal(dpr.value, 1, "a degenerate ratio never lands");

  setDpr(2);
  assert.equal(dpr.value, 2);
  setDpr(2);
  assert.equal(writes(), 1, "only the real change wrote");
});

test("setCursor writes only when the integer pixel changed", () => {
  ready(HOST.width, HOST.height);
  const writes = countWrites(cursorMap);

  setCursor({ x: 10, y: 20 });
  setCursor({ x: 10, y: 20 });
  assert.equal(writes(), 1, "a pointermove inside one magnified map pixel is silent");

  setCursor({ x: 10, y: 21 });
  assert.equal(writes(), 2, "a new pixel writes");

  setCursor(null);
  assert.equal(cursorMap.value, null);
  setCursor(null);
  assert.equal(writes(), 3, "leaving twice writes once");
});

test("mapPixelAt floors to a map pixel and rejects everything outside the map", () => {
  ready(HOST.width, HOST.height);
  const current = view.value;
  assert.ok(current);

  // Screen point for the centre of province 1's centroid pixel.
  const screen = {
    x: current.x + (PROVINCE_1_CENTROID.x + 0.5) * current.scale,
    y: current.y + (PROVINCE_1_CENTROID.y + 0.5) * current.scale,
  };
  assert.deepEqual(mapPixelAt(screen.x, screen.y), PROVINCE_1_CENTROID, "the centroid pixel");
  assert.deepEqual(
    mapPixelAt(screen.x + current.scale * 0.4, screen.y + current.scale * 0.4),
    PROVINCE_1_CENTROID,
    "a fractional map coordinate is floored, not rounded",
  );

  // The authoritative bounds are 3653 x 2855: the last legal pixel is (3652, 2854).
  const lastX = current.x + (MAP.width - 0.5) * current.scale;
  const lastY = current.y + (MAP.height - 0.5) * current.scale;
  assert.deepEqual(mapPixelAt(lastX, lastY), { x: MAP.width - 1, y: MAP.height - 1 });
  // Map pixel 3653 is the FIRST illegal one, and it is the one an off-by-one
  // bound lets through.
  assert.equal(
    mapPixelAt(current.x + (MAP.width + 0.5) * current.scale, lastY),
    null,
    "map pixel 3653 is off the map",
  );
  assert.equal(
    mapPixelAt(lastX, current.y + (MAP.height + 0.5) * current.scale),
    null,
    "map pixel 2855 is off the map",
  );
  assert.equal(mapPixelAt(current.x - 1, current.y - 1), null, "and so is the letterbox");
  assert.equal(mapPixelAt(Number.NaN, 0), null, "a NaN coordinate picks nothing");
});

test("mapPixelAt agrees with screenToMap on the live view", () => {
  ready(HOST.width, HOST.height);
  zoomAtPoint(800, 400, 6);
  const current = view.value;
  assert.ok(current);

  for (const point of [
    { x: 0, y: 0 },
    { x: 517, y: 233 },
    { x: HOST.width - 1, y: HOST.height - 1 },
  ]) {
    const direct = screenToMap(current, point.x, point.y);
    const picked = mapPixelAt(point.x, point.y);
    if (picked === null) {
      assert.ok(
        direct.x < 0 || direct.y < 0 || direct.x >= MAP.width || direct.y >= MAP.height,
        "null is only ever returned outside the map bounds",
      );
      continue;
    }
    assert.equal(picked.x, Math.floor(direct.x), "x agrees with the pure transform");
    assert.equal(picked.y, Math.floor(direct.y), "y agrees with the pure transform");
  }
});

// --- the resize ratchet (T08-FIX D1) --------------------------------------

test("a viewport that grows and shrinks back returns to the fit scale", () => {
  // THE REGRESSION. `.plan/VISUAL-CHECK-PHASE2.md` drove exactly this sequence
  // in the browser and the zoom read 32% -> 47% -> 47%, because `clampScale`
  // floors at the fit scale: growing the host raised the floor and dragged the
  // scale up, and shrinking it back left the scale high with the map cropped.
  ready(HOST.width, HOST.height);
  const fitAt906 = fitScale(MAP, HOST);
  const grown = { width: HOST.width, height: 1400 };

  assert.equal(view.value?.scale, fitAt906, "the load starts at the 906 fit");
  assert.equal(viewFitted.value, true, "and a fresh load is fitted");

  setViewport(grown.width, grown.height);
  const middle = view.value;
  assert.ok(middle);
  assert.equal(middle.scale, fitScale(MAP, grown), "the fitted view takes the new fit scale");
  // Without this the test would still pass under "a resize never touches the
  // scale", which is a different bug.
  assert.ok(middle.scale > fitAt906, "precondition: the grown fit really is larger");

  setViewport(HOST.width, HOST.height);
  assert.deepEqual(view.value, fitView(MAP, HOST), "and shrinking back returns to the fit view");
  assert.equal(viewFitted.value, true, "still fitted at the end");
});

test("a deliberate zoom survives the same grow-and-shrink sequence", () => {
  // The other half of the policy. Re-fitting on every resize would be a wrong
  // fix: it would throw away the user's zoom whenever the window changed.
  ready(HOST.width, HOST.height);
  zoomAtPoint(800, 400, 4);
  const zoomed = view.value;
  assert.ok(zoomed);
  assert.equal(viewFitted.value, false, "a zoom clears the fitted flag");

  setViewport(HOST.width, 1400);
  assert.equal(view.value?.scale, zoomed.scale, "growing the host preserves the zoom");
  setViewport(HOST.width, HOST.height);
  assert.equal(view.value?.scale, zoomed.scale, "and so does shrinking it back");
  assert.equal(viewFitted.value, false, "the flag is still clear");
});

test("a resize preserves a scale that is now below the new fit scale", () => {
  // The documented consequence of the briefed policy: the map letterboxes on
  // all four sides rather than being re-fitted behind the user's back. One
  // press of `0` recovers it.
  ready(HOST.width, HOST.height);
  const fitAt906 = fitScale(MAP, HOST);
  zoomAtPoint(800, 400, 1.2);
  const zoomed = view.value;
  assert.ok(zoomed);
  assert.ok(zoomed.scale > fitAt906, "precondition: the user zoomed in");

  const huge = { width: 3600, height: 2800 };
  setViewport(huge.width, huge.height);
  const after = view.value;
  assert.ok(after);
  assert.ok(zoomed.scale < fitScale(MAP, huge), "precondition: the new fit is above the scale");
  assert.equal(after.scale, zoomed.scale, "the scale is preserved, not raised to the new fit");
  assert.ok(Number.isFinite(after.x) && Number.isFinite(after.y), "the translate stays finite");
  near(after.x, (huge.width - MAP.width * after.scale) / 2, "centred on x");
  near(after.y, (huge.height - MAP.height * after.scale) / 2, "centred on y");
});

test("zooming back to the fit scale re-arms the re-fit", () => {
  ready(HOST.width, HOST.height);
  for (let step = 0; step < 6; step += 1) {
    zoomAtPoint(400, 300, 1.4);
  }
  assert.equal(viewFitted.value, false);
  for (let step = 0; step < 60; step += 1) {
    zoomAtPoint(400, 300, 1 / 1.4);
  }
  assert.equal(view.value?.scale, fitScale(MAP, HOST), "the zoom out lands back on the fit");
  assert.equal(viewFitted.value, true, "which re-arms the flag with no extra wiring");

  const grown = { width: HOST.width, height: 1400 };
  setViewport(grown.width, grown.height);
  assert.equal(view.value?.scale, fitScale(MAP, grown), "so the next resize re-fits again");
});

test("resetView re-arms the re-fit", () => {
  ready(HOST.width, HOST.height);
  zoomAtPoint(800, 400, 4);
  assert.equal(viewFitted.value, false);

  resetView();
  assert.equal(viewFitted.value, true, "the reset control puts the view back in the fitted state");

  const grown = { width: HOST.width, height: 1400 };
  setViewport(grown.width, grown.height);
  assert.equal(view.value?.scale, fitScale(MAP, grown), "and the view re-fits on the next resize");
});

test("a fitted view survives a viewport report it must ignore", () => {
  // The zero-sized report is the ancestor going `display: none`. It must not
  // clear the flag, or the map would stop re-fitting after any panel toggle
  // that hides the host.
  ready(HOST.width, HOST.height);
  setViewport(0, 0);
  assert.equal(viewFitted.value, true, "a 0 x 0 report changes nothing");

  const grown = { width: HOST.width, height: 1400 };
  setViewport(grown.width, grown.height);
  assert.equal(view.value?.scale, fitScale(MAP, grown), "and the view still re-fits");
});

// A map other than the shipped one, for the two cases the real 3653 x 2855 map
// cannot express: an exact scale coincidence, and a viewport past the 8x cap.
function readyWith(map: { width: number; height: number }, width: number, height: number): void {
  reset();
  mapSize.value = { ...map };
  setViewport(width, height);
}

test("a resize that leaves the view identical still re-derives the fitted flag", () => {
  // THE TRAP. `writeView` derives the flag BEFORE its `sameView` early return.
  // Derived after, a resize whose clamped view happens to equal the current one
  // would keep the stale `false`, and this view would never re-fit again.
  const map = { width: 1000, height: 1000 };
  readyWith(map, 500, 500);
  zoomAtPoint(250, 250, 1.8);
  // Pan flush to the top-left, so the 900 x 900 resize below produces exactly
  // this view again and `sameView` bites.
  panTo(1e9, 1e9);
  const zoomed = view.value;
  assert.ok(zoomed);
  assert.deepEqual(zoomed, { scale: 0.9, x: 0, y: 0 }, "precondition: the exact view");
  assert.equal(viewFitted.value, false, "precondition: 0.9 is not the 500 x 500 fit");

  const writes = countWrites(view);
  setViewport(900, 900);
  assert.equal(view.value, zoomed, "the resize produced the very same view, by reference");
  assert.equal(writes(), 0, "so nothing was written");
  assert.equal(viewFitted.value, true, "but 0.9 IS the 900 x 900 fit scale, so the flag re-armed");

  setViewport(1800, 1800);
  assert.equal(view.value?.scale, 1.8, "and the next resize re-fits");
});

test("fractional viewport jitter re-fits in BOTH directions and leaves no residue", () => {
  // `getBoundingClientRect` reports fractions, and a scrollbar or a font swap
  // moves the host by a fraction of a pixel. Under the old floor every one of
  // those was a one-way step up.
  ready(HOST.width, HOST.height);
  for (const height of [906.4, 905.6, 907.25, 904.125, HOST.height]) {
    setViewport(HOST.width, height);
    const port = { width: HOST.width, height };
    assert.equal(
      view.value?.scale,
      fitScale(MAP, port),
      "the scale tracks the viewport at height " + height,
    );
    assert.equal(viewFitted.value, true, "and the view is still fitted at height " + height);
  }
  assert.deepEqual(view.value, fitView(MAP, HOST), "the jitter left no residue at all");
});

test("a viewport more than 8x the map is still a FITTED view and still re-fits", () => {
  // `isFittedScale` compares against `fittedScale`, the fit scale CAPPED at
  // MAX_SCALE. Against the raw `fitScale` the flag would read false here
  // forever, every later resize would preserve instead of fit, and the map
  // would never come back.
  const tiny = { width: 100, height: 100 };
  const roomy = { width: 1200, height: 1000 };
  readyWith(tiny, roomy.width, roomy.height);
  assert.ok(fitScale(tiny, roomy) > MAX_SCALE, "precondition: the raw fit is past the cap");
  assert.equal(view.value?.scale, MAX_SCALE, "the load is capped at MAX_SCALE");
  assert.equal(viewFitted.value, true, "and a capped fit is still fitted");

  setViewport(400, 400);
  assert.equal(view.value?.scale, 4, "shrinking below the cap re-fits to the new fit scale");
  assert.equal(viewFitted.value, true);
});

test("a dpr change never touches the view or the fitted flag", () => {
  // `dpr` enters at draw time only; it is not part of the scale.
  ready(HOST.width, HOST.height);
  const fitted = view.value;
  assert.ok(fitted);
  const writes = countWrites(view);

  setDpr(2);
  assert.equal(view.value, fitted, "a fitted view is untouched");
  assert.equal(viewFitted.value, true);

  zoomAtPoint(800, 400, 3);
  const zoomed = view.value;
  assert.ok(zoomed);
  assert.equal(viewFitted.value, false);

  setDpr(3);
  assert.equal(view.value, zoomed, "and so is a deliberate zoom");
  assert.equal(viewFitted.value, false, "a dpr change cannot re-arm the re-fit");
  assert.equal(writes(), 1, "only the zoom ever wrote the view");
});

test("a 0 x 0 report does not re-arm a zoomed view", () => {
  // The complement of the fitted case: hiding the host must not silently put
  // the view back to the fit scale when the panel closes again.
  ready(HOST.width, HOST.height);
  zoomAtPoint(800, 400, 4);
  const zoomed = view.value;
  assert.ok(zoomed);

  setViewport(0, 0);
  assert.equal(viewFitted.value, false, "the flag survives the hidden host");
  assert.equal(view.value, zoomed, "and so does the view");

  setViewport(HOST.width, HOST.height);
  assert.deepEqual(view.value, zoomed, "the zoom is intact when the host comes back");
  assert.equal(viewFitted.value, false);
});

test("a pan never re-arms the re-fit", () => {
  // The flag is derived from the SCALE alone. A pan that happened to land on a
  // centred translate must not read as "fitted" and throw the zoom away on the
  // next resize.
  ready(HOST.width, HOST.height);
  zoomAtPoint(800, 400, 4);
  const zoomed = view.value;
  assert.ok(zoomed);

  panTo(-500, -300);
  panTo(1e9, 1e9);
  panTo(-1e9, -1e9);
  assert.equal(viewFitted.value, false, "panning is not zooming");

  const grown = { width: HOST.width, height: 1400 };
  setViewport(grown.width, grown.height);
  assert.equal(view.value?.scale, zoomed.scale, "so the resize still preserves the zoom");
});
