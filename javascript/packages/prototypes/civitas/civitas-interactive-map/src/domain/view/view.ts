// Pure view transform: pan, zoom and clamping of the map inside the viewport.
// Units:
// - `scale` is CSS pixels per map pixel, not device pixels.
// - `x` / `y` are the CSS-pixel position of map pixel (0, 0) in the viewport.
// - `dpr` enters only at `snapView` and at draw time.

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

// Defensive floor for `resizeView`. User zoom never reaches it.
// It keeps a preserved scale away from 0, NaN and negative values.
const MIN_SCALE = 0.02;

// `max(1, ...)` keeps a 0-sized viewport or map from producing 0, Infinity or NaN.
function fitScale(map: Size, viewport: Size): number {
  const mapWidth = Math.max(1, map.width);
  const mapHeight = Math.max(1, map.height);
  const viewWidth = Math.max(1, viewport.width);
  const viewHeight = Math.max(1, viewport.height);
  return Math.min(viewWidth / mapWidth, viewHeight / mapHeight);
}

function clampScale(scale: number, map: Size, viewport: Size): number {
  const fit = fitScale(map, viewport);
  // `lo` is capped at MAX_SCALE, so the range never inverts on a huge viewport.
  const lo = Math.min(fit, MAX_SCALE);
  if (!Number.isFinite(scale)) {
    // A non-finite scale falls back to the fit scale.
    return Math.min(MAX_SCALE, Math.max(lo, fit));
  }
  return Math.min(MAX_SCALE, Math.max(lo, scale));
}

// Per axis:
// - map larger than the viewport: clamp to the edges, so no gap opens;
// - map smaller: centre it, so the map never floats.
function clampTranslate(view: View, map: Size, viewport: Size): View {
  const width = map.width * view.scale;
  const height = map.height * view.scale;
  // A non-finite translate would stick forever. Treat it as 0.
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

// The fit scale capped at MAX_SCALE. Equals `clampScale(fitScale(...))`.
function fittedScale(map: Size, viewport: Size): number {
  return Math.min(MAX_SCALE, fitScale(map, viewport));
}

// Exact `===` is safe: `fitScale` is deterministic, and `zoomAt` returns the
// clamp floor itself, so a full zoom-out lands on the fit scale bit for bit.
function isFittedScale(scale: number, map: Size, viewport: Size): boolean {
  return scale === fittedScale(map, viewport);
}

// The clamp centres both axes at the fit scale.
function fitView(map: Size, viewport: Size): View {
  return clampTranslate({ scale: fittedScale(map, viewport), x: 0, y: 0 }, map, viewport);
}

// Clamp for a viewport resize. Unlike `clampView`, it does not floor the scale
// at the fit scale. That floor acts as a ratchet across resizes: grow then
// shrink the viewport, and the scale stays high and the map ends up cropped.
function resizeView(view: View, map: Size, viewport: Size): View {
  let scale: number;
  if (Number.isFinite(view.scale) && view.scale > 0) {
    scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale));
  } else {
    // A non-finite scale becomes the fit scale, as in `clampScale`.
    scale = clampScale(view.scale, map, viewport);
  }
  return clampTranslate({ scale, x: view.x, y: view.y }, map, viewport);
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

// Keeps the map point under the cursor fixed: the anchor uses the old scale,
// the translation uses the clamped new scale.
// Contract: an unchanged view returns the same object. The store skips the
// signal write on `===`, so a wheel held at the cap does not repaint forever.
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

// `source` is the art bitmap size (3652 x 2855), not the map size. The art is
// 1 px narrower than the map.
// The source rect snaps to whole pixels, so `dw / sw` equals `view.scale`
// exactly. A fractional source rect makes the image shimmer while panning.
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

// Decided in device pixels. Any magnification stays nearest-neighbour, so flat
// province colours keep sharp edges.
function shouldSmooth(scale: number, dpr: number): boolean {
  return scale * dpr < 1;
}

// Draw time only. Snapping the stored view would accumulate rounding.
// `scale` is not quantised, so wheel zoom stays smooth.
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
  type DrawRect,
  type Point,
  type Size,
  type View,
};
