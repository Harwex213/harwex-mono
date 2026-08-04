// Pure view transform. No DOM, no canvas, no `window`, no signals — every
// function here is a pure function of its arguments, so the whole module is
// unit testable in Node. `.plan/T03/DESIGN.md` section 3 is the spec.
//
// `scale` is CSS pixels per map pixel, NOT device pixels. `MAX_SCALE = 8`
// therefore means 8 CSS px per map pixel, which is 16 device px on a 2x
// display. `dpr` enters only at `snapView` and at draw time.
//
// `x` / `y` are where map pixel (0, 0) sits inside the viewport, in CSS pixels.

type View = { scale: number; x: number; y: number };
type Size = { width: number; height: number };
type Point = { x: number; y: number };
type DrawRect = {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
};

const MAX_SCALE = 8;

// The `max(1, ...)` guards keep a degenerate 0-sized viewport or map from
// producing `0`, `Infinity` or `NaN`. A `0` scale propagates `Infinity` through
// `screenToMap` and then `NaN` into `provinceAt`.
function fitScale(map: Size, viewport: Size): number {
  const mapWidth = Math.max(1, map.width);
  const mapHeight = Math.max(1, map.height);
  const viewWidth = Math.max(1, viewport.width);
  const viewHeight = Math.max(1, viewport.height);
  return Math.min(viewWidth / mapWidth, viewHeight / mapHeight);
}

function clampScale(scale: number, map: Size, viewport: Size): number {
  const fit = fitScale(map, viewport);
  // `lo` is itself capped at MAX_SCALE so the range can never invert, even for
  // a viewport larger than 8x the map.
  const lo = Math.min(fit, MAX_SCALE);
  if (!Number.isFinite(scale)) {
    // The fit scale put through the same clamp, so NaN can never escape.
    return Math.min(MAX_SCALE, Math.max(lo, fit));
  }
  return Math.min(MAX_SCALE, Math.max(lo, scale));
}

// Two regimes per axis. Larger than the viewport: clamp to the edges, so no
// background gap can open. Smaller: lock to the centred value, so the map never
// floats free.
function clampTranslate(view: View, map: Size, viewport: Size): View {
  const width = map.width * view.scale;
  const height = map.height * view.scale;
  // A non-finite translate would survive both branches below and corrupt every
  // later frame beyond recovery. Treat it as 0 and let the clamp place it.
  const fromX = Number.isFinite(view.x) ? view.x : 0;
  const fromY = Number.isFinite(view.y) ? view.y : 0;

  let x: number;
  if (width <= viewport.width) {
    x = (viewport.width - width) / 2;
  } else {
    x = Math.min(0, Math.max(viewport.width - width, fromX));
  }

  let y: number;
  if (height <= viewport.height) {
    y = (viewport.height - height) / 2;
  } else {
    y = Math.min(0, Math.max(viewport.height - height, fromY));
  }

  return { scale: view.scale, x, y };
}

function clampView(view: View, map: Size, viewport: Size): View {
  const scale = clampScale(view.scale, map, viewport);
  return clampTranslate({ scale, x: view.x, y: view.y }, map, viewport);
}

// The clamp centres both axes at the fit scale, so no separate centring maths
// is needed here.
function fitView(map: Size, viewport: Size): View {
  const scale = clampScale(fitScale(map, viewport), map, viewport);
  return clampTranslate({ scale, x: 0, y: 0 }, map, viewport);
}

function translateTo(view: View, x: number, y: number, map: Size, viewport: Size): View {
  return clampTranslate({ scale: view.scale, x, y }, map, viewport);
}

function screenToMap(view: View, sx: number, sy: number): Point {
  return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
}

function mapToScreen(view: View, mx: number, my: number): Point {
  return { x: mx * view.scale + view.x, y: my * view.scale + view.y };
}

// Order is load-bearing. The anchor is read through the OLD scale, then the
// translation is solved for the CLAMPED NEW scale, so the map point under the
// cursor stays under the cursor. Returning the same object reference when
// nothing changed is part of the contract — the store uses `!==` to skip the
// signal write, and without it a wheel held at the cap repaints forever.
function zoomAt(
  view: View,
  sx: number,
  sy: number,
  factor: number,
  map: Size,
  viewport: Size,
): View {
  if (!Number.isFinite(factor) || factor <= 0) {
    return view;
  }
  const scale = clampScale(view.scale * factor, map, viewport);
  if (scale === view.scale) {
    return view;
  }
  const anchor = screenToMap(view, sx, sy);
  return clampTranslate(
    { scale, x: sx - anchor.x * scale, y: sy - anchor.y * scale },
    map,
    viewport,
  );
}

// `source` is the ART bitmap's size (3652 x 2855), not the map size. Passing
// the map size would ask `drawImage` for a column the bitmap does not have.
//
// The source rect is snapped to whole source pixels and the destination is
// derived from those integers through the same transform, so `dw / sw` is
// exactly `view.scale`. A fractional source rect makes the browser resample
// with a shifting phase, which is what produces shimmer while panning.
function sourceRect(view: View, viewport: Size, source: Size): DrawRect | null {
  if (!Number.isFinite(view.scale) || view.scale <= 0) {
    return null;
  }
  if (!Number.isFinite(view.x) || !Number.isFinite(view.y)) {
    return null;
  }

  const topLeft = screenToMap(view, 0, 0);
  const bottomRight = screenToMap(view, viewport.width, viewport.height);
  if (!Number.isFinite(bottomRight.x) || !Number.isFinite(bottomRight.y)) {
    return null;
  }

  const sx0 = Math.max(0, Math.floor(topLeft.x));
  const sy0 = Math.max(0, Math.floor(topLeft.y));
  const sx1 = Math.min(source.width, Math.ceil(bottomRight.x));
  const sy1 = Math.min(source.height, Math.ceil(bottomRight.y));
  if (sx1 <= sx0 || sy1 <= sy0) {
    return null;
  }

  return {
    sx: sx0,
    sy: sy0,
    sw: sx1 - sx0,
    sh: sy1 - sy0,
    dx: view.x + sx0 * view.scale,
    dy: view.y + sy0 * view.scale,
    dw: (sx1 - sx0) * view.scale,
    dh: (sy1 - sy0) * view.scale,
  };
}

// Decided in DEVICE pixels, not CSS pixels. At scale 0.7 on a 2x display each
// map pixel already covers 1.4 device pixels — that is magnification, and it
// must be nearest-neighbour or the flat province colours turn to mush.
function shouldSmooth(scale: number, dpr: number): boolean {
  return scale * dpr < 1;
}

// Applied at draw time only, never to the stored view — snapping the stored
// view would accumulate rounding across a zoom sequence. `scale` is
// deliberately not quantised; quantising it would make wheel zoom notchy.
function snapView(view: View, dpr: number): View {
  if (!Number.isFinite(dpr) || dpr <= 0) {
    return view;
  }
  if (!Number.isFinite(view.x) || !Number.isFinite(view.y)) {
    return view;
  }
  return {
    scale: view.scale,
    x: Math.round(view.x * dpr) / dpr,
    y: Math.round(view.y * dpr) / dpr,
  };
}

export {
  MAX_SCALE,
  clampScale,
  clampTranslate,
  clampView,
  fitScale,
  fitView,
  mapToScreen,
  screenToMap,
  shouldSmooth,
  snapView,
  sourceRect,
  translateTo,
  zoomAt,
  type DrawRect,
  type Point,
  type Size,
  type View,
};
