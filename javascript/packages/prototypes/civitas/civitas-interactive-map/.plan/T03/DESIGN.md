# T03 — Renderer, zoom and pan — DESIGN

Read `javascript/CLAUDE.md` first. Restated, because every one of these bites here:
`;` on every statement, braces on their own lines for every `if`/`else`/loop, double
quotes only, exactly one grouped named export at the END of each file, one CSS
declaration per line.

`src/scaffold.test.ts` already enforces the export rule over every file in `src/`.
A new file with `export function foo` fails an existing test.

---

## 0. What already exists (do not rebuild)

From T02, all verified and committed:

- `src/state/map-store.ts` — `ensureMapLoaded()` (idempotent, never rejects),
  `getMapAssets()` -> `{ manifest, index, art }` or `null`, `loadPhase`, `mapSize`,
  `provinceAt(x, y)`, `provinceById(id)`.
- `getMapAssets().art` is an `ImageBitmap` of `map.png`, **3652 x 2855**, deliberately
  not closed — it is this task's render source.
- `mapSize.value` is `{ width: 3653, height: 2855 }` — the manifest's size, which is
  `provinces_map.png`'s size. This is the authoritative map size.
- `provinceAt` floors its arguments, so a float from `screenToMap` can be passed
  straight in. It returns `UNPAINTED`-safe results for NaN and Infinity.
- `.root` in `src/index.css` is `height: 100%`. The full-height chain exists.

## 1. Locked decisions

Read these before the file list; several of them are the reason a signature looks the
way it does.

1. **`scale` is CSS pixels per map pixel.** Not device pixels. `MAX_SCALE = 8` therefore
   means 8 CSS px per map pixel, which is 16 device px on a 2x display. Every function in
   `view.ts` works in CSS pixels; `dpr` enters only at `snapView` and at draw time.
2. **Minimum scale is exactly the fit scale**, with no padding:
   `min(viewport.width / map.width, viewport.height / map.height)`. No padding means at
   minimum zoom the map touches two opposite viewport edges, which makes the pan clamp
   trivially correct and makes "fully zoomed out" unambiguous.
3. **Pan clamp has two regimes per axis.** If the scaled map is wider than the viewport,
   `x` is clamped to `[viewport.width - map.width * scale, 0]` so no background gap can
   open at either edge. If it is narrower (which happens on one axis at and near minimum
   zoom), `x` is **locked to the centred value**. The map is never draggable off screen
   and never floats free.
4. **The 1 px width difference is resolved by letterboxing, not stretching.**
   `map.png` is drawn at its native 3652 px width, aligned to map origin (0, 0). A
   stretch to 3653 would resample every column by 0.99973 and lose the pixel-exact
   correspondence with `provinces_map.png` that the whole app depends on. The one
   missing column at map `x = 3652` is filled by re-drawing the art's last column
   (`drawEdgeColumn`, section 5.3) so no background sliver is visible. This is the
   "handle it explicitly rather than letting it drift" the brief asks for.
5. **The source rect is snapped to whole source pixels.** `sourceRect` floors the top-left
   and ceils the bottom-right of the visible map rect. The destination is then derived
   from those integers through the same view transform, so `dw / sw === view.scale`
   exactly and the destination edge is exactly `mapToScreen(view, sx).x`. A fractional
   source rect makes the browser resample with a shifting phase, which is what produces
   shimmer while panning. This is the anti-drift property, and it is unit tested.
6. **The view is snapped to the device pixel grid at draw time only** (`snapView`), never
   in the stored state. Snapping the stored view would accumulate rounding across a zoom
   sequence. Both canvases snap with the same function and the same dpr, so the overlay
   can never disagree with the scene by even a fraction of a pixel.
7. **The view lives in a signal store**, `src/state/view-store.ts`, not in component
   state. T04 (overlay), T07 (labels) and T08 (picking) all need it. This is a third
   source file beyond the two the brief names; it is deliberate and mirrors
   `../civitas-map/src/state/editor-state.ts`.
8. **`view.value` is `View | null`.** There is no meaningful view before both the map
   size and a non-zero viewport are known, and those arrive from two independent async
   sources. `null` is the honest representation; a fake default would render one wrong
   frame.
9. **Repaints are coalesced with a single pending `requestAnimationFrame` handle per
   canvas pair.** Signal changes call `scheduleDraw()`, which is a no-op while a frame is
   already pending. Nothing paints synchronously inside an event handler.
10. **Double-click zoom is instant, not animated.** An eased zoom needs an animation state
    machine that would have to be unwound again when T08 adds click selection. Out of
    scope, recorded in section 9.

