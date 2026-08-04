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
