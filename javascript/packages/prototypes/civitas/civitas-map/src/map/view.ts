// The view is the map -> screen transform: a uniform scale plus a translation,
// no rotation. `x`/`y` are where map pixel (0,0) sits in the canvas, in CSS
// pixels. Every screen coordinate the editor takes from a pointer event goes
// back through `screenToMap`, and paint coordinates are floored from there.

type View = {
  scale: number;
  x: number;
  y: number;
};

type Size = {
  width: number;
  height: number;
};

const MIN_SCALE = 0.02;
const MAX_SCALE = 32;

function clampScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale));
}

function screenToMap(view: View, sx: number, sy: number): { x: number; y: number } {
  return {
    x: (sx - view.x) / view.scale,
    y: (sy - view.y) / view.scale,
  };
}

function mapToScreen(view: View, mx: number, my: number): { x: number; y: number } {
  return {
    x: mx * view.scale + view.x,
    y: my * view.scale + view.y,
  };
}

// Zooming keeps the map point under the cursor pinned to the cursor, which is
// what makes wheel zoom feel like it is aimed rather than centred.
function zoomAt(view: View, sx: number, sy: number, factor: number): View {
  const scale = clampScale(view.scale * factor);
  const anchor = screenToMap(view, sx, sy);

  return {
    scale,
    x: sx - anchor.x * scale,
    y: sy - anchor.y * scale,
  };
}

function fit(map: Size, viewport: Size, padding = 24): View {
  const usableWidth = Math.max(1, viewport.width - padding * 2);
  const usableHeight = Math.max(1, viewport.height - padding * 2);
  const scale = clampScale(Math.min(usableWidth / map.width, usableHeight / map.height));

  return {
    scale,
    x: (viewport.width - map.width * scale) / 2,
    y: (viewport.height - map.height * scale) / 2,
  };
}

export { MAX_SCALE, MIN_SCALE, clampScale, fit, mapToScreen, screenToMap, zoomAt, type View };