## 2. Files

| File | New/changed | Responsibility |
|---|---|---|
| `src/map/view.ts` | new | Pure view transform. No DOM, no canvas, no `window`. Everything below is a pure function of its arguments. |
| `src/map/view.test.ts` | new | Node unit tests for the above. The task's stated gate. |
| `src/state/view-store.ts` | new | Signals holding the view, viewport, dpr and cursor, plus the guarded actions that mutate them. Imports `mapSize` from `map-store`. |
| `src/ui/render.ts` | new | `drawScene` and `drawOverlay`. Takes a `CanvasRenderingContext2D` and plain values; no React, no signals. |
| `src/ui/MapCanvas.tsx` | new | The two stacked canvases, all listeners, the rAF loop, and the temporary HUD. |
| `src/ui/map-canvas.module.css` | new | Host and canvas layout, cursors, HUD chrome. |
| `src/App.tsx` | changed | Body replaced: full-height shell holding `<MapCanvas />` plus a load-status overlay. `ensureMapLoaded()` on mount is **kept**. The probe table, the x/y inputs and the facts list go. |
| `src/app.module.css` | changed | Layout rewritten for a full-bleed canvas. The `.status` rules survive as an overlay panel; `.facts`, `.probes`, `.lookup*` rules are deleted with the markup that used them. |

Nothing else. `rspack.config.mjs`, `package.json`, `tsconfig.json`, `index.html` and
`src/scaffold.test.ts` are untouched. **No new dependency.**

---

## 3. `src/map/view.ts` — public API

```ts
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

const MAX_SCALE: number;                                        // 8

function fitScale(map: Size, viewport: Size): number;
function clampScale(scale: number, map: Size, viewport: Size): number;
function fitView(map: Size, viewport: Size): View;
function clampTranslate(view: View, map: Size, viewport: Size): View;
function clampView(view: View, map: Size, viewport: Size): View;
function translateTo(view: View, x: number, y: number, map: Size, viewport: Size): View;
function zoomAt(
  view: View,
  sx: number,
  sy: number,
  factor: number,
  map: Size,
  viewport: Size,
): View;
function screenToMap(view: View, sx: number, sy: number): Point;
function mapToScreen(view: View, mx: number, my: number): Point;
function sourceRect(view: View, viewport: Size, source: Size): DrawRect | null;
function shouldSmooth(scale: number, dpr: number): boolean;
function snapView(view: View, dpr: number): View;

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
```

`x` / `y` are where map pixel (0, 0) sits inside the viewport, in CSS pixels.

### 3.1 Algorithms

```
fitScale(map, viewport):
  mw = max(1, map.width); mh = max(1, map.height)
  vw = max(1, viewport.width); vh = max(1, viewport.height)
  return min(vw / mw, vh / mh)
```

The `max(1, ...)` guards exist so a degenerate 0-sized viewport yields a small positive
scale rather than `0` or `NaN`. The store still refuses to build a view from a
zero-sized viewport (section 4.2); this is the second line of defence, because a `0`
scale propagates `Infinity` into `screenToMap` and then `NaN` into `provinceAt`.

```
clampScale(scale, map, viewport):
  if scale is not finite: return clampScale(fitScale(map, viewport), map, viewport)
  lo = min(fitScale(map, viewport), MAX_SCALE)
  hi = MAX_SCALE
  return min(hi, max(lo, scale))
```

`lo` is itself capped at `MAX_SCALE` so the range can never invert, even for a viewport
larger than 8 x the map (impossible with this asset, cheap to make impossible in general).

```
clampTranslate(view, map, viewport):
  w = map.width * view.scale
  h = map.height * view.scale
  if w <= viewport.width: x = (viewport.width - w) / 2
  else:                   x = min(0, max(viewport.width - w, view.x))
  same for y with h and viewport.height
  return { scale: view.scale, x, y }
```

`clampView(view, map, viewport)` = `clampTranslate({ scale: clampScale(...), x, y }, ...)`.

`fitView(map, viewport)` = `clampTranslate({ scale: clampScale(fitScale(...)), x: 0, y: 0 }, ...)`
— the clamp centres both axes, so no separate centring maths is needed.

`translateTo(view, x, y, map, viewport)` = `clampTranslate({ scale: view.scale, x, y }, ...)`.

```
screenToMap(view, sx, sy):  { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale }
mapToScreen(view, mx, my):  { x: mx * view.scale + view.x,   y: my * view.scale + view.y }
```

