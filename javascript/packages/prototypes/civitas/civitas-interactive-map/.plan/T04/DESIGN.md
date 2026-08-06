# T04 — Border extraction and rendering — DESIGN

Read `javascript/CLAUDE.md` and `.plan/PLAN.md` sections 2-4 first. This design assumes
T01-T03 as shipped: `src/map/view.ts`, `src/map/province-index.ts`, `src/state/map-store.ts`,
`src/state/view-store.ts`, `src/ui/render.ts`, `src/ui/MapCanvas.tsx`.

---

## 0. Measured facts (I measured these; do not re-derive them)

Decoded `assets/provinces_map.png` in Node and ran the scan described below over the real
3653 x 2855 bitmap:

| Fact | Value |
|---|---|
| border pixels (differs from right or bottom neighbour) | **180 869** |
| of those, the marked pixel is painted land | 159 993 |
| vertical crossings (right neighbour differs) | **103 835** |
| horizontal crossings (bottom neighbour differs) | **111 342** |
| vertical runs after collinear merging | **66 074** |
| horizontal runs after collinear merging | **66 116** |
| province-to-province crossings | 165 689 |
| crossings against unpainted (coastline) | 49 488 |
| opaque pixels with a colour absent from the manifest | **0** |
| largest province bounding box, in pixels | **12 642** (median 2 960) |
| max province id | 1650, for 1648 provinces (1318 and 1458 absent) |

These five bold numbers are the regression pins the unit tests must assert (section 8.4).

### Rendering benchmark (real browser, real geometry, 1728 x 906 viewport)

I built the 132 190 merged runs into `Path2D` objects and timed three candidate render
paths, amortising the GPU readback across 20 iterations. `dpr 2` means a 3456 x 1812
backing store; the test machine reports `devicePixelRatio` 1, so those rows are an
upper bound on backing-store cost rather than a true retina measurement.

```
dpr 1 scale  0.317  clearOnly 0.54  wholeStroke  0.87  tiledStroke  0.93  maskBlit 14.94
dpr 1 scale  0.500  clearOnly 0.04  wholeStroke  1.51  tiledStroke  1.43  maskBlit 18.55
dpr 1 scale  1.000  clearOnly 0.03  wholeStroke  1.16  tiledStroke  0.78  maskBlit  3.74
dpr 1 scale  2.000  clearOnly 0.03  wholeStroke  0.79  tiledStroke  0.21  maskBlit  3.92
dpr 1 scale  8.000  clearOnly 0.03  wholeStroke  0.71  tiledStroke  0.04  maskBlit  4.44
dpr 2 scale  0.317  clearOnly 0.10  wholeStroke 32.15  tiledStroke  8.70  maskBlit 42.45
dpr 2 scale  0.500  clearOnly 0.11  wholeStroke 31.91  tiledStroke  9.14  maskBlit 15.46
dpr 2 scale  1.000  clearOnly 0.10  wholeStroke 10.79  tiledStroke  5.46  maskBlit 15.58
dpr 2 scale  2.000  clearOnly 0.11  wholeStroke  4.08  tiledStroke  1.54  maskBlit 15.28
dpr 2 scale  8.000  clearOnly 0.10  wholeStroke  4.55  tiledStroke  0.30  maskBlit 12.42
```

One-time build costs: whole-map `Path2D` 3.6 ms, 180 tiled `Path2D` 5.7 ms, mask
`ImageData` + `ImageBitmap` 13.0 ms.

**Conclusion: stroke merged runs, tiled and culled. Do not render a mask bitmap.**
Tiled stroking is the fastest option at every zoom above the fit scale and is within
1 ms of the best at the fit scale, and unlike a bitmap blit it can hold a constant
screen-space width. Section 3 explains the width decision that this settles.

---

## 1. The stroke-width decision — screen space, and why

**Stroke width is in SCREEN space. A province border is 1.0 CSS px and a country border
is 2.25 CSS px at every zoom level, from the 0.317 fit scale to the 8x cap.**

The alternative is map space — a border N map pixels wide, scaled with the view. Reject it:
the zoom range is 25x (`fitScale` 0.317 to `MAX_SCALE` 8), so a 1-map-pixel border is
0.32 CSS px at the fit scale, where it drops below one device pixel and breaks into a
dashed line, and 8 CSS px at the zoom cap, where it is fatter than the province blocks it
is supposed to separate. There is no N that works at both ends.

This choice is what forces the render path. A bitmap mask blitted through the view
transform necessarily has map-space width — scaling a bitmap scales its features. Only a
stroked path can carry a width that is independent of the transform, via the standard
trick: set the transform to map -> screen and set `lineWidth = widthCss / view.scale`,
so the width comes out `widthCss` CSS pixels on screen.

Secondary benefits of stroking, which is why the mask is not kept as a zoomed-out fallback:

- **Placement is symmetric.** The literal rule in the brief marks the pixel on the
  up-left side of each boundary, so the line sits inside one of the two provinces. A
  stroked segment is centred on the shared grid line and straddles both equally.
  The *crossing set* is identical either way — only the geometry differs (section 4.2).
- **One code path.** A blit-below / stroke-above hybrid pops at the crossover, both in
  width and in the half-map-pixel placement difference, and doubles the test surface.
- It is measurably faster (table above) and needs no 10.4 MB mask and no 41 MB
  `ImageBitmap` upload.

The mask is still what the extraction *conceptually* produces; `scanBorders` returns
`borderPixels` so the mask's size is pinned by a test, and a mask can be reconstructed
from the runs in a few lines if a later task ever needs one.

---

## 2. Files

### Created