```
zoomAt(view, sx, sy, factor, map, viewport):
  if factor is not finite or factor <= 0: return view          // same reference
  scale = clampScale(view.scale * factor, map, viewport)
  if scale === view.scale: return view                          // same reference
  anchor = screenToMap(view, sx, sy)
  return clampTranslate({ scale, x: sx - anchor.x * scale, y: sy - anchor.y * scale },
                        map, viewport)
```

Order is load-bearing. The anchor is read through the **old** scale, then the
translation is solved for the **clamped new** scale, so the map point under the cursor
stays under the cursor. Computing the anchor after the scale change pins the wrong point.
Clamping the translate afterwards can pull the anchor off the cursor at the map edges;
that is correct and unavoidable — the alternative is a gap.

Returning the *same object reference* when nothing changed is part of the contract: the
store uses `next !== current` to skip a signal write, and without it a wheel held at the
8x cap would repaint every frame forever.

```
sourceRect(view, viewport, source):
  if view.scale is not finite or view.scale <= 0: return null
  topLeft     = screenToMap(view, 0, 0)
  bottomRight = screenToMap(view, viewport.width, viewport.height)
  sx0 = max(0, floor(topLeft.x));            sy0 = max(0, floor(topLeft.y))
  sx1 = min(source.width, ceil(bottomRight.x))
  sy1 = min(source.height, ceil(bottomRight.y))
  if sx1 <= sx0 or sy1 <= sy0: return null
  return {
    sx: sx0, sy: sy0, sw: sx1 - sx0, sh: sy1 - sy0,
    dx: view.x + sx0 * view.scale,
    dy: view.y + sy0 * view.scale,
    dw: (sx1 - sx0) * view.scale,
    dh: (sy1 - sy0) * view.scale,
  }
```

`source` is the **art bitmap's** size (3652 x 2855), not the map size. Passing the map
size would ask `drawImage` for a column the bitmap does not have.

```
shouldSmooth(scale, dpr):  return scale * dpr < 1
```

Smoothing is decided in **device** pixels, not CSS pixels. At `scale = 0.7` on a 2x
display each map pixel already covers 1.4 device pixels — that is magnification, and it
must be nearest-neighbour or the flat province colours in the art turn to mush. A test
that used `scale < 1` would be wrong on every retina display.

```
snapView(view, dpr):
  if dpr is not finite or dpr <= 0: return view
  return { scale: view.scale, x: round(view.x * dpr) / dpr, y: round(view.y * dpr) / dpr }
```

Scale is deliberately **not** quantised. Snapping the scale would make wheel zoom notchy;
snapping only the translation is what stops magnified pixel edges from wobbling during a
pan.

---

## 4. `src/state/view-store.ts`

```ts
type Viewport = { width: number; height: number };

const view: Signal<View | null>;          // null until map size AND a non-zero viewport exist
const viewport: Signal<Viewport>;         // starts { width: 0, height: 0 }
const dpr: Signal<number>;                // starts 1
const cursorMap: Signal<Point | null>;    // integer map pixel under the pointer, or null
const panning: Signal<boolean>;

function setViewport(width: number, height: number): void;
function setDpr(next: number): void;
function syncView(): void;
function zoomAtPoint(sx: number, sy: number, factor: number): void;
function panTo(x: number, y: number): void;
function resetView(): void;
function setCursor(point: Point | null): void;

export {
  cursorMap, dpr, panTo, panning, resetView, setCursor, setDpr, setViewport,
  syncView, view, viewport, zoomAtPoint, type Viewport,
};
```

### 4.1 Rules

- Every action reads `mapSize.value` from `map-store` and `viewport.value`, and **returns
  without writing anything** if the map size is `null` or either viewport dimension is
  `<= 0`.
- Every action compares the new view against the current one field by field and skips the
  signal write when nothing changed. A write always notifies (a fresh object is never
  `Object.is`-equal), so without this guard a ResizeObserver flurry or a wheel at the cap
  repaints forever.
- **No action may be called from inside a `useSignalEffect`.** They write signals they
  also read; a signal effect calling one is a loop. They are called from DOM event
  handlers and from plain `useEffect`s only.

### 4.2 `setViewport` / `syncView`

```
setViewport(width, height):
  if width === viewport.value.width and height === viewport.value.height: return
  viewport.value = { width, height }
  syncView()

syncView():
  size = mapSize.value; port = viewport.value
  if !size or port.width <= 0 or port.height <= 0: return
  current = view.value
  if !current: view.value = fitView(size, port); return
  next = clampView(current, size, port)
  if next differs from current in any field: view.value = next
```

`syncView` is the single initialisation point. It is called from `setViewport` and from a
`useEffect` keyed on `loadPhase === "ready"`, because the viewport and the map size arrive
from two independent async sources and either can be second. Re-clamping on resize is
required: shrinking the window raises the fit scale, and the old scale may now be below
the new minimum.

`setDpr(next)` writes only when the value changed and `next` is finite and `> 0`.
`resetView()` sets `fitView(size, port)`.
`panTo(x, y)` sets `translateTo(current, x, y, size, port)`.
`zoomAtPoint(sx, sy, factor)` sets `zoomAt(current, sx, sy, factor, size, port)`,
relying on the same-reference contract for the no-op case.
`setCursor(point)` writes only when the integer pixel changed, so a pointermove inside one
magnified map pixel does not re-render the HUD.

---

## 5. `src/ui/render.ts`

```ts
type SceneInput = {
  ctx: CanvasRenderingContext2D;
  view: View;
  viewport: Size;
  dpr: number;
  art: ImageBitmap;
  mapSize: Size;
};

type OverlayInput = {
  ctx: CanvasRenderingContext2D;
  view: View;
  viewport: Size;
  dpr: number;
  mapSize: Size;
};

function drawScene(input: SceneInput): void;
function drawOverlay(input: OverlayInput): void;

export { drawScene, drawOverlay, type OverlayInput, type SceneInput };
```

Both functions assume the canvas backing store is already sized (`MapCanvas` owns that,
section 6.3) and both begin by clearing it.

### 5.1 Shared preamble

```
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);       // draw in CSS pixels, back at device resolution
ctx.clearRect(0, 0, viewport.width, viewport.height);
const v = snapView(input.view, dpr);          // both canvases snap identically
```

`setTransform` is used rather than `scale()` so no `save`/`restore` bookkeeping is needed
and a leaked transform from a previous frame cannot accumulate.

### 5.2 `drawScene`

```
const rect = sourceRect(v, viewport, { width: art.width, height: art.height });
if (!rect) { return; }
ctx.imageSmoothingEnabled = shouldSmooth(v.scale, dpr);
ctx.imageSmoothingQuality = "high";
ctx.drawImage(art, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
drawEdgeColumn(...);
```

The 9-argument form is mandatory. At `scale = 8` the source rect is roughly
`viewport / 8` — about 240 x 135 source pixels for a 1920 x 1080 viewport — instead of
3652 x 2855. The 3-argument form under a scaled transform hands the compositor the whole
10.4 MP image on every frame.

### 5.3 `drawEdgeColumn` (private)

The art is 3652 wide; the map is 3653. Column 3652 has no art. Rather than leave a
`scale`-wide background sliver at the right edge, the art's last column is repeated:

```
gap = mapSize.width - art.width;             // exactly 1 for this asset
if (gap <= 0) { return; }
if (rect.sx + rect.sw < art.width) { return; }   // right edge not in view, nothing to fill
ctx.drawImage(
  art,
  art.width - 1, rect.sy, 1, rect.sh,
  v.x + art.width * v.scale, rect.dy, gap * v.scale, rect.dh,
);
```

Guarded on `gap > 0` so a future re-export at the full 3653 width silently does nothing
instead of drawing a stray column.

### 5.4 `drawOverlay`

For T03 the overlay draws exactly one thing: a 1 CSS px hairline around the authoritative
map bounds, in screen space, so it stays one pixel wide at every zoom.

```
const topLeft = mapToScreen(v, 0, 0);
ctx.strokeStyle = "rgba(216, 162, 74, 0.35)";
ctx.lineWidth = 1;
ctx.strokeRect(
  topLeft.x + 0.5, topLeft.y + 0.5,
  mapSize.width * v.scale, mapSize.height * v.scale,
);
```

This is not decoration. It is the instrument that proves the overlay and the scene share
a coordinate system: if the hairline ever detaches from the art edge at any zoom level,
the transforms have diverged. T04 appends border drawing to this function and keeps the
hairline.

---

## 6. `src/ui/MapCanvas.tsx`

```ts
function MapCanvas(): JSX.Element;
export { MapCanvas };
```

### 6.1 Structure

```
<div class={host} ref={hostRef} onPointerDown onPointerMove onPointerUp
     onPointerCancel onPointerLeave onDoubleClick onContextMenu>
  <canvas class={canvas} ref={sceneRef} />
  <canvas class={canvas} ref={overlayRef} />
  <Hud />                                  {/* private, not exported */}
</div>
```

Both canvases are `pointer-events: none`; the host owns every pointer event, so hit
coordinates come from one `getBoundingClientRect()` and cannot disagree between layers.