| File | Responsibility |
|---|---|
| `src/map/borders.ts` | **All the logic, pure, no DOM, no worker globals.** Packed-RGB -> province-id conversion, the single-pass border scan, the cheap country-border recompute, tile bucketing, and the visible-tile range. Unit tested. |
| `src/map/borders.test.ts` | Node tests over hand-built synthetic bitmaps, plus the five real-asset pins from section 0. |
| `src/map/borders.worker.ts` | Thin worker shell. Owns the retained scan state, decodes the two request kinds, calls `borders.ts`, and transfers the results back. No logic of its own. |
| `src/state/borders-store.ts` | Worker lifecycle, signals for phase/error/stats, a `bordersVersion` counter, the built `Path2D` sets as plain module variables, `setCountryAssignment` for T06, and the T04-only demo assignment. |
| `src/state/selection-store.ts` | `hoveredProvinceId` / `selectedProvinceId` signals and their guarded setters. T08 extends this file; it does not replace it. |
| `src/ui/border-layer.ts` | Builds `Path2D` per tile from a `BorderTiles`, and strokes the visible tiles under the map transform. |
| `src/ui/highlight-layer.ts` | Builds and caches a per-province RGBA stamp from the province bitmap, and draws it aligned to the map grid. |

### Changed

| File | Change |
|---|---|
| `src/ui/render.ts` | `OverlayInput` gains four **optional** fields; `drawOverlay` draws highlights, then province borders, then country borders, then the existing bounds hairline. Existing behaviour with the fields omitted is byte-identical, so `src/ui/render.test.ts` keeps passing unchanged. |
| `src/ui/render.test.ts` | New cases for the added draw order and the pass-through of the snapped view. Do not weaken the existing ones. |
| `src/ui/MapCanvas.tsx` | Calls `ensureBordersScanned()`, feeds the new `drawOverlay` fields, sets `hoveredProvinceId` on pointer move and `selectedProvinceId` on a non-drag left click, subscribes the draw effect to the new signals, and extends the HUD with border phase / scan ms / segment count and the demo-country toggle. |
| `src/ui/map-canvas.module.css` | Styles for the two new HUD controls. One declaration per line. |

Nothing else. Do not touch `rspack.config.mjs` (worker support is built in — verified,
section 7.1), `package.json`, `tsconfig.json`, `assets/`, or `../civitas-map`.

**No new dependency.**

---

## 3. `src/map/borders.ts` — public API

```ts
type BorderRuns = {
  // 3 int32 per run: [x, y0, y1]. The boundary between map columns x and x + 1,
  // covering pixel rows y0..y1 inclusive.
  vertical: Int32Array;
  // 3 int32 per run: [y, x0, x1]. The boundary between map rows y and y + 1,
  // covering pixel columns x0..x1 inclusive.
  horizontal: Int32Array;
};

type BorderCrossings = {
  // Pixel indices (y * width + x) of every pixel whose RIGHT neighbour differs.
  // Ascending, i.e. row-major order. Retained by the worker; never posted.
  vertical: Uint32Array;
  // Pixel indices of every pixel whose BOTTOM neighbour differs. Ascending.
  horizontal: Uint32Array;
};

type BorderScan = {
  width: number;
  height: number;
  runs: BorderRuns;
  crossings: BorderCrossings;
  // Pixels with at least one crossing. The size of the equivalent Uint8Array mask.
  borderPixels: number;
};

type BorderTiles = {
  tileSize: number;
  cols: number;
  rows: number;
  // 4 float32 per segment: x0, y0, x1, y1, in MAP coordinates. Grouped by tile.
  data: Float32Array;
  // Length cols * rows + 1. Tile t owns data[offsets[t] .. offsets[t + 1]).
  // Offsets are in FLOATS, not segments.
  offsets: Uint32Array;
};

type TileRange = { c0: number; c1: number; r0: number; r1: number };

const TILE_SIZE: number;          // 256
const NO_PROVINCE: number;        // 0

function mapPixelsToIds(
  packed: Uint32Array,
  paletteColors: Uint32Array,
  paletteIds: Uint16Array,
): Uint16Array;

function scanBorders(ids: Uint16Array, width: number, height: number): BorderScan;

function countryRuns(
  ids: Uint16Array,
  width: number,
  crossings: BorderCrossings,
  countryOf: Uint16Array,
): BorderRuns;

function buildBorderTiles(
  runs: BorderRuns,
  width: number,
  height: number,
  tileSize?: number,
): BorderTiles;

function visibleTiles(
  view: View,
  viewport: Size,
  tiles: { tileSize: number; cols: number; rows: number },
): TileRange | null;

function buildCountryOf(
  assignments: ReadonlyMap<number, number>,
  maxProvinceId: number,
): Uint16Array;

export {
  NO_PROVINCE,
  TILE_SIZE,
  buildBorderTiles,
  buildCountryOf,
  countryRuns,
  mapPixelsToIds,
  scanBorders,
  visibleTiles,
  type BorderCrossings,
  type BorderRuns,
  type BorderScan,
  type BorderTiles,
  type TileRange,
};
```

`View` and `Size` are imported from `./view`. Everything here is a pure function of its
arguments — the file must import nothing from `react`, `@preact/signals-react`, the DOM,
or the stores, so `borders.test.ts` can run it under Node.

---

## 4. Algorithms

### 4.1 `mapPixelsToIds`

Input: the 10.4 M-entry packed `0x00RRGGBB` bitmap from `ProvinceIndex.pixels` (with
`UNPAINTED === 0xffffffff`), plus the colour index flattened into two parallel arrays.