`useSignals()` is called at the top — the component reads `loadPhase`. `Hud` is a separate
private component that also calls `useSignals()`, so a pointermove re-renders the HUD text
alone and never the canvas host.

### 6.2 The repaint loop

```ts
const frameRef = useRef(0);

function scheduleDraw(): void {
  if (frameRef.current !== 0) {
    return;
  }
  frameRef.current = requestAnimationFrame(() => {
    frameRef.current = 0;
    draw();
  });
}
```

One `useSignalEffect` reads `view.value`, `viewport.value`, `dpr.value` and
`loadPhase.value`, then calls `scheduleDraw()`. It returns **no cleanup** — cancelling the
pending frame on every signal change would mean a wheel burst repeatedly cancels the frame
it just scheduled. The single guarded handle already gives exactly one paint per frame no
matter how many events land.

One `useEffect(() => () => { cancelAnimationFrame(frameRef.current); }, [])` cancels the
pending frame on unmount. `draw()` re-reads both canvas refs and returns early if either
is `null`, so a frame that survives unmount cannot touch a dead node.

`draw()` reads `view.value`, `viewport.value`, `dpr.value` and `getMapAssets()` fresh —
never values captured by the effect closure — so the frame always paints the newest state
rather than the state at the moment it was scheduled.

### 6.3 Canvas sizing

Inside `draw()`, for each canvas:

```
const w = Math.max(1, Math.round(viewport.width * dpr));
const h = Math.max(1, Math.round(viewport.height * dpr));
if (canvas.width !== w) { canvas.width = w; }
if (canvas.height !== h) { canvas.height = h; }
canvas.style.width = viewport.width + "px";
canvas.style.height = viewport.height + "px";
```

The `!==` guards matter: assigning `canvas.width` reallocates the backing store and clears
it even when the value is unchanged. `Math.max(1, ...)` avoids a 0-sized canvas, which
throws in some engines.

### 6.4 ResizeObserver

```ts
useEffect(() => {
  const host = hostRef.current;
  if (!host) {
    return;
  }
  const observer = new ResizeObserver(() => {
    const rect = host.getBoundingClientRect();
    setViewport(rect.width, rect.height);
  });
  observer.observe(host);
  return () => {
    observer.disconnect();
  };
}, []);
```

`getBoundingClientRect` rather than `entry.contentRect`, because the host has no border or
padding and the rect is the number the pointer maths already uses — one source of truth.
`setViewport` ignores a 0 x 0 report (the observer fires with zeros when an ancestor is
`display: none`).

### 6.5 Device pixel ratio

```ts
useEffect(() => {
  let media: MediaQueryList | null = null;
  const update = () => {
    const next = window.devicePixelRatio || 1;
    setDpr(next);
    if (media) {
      media.removeEventListener("change", update);
    }
    media = window.matchMedia("(resolution: " + next + "dppx)");
    media.addEventListener("change", update);
  };
  update();
  return () => {
    if (media) {
      media.removeEventListener("change", update);
    }
  };
}, []);
```

A `resolution` media query only fires when the ratio leaves its current value, so the
listener must be re-armed at the new ratio each time. This fires when the window is
dragged between a retina and a non-retina display, and when the browser zoom changes.

### 6.6 Wheel

A **native** listener on the host with `{ passive: false }`. React's synthetic `onWheel`
is registered passively, so `preventDefault` there is ignored and the page scrolls behind
the zoom.

```ts
const DELTA_TO_PIXELS = [1, 16, 100];      // deltaMode 0 = px, 1 = line, 2 = page
const WHEEL_STEP = 1.0015;

const onWheel = (event: WheelEvent) => {
  event.preventDefault();
  const rect = host.getBoundingClientRect();
  const delta = event.deltaY * (DELTA_TO_PIXELS[event.deltaMode] ?? 1);
  zoomAtPoint(event.clientX - rect.left, event.clientY - rect.top, WHEEL_STEP ** -delta);
};
host.addEventListener("wheel", onWheel, { passive: false });
```

The `deltaMode` conversion is not optional: Firefox reports a notch as `deltaY: 3,
deltaMode: 1`, and treating that as 3 pixels makes each notch a 0.45 % zoom — visually a
dead wheel. A trackpad pinch arrives as `wheel` with `ctrlKey` set and `deltaMode: 0`; the
same path handles it, and `preventDefault` stops the browser's own page zoom.

### 6.7 Pan

```ts
type Gesture =
  | { kind: "idle" }
  | { kind: "pan"; pointerId: number; startX: number; startY: number;
      originX: number; originY: number; moved: boolean };

const DRAG_THRESHOLD = 3;
```

- `pointerdown`, `event.button === 0` only: `setPointerCapture(event.pointerId)`,
  `event.preventDefault()` (stops text selection and the native image drag), and store the
  gesture with `startX/startY` = client coords, `originX/originY` = `view.value.x/y`,
  `moved: false`.
- `pointermove` while panning: `dx = clientX - startX`, `dy = clientY - startY`. If
  `!moved` and `hypot(dx, dy) < DRAG_THRESHOLD`, do nothing. On the frame the threshold is
  crossed, set `moved = true` and **re-base** `startX/startY` to the current client coords,
  so the map does not jump by 3 px. Then `panTo(originX + dx, originY + dy)`.
- `pointerup` / `pointercancel`: release capture, gesture back to `idle`, `panning.value = false`.

The translation is always computed from the gesture origin plus the total delta, never by
accumulating per-move deltas onto the current view. Accumulation drifts, and it fights the
clamp: once the clamp bites, accumulated deltas are silently swallowed and the map does not
follow the pointer back. Origin-relative panning makes the map stick at the edge and pick
the pointer back up in the right place.

`pointermove` also calls `setCursor` with the floored map pixel from
`screenToMap(view.value, clientX - rect.left, clientY - rect.top)`, or `null` when the
point is outside the map bounds. `pointerleave` calls `setCursor(null)`.

### 6.8 Double-click and context menu

`onDoubleClick`: `zoomAtPoint(clientX - rect.left, clientY - rect.top, 2)`. Instant.
`onContextMenu`: `event.preventDefault()`, so a future right-click selection (T08) and any
right-drag do not pop the browser menu.

### 6.9 The HUD (temporary)

A private `Hud` component showing `zoom 137%`, the map pixel under the cursor, and the
province id and name from `provinceAt` / `provinceById`. It is the cheapest instrument for
the "no drift" acceptance check: hover province 1000's centroid (1382, 1329) at 8x and the
HUD must read `1000`. **Mark it in a comment as T03 verification UI that T08 replaces.**

### 6.10 `src/ui/map-canvas.module.css`

```
.host  — position: relative; height: 100%; width: 100%; overflow: hidden;
         contain: strict; touch-action: none; user-select: none;
         cursor: grab; background: var(--bg-sunken);
.host[data-panning="true"] — cursor: grabbing;
.canvas — position: absolute; inset: 0; pointer-events: none;
.hud    — position: absolute; bottom/left offsets; font-family: var(--mono);
          background: var(--bg-panel); border: 1px solid var(--border);
```

`touch-action: none` stops the browser scrolling the page under a touch drag.
`contain: strict` keeps the host out of ancestor layout when the canvas resizes.
One declaration per line, per `javascript/CLAUDE.md`.

---

## 7. `src/App.tsx` changes

Keep: `useSignals()`, `useEffect(() => { ensureMapLoaded(); }, [])`, `statusLine`.
Delete: `PROBE_PIXELS`, `formatId`, the probe `console.info` effect, the facts `<dl>`, the
probe `<table>`, the x/y `<input>` block, and the now-unused imports (`useState`,
`getMapAssets`, `provinceAt`, `provinceById`, `provinceCount`). `noUnusedLocals` is on —
a leftover import fails `yarn typecheck`.

New body: a full-height `.app` containing `<MapCanvas />` always (so the viewport is
measured while the assets are still loading and the first painted frame is already
fitted), plus an absolutely-positioned status panel rendered only while
`loadPhase !== "ready"`. The failed state keeps the existing `data-phase="failed"`
styling and shows `loadError.value`.

`src/app.module.css`: `.app` becomes `position: relative; height: 100%; overflow: hidden`
with no padding, centring or `gap`. `.status` becomes an absolutely centred overlay panel.
Delete `.title`, `.facts*`, `.probes*`, `.lookup*` — their markup is gone and dead CSS
rots.

---

## 8. Unit tests — `src/map/view.test.ts`

Node's runner, `node:test` + `node:assert/strict`, imports **only** `./view`. No DOM.
Use a fixed map of `{ width: 3653, height: 2855 }` and viewports of `{ 1200, 800 }` and
`{ 900, 900 }` so both fit axes are exercised. Float comparisons use a helper with a
`1e-9` epsilon.

Required cases:

1. `screenToMap` and `mapToScreen` round-trip at scales 0.1, 1 and 8.
2. `fitScale` is `min(vw/mw, vh/mh)`; asserted against both a wide and a tall viewport.
3. `fitView` centres the map: the map centre maps to the viewport centre on both axes,
   and the fitting axis has zero slack.