A `Map` lookup per pixel costs 150-250 ms. Use a direct lookup table instead: packed
colours occupy 24 bits, so `new Uint16Array(1 << 24)` (33.5 MB, calloc'd, transient) is a
single indexed read per pixel.

```
lut = new Uint16Array(1 << 24)
for k in 0..paletteColors.length: lut[paletteColors[k] & 0xffffff] = paletteIds[k]
out = new Uint16Array(packed.length)
for i: p = packed[i]; out[i] = p > 0xffffff ? 0 : lut[p]
```

`p > 0xffffff` catches `UNPAINTED` without a named comparison. An opaque colour absent
from the palette maps to `lut[...] === 0`, i.e. `NO_PROVINCE` — the same treatment as
unpainted. Measured: 0 such pixels in the shipped asset. `lut` must go out of scope so it
is collected; do not retain it.

### 4.2 `scanBorders` — one row-major pass

The brief's rule: a pixel is a border pixel when its province id differs from the id of
its right neighbour or its bottom neighbour. That defines a set of **crossings**, each
crossing being an edge of the pixel grid. This function emits the crossings both as
pixel-index lists (retained, for cheap country recompute) and as collinear-merged runs
(posted, for rendering), in a single pass.

Vertical runs extend down a column, which is cache-hostile if scanned column-major, so
the pass keeps one open-run start per column and closes it when the column's crossing
breaks. Horizontal runs extend along a row, so one scalar suffices.

```
openV = new Int32Array(width).fill(-1)      // open vertical run start row, per column
openH = -1                                  // open horizontal run start column
borderPixels = 0

for y in 0..height-1:
  row = y * width
  hasDown = y + 1 < height
  for x in 0..width-1:
    i = row + x
    a = ids[i]
    hit = false

    if x + 1 < width:
      if ids[i + 1] !== a:
        vCross.push(i); hit = true
        if openV[x] < 0: openV[x] = y
      else if openV[x] >= 0:
        vRuns.push(x, openV[x], y - 1); openV[x] = -1

    if hasDown and ids[i + width] !== a:
      hCross.push(i); hit = true
      if openH < 0: openH = x
    else if openH >= 0:
      hRuns.push(y, openH, x - 1); openH = -1

    if hit: borderPixels += 1

  if openH >= 0: hRuns.push(y, openH, width - 1); openH = -1

for x in 0..width-1:
  if openV[x] >= 0: vRuns.push(x, openV[x], height - 1); openV[x] = -1
```

Notes that are load-bearing:

- **The map edge is not a border.** Column `width - 1` has no right neighbour and row
  `height - 1` has no bottom neighbour, so neither produces a crossing. `drawOverlay`'s
  existing bounds hairline already draws the map outline.
- **`NO_PROVINCE` participates.** A painted pixel next to an unpainted one differs, so
  the coastline is a province border. Two unpainted neighbours are equal, so the open sea
  produces nothing. 49 488 of the 215 177 crossings are coastline.
- `openH` must be closed at the end of every row, otherwise a run leaks into the next row
  and produces a segment that spans the whole map.
- The four output arrays have unknown length. Use a private growable builder (backing
  `Int32Array` / `Uint32Array`, capacity doubling from `1 << 16`) and compact with
  `.slice(0, length)` at the end, so each returned typed array owns its whole buffer and
  is transferable.

**Segment geometry.** A run is turned into a line on the pixel grid, not into a set of
marked pixels:

- vertical run `(x, y0, y1)` -> the segment from map `(x + 1, y0)` to `(x + 1, y1 + 1)`
- horizontal run `(y, x0, x1)` -> the segment from map `(x0, y + 1)` to `(x1 + 1, y + 1)`

Both endpoints are integers, so a `Float32Array` holds them exactly (integers are exact
below 2^24). The line is the shared edge between the two provinces, which is why the
stroke straddles both equally.

### 4.3 `countryRuns` — the cheap recompute

A country boundary can only exist where two different provinces meet, so it is always a
subset of the crossing set. Recomputing it walks the ~215 k retained crossings instead of
rescanning 10.4 M pixels: about 50x less work, a few milliseconds.

`countryOf` is indexed by **province id**, length at least `maxProvinceId + 1`, `0` meaning
unassigned. `countryOf[0]` must be 0 — index 0 is `NO_PROVINCE`, not a province. Read
defensively: `pid < countryOf.length ? countryOf[pid] : 0`.

Both crossing lists are ascending by pixel index, so within a fixed column the vertical
crossings arrive in increasing `y`, and within a fixed row the horizontal crossings arrive
in increasing `x`. Runs are therefore rebuilt by tracking the previous kept coordinate and
starting a new run whenever it is not adjacent.

```
// vertical
start = new Int32Array(width).fill(-1)
last  = new Int32Array(width).fill(-2)
for i in crossings.vertical:
  x = i % width; y = (i / width) | 0
  if countryAt(ids[i]) === countryAt(ids[i + 1]): continue
  if start[x] < 0 or last[x] !== y - 1:
    if start[x] >= 0: emit(x, start[x], last[x])
    start[x] = y
  last[x] = y
for x: if start[x] >= 0: emit(x, start[x], last[x])

// horizontal — same shape with one open run, keyed on (openY, lastX)
for i in crossings.horizontal:
  x = i % width; y = (i / width) | 0
  if countryAt(ids[i]) === countryAt(ids[i + width]): continue
  if openX < 0 or openY !== y or lastX !== x - 1:
    if openX >= 0: emit(openY, openX, lastX)
    openX = x; openY = y
  lastX = x
if openX >= 0: emit(openY, openX, lastX)
```

Run order in the output differs from `scanBorders` (vertical runs are flushed per column
at the end). Nothing depends on run order; tests must compare run **sets**, not arrays.

**Property that must be tested:** with the identity assignment (`countryOf[p] = p` for
every province, `countryOf[0] = 0`), `countryRuns` returns exactly the run set
`scanBorders` produced.

### 4.4 `buildBorderTiles`

A counting sort into a `tileSize`-square grid over the map, with segments **split** at
tile boundaries rather than duplicated, so culling is exact and there is no overdraw.
Average run length is 1.63 pixels, so splits are rare and the segment count barely grows.

Tile assignment, all integer arithmetic — no epsilons:

- vertical run `(x, y0, y1)`: column `clamp(floor((x + 1) / T), 0, cols - 1)`, rows
  `floor(y0 / T)` .. `floor(y1 / T)`. For tile row `r` the clipped segment is
  `yA = max(y0, r * T)`, `yB = min(y1 + 1, (r + 1) * T)`; emit only if `yB > yA`.
- horizontal run `(y, x0, x1)`: row `clamp(floor((y + 1) / T), 0, rows - 1)`, columns
  `floor(x0 / T)` .. `floor(x1 / T)`. For tile column `c`, `xA = max(x0, c * T)`,
  `xB = min(x1 + 1, (c + 1) * T)`.

Two passes: pass one counts segments per tile, a prefix sum builds `offsets`, pass two
fills `data`. `offsets` is in floats (`4 *` the segment count) so a caller can slice
directly.

A boundary line that lands exactly on a tile edge is assigned to the higher-index tile.
`visibleTiles` compensates by widening the range (below).

### 4.5 `visibleTiles`

```
if !isFinite(view.scale) or view.scale <= 0: return null
left   = -view.x / view.scale
top    = -view.y / view.scale
right  = (viewport.width  - view.x) / view.scale
bottom = (viewport.height - view.y) / view.scale
c0 = clamp(floor(left  / T) - 1, 0, cols - 1)
c1 = clamp(floor(right / T) + 1, 0, cols - 1)
r0 = clamp(floor(top    / T) - 1, 0, rows - 1)
r1 = clamp(floor(bottom / T) + 1, 0, rows - 1)
return c0 > c1 or r0 > r1 ? null : { c0, c1, r0, r1 }
```

The `-1` / `+1` widening is not cosmetic. A stroke is centred on its line, so half its
width spills into the neighbouring tile; and a line exactly on a tile edge belongs to the
higher tile. Without the margin, a border along the very edge of the viewport flickers in
and out during a pan.

### 4.6 `buildCountryOf`

```
out = new Uint16Array(maxProvinceId + 1)
for [provinceId, countryId] of assignments:
  if provinceId >= 1 and provinceId <= maxProvinceId: out[provinceId] = countryId
out[0] = 0
return out
```

Ids are not contiguous (1318 and 1458 do not exist), so the array is sized by the maximum
id and the holes stay 0. Never index provinces by array position.

---

## 5. `src/map/borders.worker.ts`

`tsconfig` sets `lib: ["ES2024", "DOM", "DOM.Iterable"]` with no `WebWorker`, so `self` is
typed as a window. Narrow it locally exactly as `../civitas-map/src/map/detect-worker.ts`
does — do not add a second tsconfig.

```ts
type ScanRequest = {
  kind: "scan";
  requestId: number;
  pixels: ArrayBuffer;        // Uint32Array copy of ProvinceIndex.pixels — TRANSFERRED
  width: number;
  height: number;
  paletteColors: ArrayBuffer; // Uint32Array — TRANSFERRED
  paletteIds: ArrayBuffer;    // Uint16Array — TRANSFERRED
  tileSize: number;
};

type CountriesRequest = {
  kind: "countries";
  requestId: number;
  countryOf: ArrayBuffer | null;  // Uint16Array by province id, or null to clear
};

type BorderRequest = ScanRequest | CountriesRequest;

type BorderStats = {
  borderPixels: number;
  verticalRuns: number;
  horizontalRuns: number;
  segments: number;
  elapsedMs: number;
};

type BorderResponse =
  | { kind: "scan"; ok: true; requestId: number; tiles: BorderTiles; stats: BorderStats }
  | { kind: "countries"; ok: true; requestId: number; tiles: BorderTiles | null; stats: BorderStats }
  | { kind: "error"; requestId: number; message: string };
```

Retained between messages, in module scope:

```ts
let ids: Uint16Array | null = null;          // 20.9 MB, alive for the worker's life
let crossings: BorderCrossings | null = null; // ~0.9 MB
let mapWidth = 0, mapHeight = 0, tileSize = 256;
```

`scan` handler: `mapPixelsToIds` -> `scanBorders` -> retain `ids` and `crossings` ->
`buildBorderTiles(scan.runs, ...)` -> post. The packed copy is dropped after conversion.

`countries` handler: return `{ tiles: null }` when `countryOf` is null or `ids` is null;
otherwise force `countryOf[0] = 0`, `countryRuns(...)` -> `buildBorderTiles(...)` -> post.
A `countries` message arriving before the scan finished is impossible (messages are
ordered), but the `ids === null` guard covers a failed scan.

Everything runs inside `try / catch`; a throw becomes an `error` response. The worker never
lets an exception escape, because an unhandled worker error surfaces as an opaque
`ErrorEvent` with no message in some browsers.

Transfer list on every post: `[tiles.data.buffer, tiles.offsets.buffer]`.

`export { type BorderRequest, type BorderResponse, type BorderStats, type ScanRequest, type CountriesRequest };`
— a grouped export with inline `type` modifiers. `export type { ... }` at the start of a
line fails `src/scaffold.test.ts`'s convention check.

---

## 6. Main thread

### 6.1 `src/state/borders-store.ts`

Follows T02's rule: signals carry status, big objects are plain module variables.

```ts
type BorderPhase = "idle" | "scanning" | "ready" | "failed";

const borderPhase: Signal<BorderPhase>;
const borderError: Signal<string | null>;
const borderStats: Signal<BorderStats | null>;
const countryBorderStats: Signal<BorderStats | null>;
// Bumped whenever either Path2D set is replaced. The draw effect subscribes to this
// instead of to the paths, which are identity-only objects a signal would gain nothing from.
const bordersVersion: Signal<number>;

function ensureBordersScanned(): void;
function getProvinceBorderPaths(): BorderPaths | null;
function getCountryBorderPaths(): BorderPaths | null;
function setCountryAssignment(countryOf: Uint16Array | null): void;
function disposeBorders(): void;

// T04 verification scaffolding — T06 deletes both.
function applyDemoCountries(): void;
function clearDemoCountries(): void;
```

`ensureBordersScanned()`:

- idempotent; returns immediately if a worker already exists;
- returns without doing anything while `loadPhase.value !== "ready"` or
  `getMapAssets() === null`, so callers do not have to guard;
- **copies** the packed bitmap with `index.pixels.slice()` and transfers the copy.
  **Never transfer `index.pixels` itself** — a transfer detaches it and every later
  `provinceAt` reads zeroes. T02 left a comment on that field saying so. The copy is a
  41.7 MB memcpy, roughly 4 ms, and it happens after the first paint;
- flattens `index.colorIndex` into `paletteColors` / `paletteIds`;
- spawns `new Worker(new URL("../map/borders.worker.ts", import.meta.url), { type: "module" })`;
- sets `borderPhase = "scanning"`;
- on a `scan` response: `buildBorderPaths(tiles)`, store, `bordersVersion.value += 1`,
  `borderPhase = "ready"`, `borderStats.value = stats`. The worker is **kept alive** for
  country recomputes;
- on an `error` response or `worker.onerror`: `borderPhase = "failed"`,
  `borderError.value = message`. It must never throw — the app has to keep working
  without borders.

`setCountryAssignment(countryOf)`:

- no-op while the worker does not exist;
- **latest wins.** Increment a module `requestId`; ignore any response whose `requestId`
  is not the newest. T06 paints provinces in a drag, so several requests will overlap;
- **coalesce.** If a `countries` request is already in flight, store the newest
  `countryOf` in a `pending` slot and send it when the in-flight one returns. This keeps
  the worker from queueing a backlog during a paint drag;
- `null` clears the country paths and bumps `bordersVersion`.

`applyDemoCountries()` — T04 verification only. Builds a synthetic assignment from the
manifest so country borders can be seen and measured before T06 exists: bucket every
province by its `centroid` into a 4-column x 2-row grid over the map and use the bucket
index + 1 as the country id. That produces eight large, geographically contiguous blocks,
so the country borders look like country borders and are visibly distinguishable from
province borders. Then call `setCountryAssignment(buildCountryOf(map, 1650))`. Mark the
function with a comment naming T04 and T06.

### 6.2 `src/state/selection-store.ts`

```ts
const hoveredProvinceId: Signal<number | null>;
const selectedProvinceId: Signal<number | null>;
function setHoveredProvince(id: number | null): void;
function setSelectedProvince(id: number | null): void;
function clearSelection(): void;
```

Both setters skip the write when the value is unchanged — a pointer move inside one
province must not schedule a repaint. T08 adds `selectedCountryId` here; it does not move
these.

### 6.3 `src/ui/border-layer.ts`

```ts
type BorderPaths = { tiles: BorderTiles; paths: readonly Path2D[] };
type BorderStyle = { widthCss: number; color: string; cap: CanvasLineCap };

function buildBorderPaths(tiles: BorderTiles): BorderPaths;
function drawBorders(
  ctx: CanvasRenderingContext2D,
  borders: BorderPaths,
  view: View,
  viewport: Size,
  dpr: number,
  style: BorderStyle,
): void;
```

`buildBorderPaths` allocates one `Path2D` per tile from the flat `data` / `offsets`
(`moveTo` / `lineTo` per segment). Measured 5.7 ms for 180 tiles including bucketing, and
it runs once per scan, not per frame. A tile with no segments still gets an empty `Path2D`
so indexing stays trivial.

`drawBorders`:

```
range = visibleTiles(view, viewport, borders.tiles)
if (!range) return
ctx.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, view.x * dpr, view.y * dpr)
ctx.lineWidth = style.widthCss / view.scale        // <- the screen-space width
ctx.lineCap = style.cap
ctx.lineJoin = "round"
ctx.strokeStyle = style.color
for r in range.r0..range.r1: for c in range.c0..range.c1:
  ctx.stroke(borders.paths[r * cols + c])
ctx.setTransform(dpr, 0, 0, dpr, 0, 0)            // restore the CSS-pixel transform
```

The `view` passed in **must be the `snapView(view, dpr)` result** that `drawOverlay`
already computes and that `drawScene` uses. Passing the raw view puts the borders up to
half a device pixel off the art, which is exactly the drift the done-condition forbids.

Restoring `setTransform(dpr, 0, 0, dpr, 0, 0)` at the end is required — the bounds
hairline that follows draws in CSS pixels.

Styles (starting values; tune against the art in the browser, keep the ratio):

```ts
const PROVINCE_BORDER: BorderStyle = { widthCss: 1,    color: "rgba(20, 16, 12, 0.38)", cap: "butt" };
const COUNTRY_BORDER:  BorderStyle = { widthCss: 2.25, color: "rgba(12, 9, 6, 0.85)",   cap: "round" };
```

`cap: "round"` on country borders hides the notches where a 2.25 px line changes direction
between two separate subpaths; at 1 px the notch is invisible, so province borders use
`"butt"` and stay crisper.

### 6.4 `src/ui/highlight-layer.ts`

```ts
type HighlightRole = "hover" | "select";
type HighlightRequest = { province: Province; role: HighlightRole };

function buildStampPixels(
  index: ProvinceIndex,
  province: Province,
  rgba: readonly [number, number, number, number],
): Uint8ClampedArray;                    // PURE — no DOM. Testable in Node.

function drawProvinceHighlight(
  ctx: CanvasRenderingContext2D,
  index: ProvinceIndex,
  request: HighlightRequest,
  view: View,
  dpr: number,
): void;

function clearHighlightCache(): void;
```

`buildStampPixels` walks `province.bounds` (max 12 642 pixels, median 2 960 — a fraction of
a millisecond) and writes the colour where `index.packedAt(bx + x, by + y)` equals
`packRgb(...province.rgb)`. Compare packed colours directly; do not call `provinceAt`,
which pays a `Map` lookup per pixel for no benefit.

`drawProvinceHighlight` wraps the stamp in a cached `HTMLCanvasElement`
(`document.createElement` stays inside the function body so the module still imports under
Node), keyed `provinceId + "|" + role`, in an insertion-ordered `Map` capped at 32 entries
with oldest-first eviction. Then:

```
ctx.imageSmoothingEnabled = shouldSmooth(view.scale, dpr)
ctx.drawImage(
  stamp, 0, 0, b.width, b.height,
  view.x + b.x * view.scale, view.y + b.y * view.scale,
  b.width * view.scale, b.height * view.scale,
)
```

drawn under the CSS-pixel transform `setTransform(dpr, 0, 0, dpr, 0, 0)` that `prepare`
already installed. `dw / sw` is exactly `view.scale`, the same property `sourceRect` gives
`drawScene`, so the stamp lands on the art pixel-for-pixel.

Colours (baked into the stamp, hence keyed by role):

```ts
const HOVER_FILL:  [number, number, number, number] = [216, 162, 74, 56];   // --accent, faint
const SELECT_FILL: [number, number, number, number] = [216, 162, 74, 112];  // --accent, stronger
```

### 6.5 `src/ui/render.ts`

```ts
type OverlayInput = {
  ctx: CanvasRenderingContext2D;
  view: View;
  viewport: Size;
  dpr: number;
  mapSize: Size;
  provinceBorders?: BorderPaths | null;
  countryBorders?: BorderPaths | null;
  highlights?: readonly HighlightRequest[];
  provinceIndex?: ProvinceIndex | null;
};
```

Draw order inside `drawOverlay`, after the existing `prepare` and `snapView`:

1. highlights, in array order (caller puts `select` last so it wins when the hovered and
   selected province are the same — see 6.6), skipped when `provinceIndex` is missing;
2. province borders;
3. country borders, so a country line covers the province line underneath it;
4. the existing bounds hairline, unchanged and last.

Every new field is optional, and with all of them omitted the function must produce
exactly the same output it produces today. That is what keeps `src/ui/render.test.ts`
green without edits.

### 6.6 `src/ui/MapCanvas.tsx`

- `useEffect(() => { ensureBordersScanned(); }, [phase]);` next to the existing
  `syncView()` effect. It is a plain effect, not a `useSignalEffect` — it writes signals.
- `draw()` gains:
  ```ts
  const hovered = hoveredProvinceId.value;
  const selected = selectedProvinceId.value;
  const highlights: HighlightRequest[] = [];
  if (hovered !== null && hovered !== selected) { push hover }
  if (selected !== null) { push select }
  ```
  and passes `getProvinceBorderPaths()`, `getCountryBorderPaths()`, `highlights` and
  `assets.index` to `drawOverlay`.
- The existing `useSignalEffect` adds `void hoveredProvinceId.value;`,
  `void selectedProvinceId.value;` and `void bordersVersion.value;`.

  **A single draw path is kept on purpose.** A hover change repaints the scene canvas as
  well as the overlay, which is one `drawImage` (measured 0.8-4 ms). Splitting into a
  scene frame and an overlay frame would need two rAF handles and two effects, and both
  setters already deduplicate, so a repaint only happens when the cursor actually crosses
  a province boundary — a handful of times per second at most. Not worth the machinery.
- `onPointerMove` calls `setHoveredProvince(pixel ? provinceAt(pixel.x, pixel.y) : null)`
  right after the existing `setCursor(...)`. `onPointerLeave` clears it.
- `onPointerUp` selects when the gesture never passed the drag threshold
  (`gesture.kind === "pan" && !gesture.moved`) and the button is 0. Read the province from
  the pointer position, not from `cursorMap`, so a click without a preceding move works.
  **This is provisional.** T08 owns selection; leave a comment saying so.
- HUD gains `border <phase>`, `scan <n> ms`, `segs <n>`, and two buttons wired to
  `applyDemoCountries()` / `clearDemoCountries()`. Mark the whole block as T04/T03
  verification UI that T08 replaces.

---

## 7. Edge cases and failure modes

1. **Transfer detaches.** Transferring `index.pixels` breaks every later `provinceAt`.
   Transfer only the `.slice()` copy. Put a comment at the call site.
2. **Worker unavailable or the chunk fails to load.** `borderPhase = "failed"`,
   `borderError` set, `drawOverlay` still draws the hairline, the map still pans, zooms
   and picks. Never throw out of the store.
3. **Response after unmount or after a newer request.** Guard on `requestId` and on the
   worker still being the current one. Terminate in `disposeBorders()`.
4. **Country request before the scan finished.** `ids === null` in the worker -> respond
   with `tiles: null`, not an error.
5. **`countryOf` too short, or holding a province id that does not exist.** Read with a
   length check; ids 1318 and 1458 are absent from the manifest and must stay 0.
6. **`countryOf[0]` non-zero.** Index 0 is `NO_PROVINCE`. The worker forces it to 0 on
   receipt; otherwise every coastline pixel would be classified by a phantom country.
7. **Every province in one country.** The country run set is the coastline only. Correct,
   and worth a test.
8. **No assignment at all.** `getCountryBorderPaths()` returns `null` and nothing is drawn.
9. **Degenerate view** (`scale` 0, NaN, or a non-finite translate). `visibleTiles` returns
   `null` and `drawBorders` returns without touching the transform. Same guard shape as
   the existing `drawOverlay` early return.
10. **The 1-pixel width difference.** Borders use the **map** size, 3653 x 2855 — the
    province bitmap really is 3653 wide. Only `sourceRect` in `drawScene` takes the art
    size, 3652. Do not "fix" the border scan to 3652.
11. **A hovered id with no manifest entry.** `provinceById` returns `null`; skip the
    highlight rather than throwing.
12. **A zero-sized province bounds.** Guard `bounds.width <= 0 || bounds.height <= 0` and
    skip; `createElement("canvas")` with width 0 then `putImageData` throws.
13. **`buildBorderTiles` on an empty run set** (no province differs from any neighbour, or
    a country assignment that produces no boundary). `data` is a zero-length
    `Float32Array`, `offsets` is all zeros with `cols * rows + 1` entries. `drawBorders`
    must survive it — every `stroke` on an empty `Path2D` is a no-op.
14. **The line exactly on a tile edge** and **a stroke spilling into the next tile.** Both
    are handled by the `-1` / `+1` widening in `visibleTiles`, not by duplicating segments.
15. **HMR re-running the effect.** `ensureBordersScanned` is idempotent on the worker
    handle; `disposeBorders` terminates it in the cleanup.
16. **The 33.5 MB LUT in `mapPixelsToIds`** must not be retained. Let it go out of scope.

---

## 8. Tests — `src/map/borders.test.ts`

Pure logic only, per PLAN section 4. No DOM, no canvas, no React, no signals.

### 8.1 `mapPixelsToIds`

- packed colour -> id through the palette; `UNPAINTED` (`0xffffffff`) -> 0; an opaque
  colour absent from the palette -> 0; a black province (`0x000000`) is a legal key and
  must resolve, which is the case that fails if anyone reintroduces `0` as the sentinel.

### 8.2 `scanBorders` on hand-built bitmaps

Every expected value written out by hand in the test, not computed by a second
implementation of the algorithm.

- 1x1, 2x1 and 1x2 bitmaps: no crossings, no runs, `borderPixels === 0`.
- 3x3 split down the middle (`[1,1,2 / 1,1,2 / 1,1,2]`): exactly one vertical run
  `(1, 0, 2)`, zero horizontal runs, 3 vertical crossings at pixel indices 1, 4, 7,
  `borderPixels === 3`.
- The transpose: exactly one horizontal run `(1, 0, 2)`, zero vertical.
- 5x5 all id 7 with a single id 9 at the centre: vertical runs `(1, 2, 2)` and `(2, 2, 2)`,
  horizontal runs `(1, 2, 2)` and `(2, 2, 2)`, `borderPixels === 4`.
- 4x4 checkerboard of ids 1 and 2: 12 vertical crossings, 12 horizontal, 12 runs of length
  1 each way, `borderPixels === 16`.
- **A broken column**: a vertical boundary present in rows 0-1 and 4-5 but not 2-3 must
  produce two runs, not one. This is the case that fails if `openV` is never closed.
- **The map edge is not a border**: a bitmap whose right column and bottom row differ from
  nothing produces no run at `x === width - 1` or `y === height - 1`.
- **`NO_PROVINCE` participates**: id 0 next to id 5 is a crossing; id 0 next to id 0 is not.
- **`openH` does not leak across rows**: two rows each holding a separate horizontal
  boundary segment must give two runs, and no run may have `x1 === width - 1` unless the
  boundary really reaches the edge.
- Invariant on every fixture: `sum(y1 - y0 + 1)` over vertical runs equals
  `crossings.vertical.length`, and the same for horizontal. A merge bug breaks this.
- Both crossing arrays are strictly ascending.

### 8.3 `countryRuns`

- **Identity property**: `countryOf[p] = p`, `countryOf[0] = 0` reproduces `scanBorders`'s
  run set exactly, on at least three fixtures including the checkerboard. Compare as sets
  (sort the triples), because run order differs.
- Two adjacent provinces merged into one country: their shared boundary disappears and
  every other run survives.
- All provinces in one country, on a fixture with unpainted pixels: only the coastline
  survives.
- All provinces in one country, on a fixture with no unpainted pixels: the run set is empty.
- A country change that splits a long boundary in the middle produces two runs where the
  province scan produced one.
- `countryOf` shorter than the maximum province id present: does not throw, and the
  out-of-range provinces behave as country 0.
- `countryOf[0]` deliberately set non-zero is either forced to 0 by the caller or produces
  the documented behaviour — assert whichever the implementation guarantees, and state it.

### 8.4 The real asset (required)

Decode `assets/provinces_map.png` in the test with a private `node:zlib` PNG decoder —
copy the ~40-line one out of `src/map/province-pixels.test.ts`; **do not import from that
file**, it is a test module. Memoise the decode. Then run the shipped
`packPixels` -> `mapPixelsToIds` -> `scanBorders` and assert exactly:

```
borderPixels                 === 180869
crossings.vertical.length    === 103835
crossings.horizontal.length  === 111342
runs.vertical.length / 3     ===  66074
runs.horizontal.length / 3   ===  66116
```

Also assert that the identity `countryRuns` over the real crossings reproduces the real
run counts. Cost is roughly 1 s; that is acceptable for a pin this strong.

### 8.5 `buildBorderTiles` and `visibleTiles`

- `offsets` has `cols * rows + 1` entries, is non-decreasing, and its last entry equals
  `data.length`.
- Every emitted segment lies inside its own tile's map rectangle.
- Total segment **length** is preserved by splitting: the sum of `|y1 - y0| + |x1 - x0|`
  over all emitted segments equals the sum over the unsplit runs.
- A run that spans a tile boundary with `tileSize` 2 produces exactly two segments that
  reassemble to the original.
- An empty run set yields `data.length === 0` and a valid `offsets`.
- `visibleTiles` returns the full grid at the fit scale, a single-tile-plus-margin range
  when the viewport is inside one tile, and `null` for `scale` 0, negative and NaN.
- The `-1` / `+1` margin is asserted directly: a viewport whose left edge sits exactly on
  a tile boundary still includes the tile to its left.

### 8.6 `buildCountryOf`

- Length is `maxProvinceId + 1`; index 0 is 0; ids 1318 and 1458 stay 0; an out-of-range
  id in the input map is ignored rather than throwing.

### 8.7 `buildStampPixels` (in `src/map/borders.test.ts` or its own file)

- On a synthetic `ProvinceIndex`, only the pixels whose packed colour matches the province
  are written; everything else stays alpha 0. Length is `bounds.width * bounds.height * 4`.
- A province whose bounds contain a neighbouring province's pixels does not paint them.

### 8.8 Mutation check (report the table in the memory file)

Apply each of these one at a time to the source, run `src/map/borders.test.ts`, revert,
and confirm the file is byte-identical afterwards:

| Mutant | Must fail |
|---|---|
| `scanBorders` never closes `openH` at end of row | ≥ 1 |
| `scanBorders` closes `openV` unconditionally each row | ≥ 1 |
| `scanBorders` uses `>=` instead of `<` in `x + 1 < width` | ≥ 1 |
| run geometry drops the `+ 1` on `x` / `y` | ≥ 1 |
| `countryRuns` compares province ids instead of country ids | ≥ 2 |
| `countryRuns` drops the `last[x] !== y - 1` adjacency test | ≥ 1 |
| `buildBorderTiles` duplicates instead of splitting | ≥ 1 |
| `visibleTiles` drops the `-1` / `+1` margin | ≥ 1 |
| `mapPixelsToIds` masks with `0xffffff` before the `UNPAINTED` test | ≥ 1 |

### 8.9 Not covered by unit tests

`borders.worker.ts`, `borders-store.ts`, `selection-store.ts`, `border-layer.ts`'s
`Path2D` construction, `highlight-layer.ts`'s canvas wrapper, and `MapCanvas.tsx`. All
need a worker, a canvas, a DOM or signals; PLAN section 4 forbids those tests and there is
no jsdom. Section 9's browser checklist is their gate.

---

## 9. What the implementer must verify before claiming done

All commands from
`javascript/packages/prototypes/civitas/civitas-interactive-map`.

### 9.1 Build and static checks

```
yarn typecheck                       # exit 0, no output
yarn test                            # every test passes; record the before/after count
yarn build                           # exit 0; only the two known asset-size warnings
ls dist                              # a SEPARATE numbered worker chunk beside main.*.js
grep -rn "'" src/                    # apostrophes in comments only, zero single-quoted strings
```

The worker chunk is the check that matters. `../civitas-map/dist` already contains
`300.3458aa3fa1ef1150.js` from the same rspack 2.1.4 and the same
`new Worker(new URL("...", import.meta.url), { type: "module" })` call, so the pattern is
known to work — if no extra chunk appears here, the `new URL` argument was inlined into a
variable and rspack lost the static reference.

### 9.2 The scan does not block first paint

`yarn dev`, open Chrome, and read the HUD. Required evidence:

- the map is visible and pannable **before** `border` leaves `scanning`;
- `scan <n> ms` is non-zero and plausible (expect roughly 100-250 ms);
- a Performance recording of the load shows no main-thread task over ~50 ms after the
  province decode. The 41.7 MB `slice()` is the only new main-thread cost and it should
  be a few milliseconds;
- the Network panel shows the worker chunk fetched as a separate request.

### 9.3 Borders align with the province art — measured, not eyeballed

This is the done-condition, so prove it numerically at three zoom levels (fit, 1.0, 8.0).
Use the console, not your eyes:

1. Pick a map row `y` that crosses several provinces.
2. From the province bitmap, list the map `x` values where the province id changes between
   `x` and `x + 1` on that row. (`provinceAt` is reachable from the module; failing that,
   step the HUD readout.)
3. Read the overlay canvas back with `getImageData` along the corresponding device row and
   list the `x` positions of stroked pixels.
4. Each stroked position must equal `(mapX + 1) * scale + view.x` scaled by `dpr`, within
   1 device pixel. Do this at all three zoom levels and paste the three lists.

Also confirm at 8x that the border sits **on** the colour seam of `provinces_map.png` and
not one map pixel to either side — that is the check that catches a missing `+ 1` in the
segment geometry.

Keep the T03 bounds hairline in place while doing this; it is the instrument that proves
the scene and overlay transforms have not diverged.

### 9.4 Width is screen space

At the fit scale, at 1.0 and at 8.0, measure the drawn thickness of a province border by
reading back the overlay along a row that crosses a vertical border. It must be the same
number of device pixels at all three (1 CSS px x `dpr`, plus at most one pixel of
antialiasing). A thickness that grows with zoom means `lineWidth` was set to `widthCss`
rather than `widthCss / view.scale`.

Do the same for country borders after `applyDemoCountries()` and confirm they are visibly
thicker and darker than province borders at every zoom.

### 9.5 Country recompute is cheap

With the demo assignment applied, time `setCountryAssignment` end to end (post to the
`countries` response) and report it. Expect single-digit milliseconds. If it is over
50 ms, the worker is rescanning the bitmap instead of walking the crossings.

Toggle the demo assignment on and off several times and confirm no leak: `bordersVersion`
increments once per apply, and repeated rapid toggles coalesce rather than queueing.

### 9.6 Hover and selection

- Hovering a province fills exactly that province's shape, with no bleed into neighbours
  and no offset — check at 8x on a province with a ragged boundary.
- The fill stays aligned while panning and zooming.
- A left click selects; the selected fill is stronger than the hover fill; hovering the
  selected province does not double-fill it.
- Moving the pointer off the map clears the hover.
- A drag past the 3 px threshold does **not** select.

### 9.7 Frame cost

Record the per-frame `drawOverlay` cost at the fit scale and at 8x with borders on
(`performance.now()` around the call, median of 20 frames during a pan). Report both.
My benchmark says the tiled stroke should be around 1 ms at the fit scale on a dpr 1
display; report what you actually measure, including `devicePixelRatio`.

### 9.8 Failure path

Force a worker failure (temporarily break the worker URL, or post a malformed request from
the console) and confirm the app still renders the map, still pans and zooms, still picks
provinces, and shows `border failed` in the HUD with a message. Revert the change and say
so in the memory file.

---

## 10. Explicitly NOT part of T04

- **Country creation, CRUD, colours, and the real province -> country assignment UI.**
  T06. T04 ships `setCountryAssignment(Uint16Array | null)` and a demo assignment whose
  only purpose is to prove the country path works; T06 deletes the demo.
- **Tinting the map by country colour.** T06.
- **Country name labels.** T07.
- **Real selection semantics** — right click selecting a country, suppressing the context
  menu for it, selection driving panels, the UI shell. T08. The left-click select added
  here is a placeholder and is marked as such in the code.
- **Country highlight fills.** Only the hovered and selected *province* are filled. T08
  adds the country fill on top of `selection-store.ts`.
- **Persisting hover/selection or the view.** T05.
- A `Uint8Array` border mask, a mask `ImageBitmap`, mip levels of the mask, or any
  bitmap-based border render path. Rejected in section 1, with measurements.
- Stylised borders: dashes, casing, outer glow, sea/land differentiation, disputed-border
  styling.
- Anti-aliasing beyond what canvas gives, WebGL, and `OffscreenCanvas` rendering.
- Re-decoding `provinces_map.png` inside the worker. The worker receives the already
  decoded, already integrity-checked pixels from `ProvinceIndex`.
- Any change to `rspack.config.mjs`, `tsconfig.json`, `package.json`, `index.html`,
  `assets/`, or `../civitas-map`.
- Silencing the two pre-existing `yarn build` asset-size warnings.