4. `clampScale` floors at the fit scale and caps at `MAX_SCALE === 8`.
5. `clampScale` never inverts its range: a viewport 20x the map still returns `8`.
6. `clampScale(NaN)` returns the fit scale rather than `NaN`.
7. `clampTranslate` on an axis larger than the viewport: `x === 0` is the far-left limit,
   `x === viewport.width - map.width * scale` is the far-right limit, and a value past
   either end is pulled back to it.
8. `clampTranslate` on an axis smaller than the viewport centres exactly, and a large
   positive and a large negative input both land on the same centred value.
9. **Zoom pins the cursor**: for a view mid-range and a cursor at (400, 300),
   `screenToMap(zoomAt(...), 400, 300)` equals `screenToMap(view, 400, 300)` within
   epsilon. Test at factor 1.2 and 1/1.2.
10. `zoomAt` returns the **same reference** when the scale is already at `MAX_SCALE` and
    the factor is `> 1`, and again at the fit scale with a factor `< 1`.
11. `zoomAt` with a non-finite or non-positive factor returns the same reference.
12. **No drift**: 200 alternating `zoomAt(+1.1)` / `zoomAt(1/1.1)` calls at the same cursor
    return to the starting scale within `1e-6` and to the starting `x`/`y` within `1e-6`.
13. Zooming out repeatedly always terminates at exactly the fit scale and a centred view.
14. `sourceRect` produces **integer** `sx`, `sy`, `sw`, `sh`.
15. `sourceRect` destination agrees with the transform: `dx === mapToScreen(view, sx, 0).x`
    and `dw / sw === view.scale` within epsilon. Same for the y axis.
16. **No uncovered strip**: for a clamped view whose scaled map exceeds the viewport,
    `dx <= 0`, `dy <= 0`, `dx + dw >= viewport.width`, `dy + dh >= viewport.height`.
17. `sourceRect` clamps to the source: with the map fully visible it returns the whole
    source, never a negative `sx` and never `sw > source.width`.
18. `sourceRect` returns `null` for a zero, negative or non-finite scale, and for a view
    that puts the source entirely off screen.
19. `sourceRect` with `source = { 3652, 2855 }` against a map of 3653 never asks for
    column 3652 — `sx + sw <= 3652` even when the view is panned hard right.
20. `shouldSmooth` is `true` at `scale 0.5, dpr 1`, `false` at `scale 0.5, dpr 2`,
    `false` at `scale 1, dpr 1`, `true` at `scale 0.4, dpr 2`.
21. `snapView` puts `x * dpr` and `y * dpr` on whole integers for dpr 1, 2 and 1.25, and
    leaves `scale` untouched.
22. Degenerate viewport `{ 0, 0 }`: `fitScale`, `fitView`, `clampView` and `sourceRect`
    all return finite values or `null`, never `NaN` and never `Infinity`.

Before claiming done, mutate the source and confirm the suite bites — at minimum:
swap the `floor`/`ceil` in `sourceRect`, move the anchor read in `zoomAt` after the
scale change, drop the `dpr` factor from `shouldSmooth`, and change the small-axis branch
of `clampTranslate` to a free clamp. Each must fail at least one test. Restore afterwards
and confirm `git diff` on `view.ts` is empty.

---

## 9. Edge cases and failure modes

1. **Zero-sized viewport.** ResizeObserver fires 0 x 0 when an ancestor is hidden.
   `setViewport` must not build a view from it, `draw()` must not size a canvas to 0, and
   the previously good view must survive so the map is where it was when the panel reopens.
2. **The load finishing after the viewport is measured, or before.** Both orders happen.
   `syncView` is called from both paths; neither may assume the other ran.
3. **Resize below the current scale's fit.** Shrinking the window raises the fit scale.
   Without the re-clamp in `syncView` the map ends up smaller than the viewport with the
   old translate, and a gap appears on two edges.
4. **NaN reaching the view.** A non-finite wheel delta or factor must be rejected at
   `zoomAt` (case 11). A `NaN` in `view.x` corrupts every later frame and cannot be
   recovered from without a reload.
5. **The scale cap reached with the wheel still turning.** Must be a no-op with no signal
   write, or the app repaints at 60 fps while the wheel spins and the view visibly jitters
   from floating-point noise.
6. **The 1 px art/map width difference.** `sourceRect` takes the art size; the map bounds
   hairline and every screen<->map conversion take the map size. Mixing them puts a
   `drawImage` source rect one column past the bitmap, which draws nothing at all in some
   browsers and throws `IndexSizeError` in others.
7. **A rAF callback firing after unmount.** Cancel on unmount and re-check both refs
   inside the callback.
8. **`canvas.width` assigned every frame.** Clears the backing store and reallocates.
   Guard with `!==`.
9. **Pointer capture never released** because `pointerup` was missed (alt-tab during a
   drag). Handle `pointercancel` and `lostpointercapture`; leaving `panning.value === true`
   sticks the `grabbing` cursor forever.
10. **React's passive `onWheel`.** The page scrolls behind the map and the zoom fights it.
    Native listener with `{ passive: false }` only.
11. **`dblclick` after a pan.** A double-click that follows a drag zooms at the release
    point, which is correct; the 3 px threshold means a shaky double-click does not also
    pan the map by a pixel or two first.
12. **Overlay/scene divergence.** Both canvases must snap with the same `snapView(view,
    dpr)` result and be sized from the same viewport and dpr in the same `draw()` call.
    Splitting them across two rAF callbacks lets them paint one frame apart, which reads
    as the border sliding against the art during a pan.
13. **The whole map visible at fit scale.** `sourceRect` then returns the entire 3652 x
    2855 source every frame. That is unavoidable and fine — the source-rect win is at high
    zoom. Do not "optimise" it with an offscreen mip; that is not in this task.

---

## 10. Verification before claiming done

From `javascript/packages/prototypes/civitas/civitas-interactive-map`:

```bash
yarn typecheck          # exit 0, no output
yarn test               # 81 existing + the new view tests, 0 fail
yarn build              # exit 0; the two pre-existing asset-size warnings are expected
grep -rn "'" src/       # only apostrophes inside comments and double-quoted strings
```

Then the real map, because the view maths passing does not prove the canvas is wired to it:

```bash
yarn dev                # note the printed port
```

In the browser (foreground the tab — a hidden Chrome tab renders no frames, so
animation cannot be judged from a background tab, and `resize_window` on the Chrome
MCP is a no-op; drive resize by setting a fixed width on `.root` from the console
instead):

1. The map appears fitted and centred with no scrollbars, and the console is clean.
2. Wheel up over a recognisable feature — the feature stays under the cursor all the way
   to 8x. Wheel down — it returns to fit and stops there.
3. At 8x the province colours in the art are crisp with hard pixel edges, not blurred.
4. Drag to each of the four edges. The map stops with its edge flush to the viewport
   edge; no background shows past it, and the bounds hairline sits exactly on the art
   edge at every zoom level.
5. Double-click zooms in toward the clicked point.
6. Set `document.querySelector(".root").style.width = "600px"` from the console. The
   canvas re-fits without stretching or blurring, and the map stays inside its bounds.
   Restore.
7. HUD check at 8x: hover map pixel (1382, 1329) — the HUD must read province `1000`.
   Repeat at (598, 391) -> `1`, and (0, 0) -> none. A wrong id here means the screen->map
   transform has drifted, and it is the single most valuable check in this list.
8. Pan continuously for several seconds at 4x and watch the map edge and the hairline —
   no tearing, no shimmer, no sub-pixel crawl.
9. Unmount check: no listener leak. `getEventListeners(window)` gains nothing across a
   navigation, and the observer is disconnected.

Record the real output of every command and the browser observations in `memory.md`, as
T01 and T02 did.

---

## 11. Explicitly NOT part of this task

- **Border extraction and border rendering.** T04. `drawOverlay` exists and draws the
  bounds hairline only; do not scan the province bitmap here.
- **Hover highlight and selection.** T08. The HUD reads `provinceAt` to prove the
  transform, and that is all — no selection state, no highlight fill, no click handling
  beyond pan and double-click zoom.
- **Country tinting, labels, panels, the UI shell.** T06, T07, T08+.
- **Persisting the view across reloads.** T05 owns `localStorage`.
- **Animated / eased zoom** on double-click or wheel, and keyboard zoom shortcuts.
- **Pinch-to-zoom with two touch pointers**, and middle-button or space-bar panning.
  Single-pointer drag and wheel only.
- **A tile cache, an offscreen mip pyramid, or `OffscreenCanvas`.** The source-rect
  `drawImage` is the whole optimisation this task is asked for.
- **Rendering `provinces_map.png`.** It stays a lookup table; only `map.png` is drawn.
- **Rotation.** The transform is scale plus translate, permanently.
- **DOM, canvas or React tests.** PLAN section 4 forbids them and there is no jsdom in the
  repo. The browser checklist in section 10 is their gate.
