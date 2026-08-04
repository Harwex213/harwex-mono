# T07 — EU-style country labels

Design for the think -> implement -> review chain. The algorithms below are written out.
Follow them literally. Where a constant is named, use that name and that value.

Read first: `javascript/CLAUDE.md`, `.plan/PLAN.md` sections 2-4, and the README sections
"Rendering, zoom and pan", "Borders and highlights" and "Countries and province assignment".

---

## 0. What this task adds, in one paragraph

A country name is drawn on the overlay canvas at a point proven to lie inside that
country's own territory. The point comes from T06's area-weighted centroid when that
centroid is in-country, and from a fallback chain when it is not. Type is uppercase,
letter-spaced, haloed, and its size follows zoom through a clamped sub-linear ramp. A
label is hidden when the country's on-screen bounding box cannot fit the **measured**
text. Labels are placed greedily, largest country first, and a label that collides with
one already placed is nudged along a fixed offset list or dropped.

The placement and collision maths is a pure module with no canvas and no DOM. It receives
text widths as numbers. `measureText` is called only in the canvas layer.

---

## 1. Files

### Created

| Path | Responsibility |
|---|---|
| `src/map/label-layout.ts` | **PURE.** The font ramp, the anchor fallback chain, the pole-of-inaccessibility search, the chamfer distance transform, the fit test and the greedy collision layout. No canvas, no DOM, no signals. |
| `src/map/label-layout.test.ts` | Node tests for every function in the above. The bulk of the task's coverage. |
| `src/ui/label-layer.ts` | Canvas text. The font stack, glyph metrics with an LRU cache, the measure-then-layout bridge, and the two-pass halo/fill draw. |
| `src/ui/label-layer.test.ts` | Recorder-context tests, in the style of `src/ui/render.test.ts`. No DOM. |
| `src/state/label-store.ts` | The derived `countryLabelSources` signal, the per-country anchor cache, the `countryContainsPoint` predicate, and the `showLabels` toggle. |
| `src/state/label-store.test.ts` | The reachable store behaviour in Node (see 9.4 for what is and is not reachable). |

### Changed

| Path | Change |
|---|---|
| `src/ui/render.ts` | `OverlayInput` gains two OPTIONAL fields, `labelSources` and `countryContains`. `drawOverlay` lays out and draws labels **last**, after the bounds hairline. |
| `src/ui/render.test.ts` | +2 tests: labels draw after the hairline; omitting `labelSources` is byte-identical to the T06 overlay. |
| `src/ui/MapCanvas.tsx` | Passes the two new overlay fields; adds `void countryLabelSources.value` to the draw-scheduling effect; adds the `L` key toggle; adds two HUD readouts. |
| `README.md` | A new `## Country labels` section, appended after `## Countries and province assignment`. Docs agent's job, not the implementer's. |

Nothing else is touched. No new dependency. No schema field, no storage key, no migration —
anchors are **derived, never persisted**.

---

## 2. `src/map/label-layout.ts` — public API

```ts
import type { Bounds } from "./manifest";
import type { Point, Size, View } from "./view";

// (countryId, mapX, mapY) -> is that map pixel inside that country?
// A callback, so this module never touches the province bitmap and stays testable.
type ContainsFn = (countryId: number, mapX: number, mapY: number) => boolean;

// Bound to one country already. `findInteriorPoint` knows nothing about countries.
type InsideFn = (mapX: number, mapY: number) => boolean;

type LabelFontRamp = {
  referenceScale: number;
  basePx: number;
  exponent: number;
  minPx: number;
  maxPx: number;
};

type GridOptions = { cells?: number; levels?: number };

// One province, reduced to what the anchor search needs.
type AnchorCandidate = {
  x: number;
  y: number;
  pixelCount: number;
  bounds: Bounds;
};

type AnchorSource = "centroid" | "province" | "pole";
type LabelAnchor = { point: Point; source: AnchorSource };

type AnchorInput = {
  countryId: number;
  centroid: Point | null;
  // MUST already be sorted by `pixelCount` descending. `resolveLabelAnchor`
  // honours the given order and does not sort.
  provinces: readonly AnchorCandidate[];
  contains: ContainsFn;
  candidateLimit?: number;
  grid?: GridOptions;
};

// What the store hands the renderer. Everything in MAP pixels.
type CountryLabelSource = {
  countryId: number;
  text: string;      // already trimmed and uppercased
  anchor: Point;
  bounds: Bounds;    // the country's union bounding box
  area: number;      // pixelCount — the greedy sort key
};

// A source plus the two numbers only the canvas layer can supply.
type LabelCandidate = CountryLabelSource & {
  textWidth: number; // CSS px, MEASURED at `fontSize`
  fontSize: number;  // CSS px
};

// Screen CSS px, top-left origin.
type LabelRect = { x: number; y: number; width: number; height: number };

type LabelPlacement = {
  countryId: number;
  text: string;
  // Screen CSS px. `x` is the LEFT edge of the first glyph, `y` the vertical
  // CENTRE of the line — the draw uses `textAlign "left"`, `textBaseline "middle"`.
  x: number;
  y: number;
  fontSize: number;
  rect: LabelRect;
  // Which entry of NUDGE_OFFSETS won. 0 means the label sits on its anchor.
  offsetIndex: number;
  // False when the rect misses the viewport. Such a placement STILL holds its
  // slot; it is simply not drawn. See 5.4.
  visible: boolean;
};

type LayoutOptions = {
  candidates: readonly LabelCandidate[];
  view: View;        // the SNAPPED view, the one `drawScene` uses
  viewport: Size;
  contains?: ContainsFn;
  fitWidthRatio?: number;
  fitHeightRatio?: number;
  paddingX?: number;
  paddingY?: number;
};

const LABEL_FONT_RAMP: LabelFontRamp;
const ANCHOR_CANDIDATE_LIMIT: number;   // 8
const GRID_CELLS: number;               // 24
const GRID_LEVELS: number;              // 3
const FIT_WIDTH_RATIO: number;          // 1.05
const FIT_HEIGHT_RATIO: number;         // 1.6
const LABEL_PADDING_X: number;          // 6
const LABEL_PADDING_Y: number;          // 3
const COORD_LIMIT: number;              // 1e6
const NUDGE_OFFSETS: readonly Point[];

function labelFontSize(scale: number, ramp?: LabelFontRamp): number;
function chamferDistance(mask: Uint8Array, cols: number, rows: number): Float32Array;
function findInteriorPoint(bounds: Bounds, inside: InsideFn, options?: GridOptions): Point | null;
function resolveLabelAnchor(input: AnchorInput): LabelAnchor | null;
function rectsOverlap(a: LabelRect, b: LabelRect): boolean;
function layoutLabels(options: LayoutOptions): LabelPlacement[];

export {
  ANCHOR_CANDIDATE_LIMIT,
  COORD_LIMIT,
  FIT_HEIGHT_RATIO,
  FIT_WIDTH_RATIO,
  GRID_CELLS,
  GRID_LEVELS,
  LABEL_FONT_RAMP,
  LABEL_PADDING_X,
  LABEL_PADDING_Y,
  NUDGE_OFFSETS,
  chamferDistance,
  findInteriorPoint,
  labelFontSize,
  layoutLabels,
  rectsOverlap,
  resolveLabelAnchor,
  type AnchorCandidate,
  type AnchorInput,
  type AnchorSource,
  type ContainsFn,
  type CountryLabelSource,
  type GridOptions,
  type InsideFn,
  type LabelAnchor,
  type LabelCandidate,
  type LabelFontRamp,
  type LabelPlacement,
  type LabelRect,
  type LayoutOptions,
};
```

`src/scaffold.test.ts` fails a line starting `export type { ... }`. Write `type Foo` inside
the single grouped export, exactly as above.

---

## 3. The font ramp

```ts
const LABEL_FONT_RAMP: LabelFontRamp = {
  referenceScale: 0.32,
  basePx: 13,
  exponent: 0.45,
  minPx: 9,
  maxPx: 34,
};

function labelFontSize(scale, ramp = LABEL_FONT_RAMP) {
  if (!Number.isFinite(scale) || scale <= 0) {
    return ramp.minPx;
  }
  const raw = ramp.basePx * Math.pow(scale / ramp.referenceScale, ramp.exponent);
  if (!Number.isFinite(raw)) {
    return ramp.minPx;
  }
  return Math.min(ramp.maxPx, Math.max(ramp.minPx, raw));
}
```

`referenceScale` 0.32 is the fit scale of the 3653 x 2855 map in a roughly 1150 px wide
viewport — the size the app opens at.

**The exponent is the whole point.** The zoom range is 25x (0.317 fit to the 8x cap). A
size linear in scale would give 13 px at fit and 328 px at the cap — a billboard. An
exponent of 0.45 gives:

| `scale` | `labelFontSize` |
|---|---|
| 0.10 | 9 (clamped up from 7.6) |
| 0.32 | 13.0 |
| 1.00 | 21.6 |
| 3.00 | 35.9 -> 34 (clamped) |
| 8.00 | 55.1 -> 34 (clamped) |

So a label grows visibly on the way in, stops growing around 3x, and never falls below
9 px. The clamp at both ends is what satisfies "neither vanish when zoomed out nor become
billboards when zoomed in".

The size is in **CSS pixels**, like `BorderStyle.widthCss`. The canvas transform is already
`setTransform(dpr, 0, 0, dpr, 0, 0)` when labels draw, so a CSS-px font size is correct on
every display ratio with no extra arithmetic.

---

## 4. The anchor

### 4.1 The chain

`resolveLabelAnchor` returns the first point that satisfies `contains(countryId, x, y)`:

1. **The area-weighted country centroid** (`CountryAggregate.centroid`, straight from
   T06's `aggregateCountry`). This is the answer for a normal blob country.
2. **Province centres of mass, largest first.** Walk `input.provinces` in the given order
   (the caller sorts by `pixelCount` descending) and take the first whose `(x, y)` is
   in-country. Stop after `candidateLimit` (default `ANCHOR_CANDIDATE_LIMIT = 8`) tries.
3. **A pole-of-inaccessibility approximation inside the largest province's bounding box**
   (`input.provinces[0].bounds`), via `findInteriorPoint`.
4. `null`. The country gets no label.

Why step 2 is almost always enough: a province's own centre of mass lies inside that
province for 1634 of the 1648 provinces on the shipped asset (T02 measured 14 that do
not), and a province of the country is by construction inside the country. So step 3 fires
only for a country whose weighted centroid is outside AND whose eight largest provinces
all have an outside centre of mass. On the shipped asset that is close to unreachable —
it is there so a crescent country made of exactly one crescent province still gets a
label, and so the property test in 9.1 can prove the "never in the sea" invariant without
relying on the data.

Why step 3 searches the LARGEST PROVINCE's bounding box and not the country's union box:
the union box of a 300-province country is up to 3119 x 2427 map pixels, and a fixed
24 x 24 grid over it samples every 130 px — coarse enough to miss a thin arm entirely.
The largest province's box is at most 12 642 pixels of area (T04's measurement), so the
same grid resolves it finely. The point is guaranteed to be inside a province the country
owns, which is exactly the guarantee the label needs.

```ts
function resolveLabelAnchor(input) {
  const limit = input.candidateLimit ?? ANCHOR_CANDIDATE_LIMIT;

  if (input.centroid !== null && isFinitePoint(input.centroid)) {
    if (input.contains(input.countryId, input.centroid.x, input.centroid.y)) {
      return { point: { x: input.centroid.x, y: input.centroid.y }, source: "centroid" };
    }
  }

  const tries = Math.min(limit, input.provinces.length);
  for (let i = 0; i < tries; i += 1) {
    const candidate = input.provinces[i];
    if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) {
      continue;
    }
    if (input.contains(input.countryId, candidate.x, candidate.y)) {
      return { point: { x: candidate.x, y: candidate.y }, source: "province" };
    }
  }

  if (input.provinces.length === 0) {
    return null;
  }
  const inside = (x, y) => {
    return input.contains(input.countryId, x, y);
  };
  const pole = findInteriorPoint(input.provinces[0].bounds, inside, input.grid);
  if (pole === null) {
    return null;
  }
  return { point: pole, source: "pole" };
}
```

**Invariant, and the thing the review must check:** every non-null return has been passed
through `contains` and came back true. There is no branch that returns an unverified
point. A "just use the bbox centre" fallback would break it and must not be added.

### 4.2 `chamferDistance`

Two-pass chamfer distance transform. `mask[i] !== 0` means "in the shape". The result is
each in-shape cell's approximate distance to the nearest out-of-shape cell, in cell units.
Out-of-grid neighbours count as out-of-shape, so a cell on the grid edge scores at most 1.

```
ORTHO = 1
DIAG  = Math.SQRT2

d = new Float32Array(cols * rows)
for i: d[i] = mask[i] !== 0 ? Infinity : 0

forward pass, y = 0..rows-1, x = 0..cols-1:
  if d[i] === 0: continue
  best = min(
    at(x - 1, y)     + ORTHO,
    at(x, y - 1)     + ORTHO,
    at(x - 1, y - 1) + DIAG,
    at(x + 1, y - 1) + DIAG,
  )
  if best < d[i]: d[i] = best

backward pass, y = rows-1..0, x = cols-1..0:
  if d[i] === 0: continue
  best = min(
    at(x + 1, y)     + ORTHO,
    at(x, y + 1)     + ORTHO,
    at(x + 1, y + 1) + DIAG,
    at(x - 1, y + 1) + DIAG,
  )
  if best < d[i]: d[i] = best

`at(x, y)` returns 0 for any coordinate outside the grid.
```

The (1, √2) weights rather than plain Manhattan: Manhattan's iso-distance contours are
diamonds, so it puts the label toward a diagonal tip of the shape. √2 diagonals give a
near-circular contour, which is what "deepest interior point" should mean.

### 4.3 `findInteriorPoint`

A coarse grid, a distance transform, then two refinement levels inside the winning cell's
3 x 3 neighbourhood.

```ts
function findInteriorPoint(bounds, inside, options = {}) {
  const cells = Math.max(3, Math.floor(options.cells ?? GRID_CELLS));
  const levels = Math.max(1, Math.floor(options.levels ?? GRID_LEVELS));
  if (!(bounds.width > 0) || !(bounds.height > 0)) {
    return null;
  }

  let box = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  let best = null;

  for (let level = 0; level < levels; level += 1) {
    const stepX = box.width / cells;
    const stepY = box.height / cells;
    const mask = new Uint8Array(cells * cells);
    let hits = 0;
    for (let r = 0; r < cells; r += 1) {
      for (let c = 0; c < cells; c += 1) {
        const px = box.x + (c + 0.5) * stepX;
        const py = box.y + (r + 0.5) * stepY;
        if (inside(px, py)) {
          mask[r * cells + c] = 1;
          hits += 1;
        }
      }
    }
    if (hits === 0) {
      // Level 0 found nothing at all: the shape is thinner than the grid step.
      // A refinement level finding nothing means the previous winner stands.
      return best;
    }

    const distance = chamferDistance(mask, cells, cells);
    let bestIndex = -1;
    let bestValue = -1;
    for (let i = 0; i < distance.length; i += 1) {
      // Strictly greater, so ties resolve to the LOWEST index. Deterministic.
      if (mask[i] !== 0 && distance[i] > bestValue) {
        bestValue = distance[i];
        bestIndex = i;
      }
    }
    if (bestIndex < 0) {
      return best;
    }

    const c = bestIndex % cells;
    const r = Math.floor(bestIndex / cells);
    best = { x: box.x + (c + 0.5) * stepX, y: box.y + (r + 0.5) * stepY };

    // Refine into the winner's 3 x 3 neighbourhood.
    box = {
      x: box.x + (c - 1) * stepX,
      y: box.y + (r - 1) * stepY,
      width: stepX * 3,
      height: stepY * 3,
    };
  }

  return best;
}
```

Cost: `levels * cells²` calls to `inside`, i.e. 3 * 576 = **1728 bitmap reads**, plus three
576-cell distance transforms. Under a millisecond. It runs only on a cache miss for a
country that reached step 3, which is close to never.

`best` is returned even when a refinement level finds no hits, so a shape that thins out
under refinement keeps the coarse answer instead of losing its label. The coarse answer
was itself sampled through `inside`, so the invariant in 4.1 holds either way.

---

## 5. The layout

### 5.1 The fit test

Both dimensions, against the country's on-screen bounding box:

```
screenW = candidate.bounds.width  * view.scale
screenH = candidate.bounds.height * view.scale
if (screenW < candidate.textWidth * fitWidthRatio)  -> drop
if (screenH < candidate.fontSize  * fitHeightRatio) -> drop
```

`textWidth` is `measureText`-derived (section 6.2), never estimated from character count.
`fitWidthRatio` 1.05 leaves a 5% margin so a label is not flush with the country's extremes.
`fitHeightRatio` 1.6 is roughly one line box plus leading.

Known limitation, accept it: a long thin country has a wide bounding box and passes the
width test even though no part of it is wide enough to hold the text. The brief specifies
the bounding box, and a true "does the text fit inside the shape" test needs a horizontal
run-length probe along the anchor row. Do not build that here. It is listed in section 11.

### 5.2 The greedy pass

```ts
function layoutLabels(options) {
  const view = options.view;
  const viewport = options.viewport;
  const contains = options.contains ?? (() => { return true; });
  const fitW = options.fitWidthRatio ?? FIT_WIDTH_RATIO;
  const fitH = options.fitHeightRatio ?? FIT_HEIGHT_RATIO;
  const padX = options.paddingX ?? LABEL_PADDING_X;
  const padY = options.paddingY ?? LABEL_PADDING_Y;

  if (!Number.isFinite(view.scale) || view.scale <= 0) {
    return [];
  }

  // Largest country wins. `countryId` ascending breaks a tie, so the output does
  // not depend on the order `countries` happens to be in.
  const sorted = options.candidates.slice().sort((a, b) => {
    return b.area - a.area || a.countryId - b.countryId;
  });

  const viewRect = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  const placed = [];
  const out = [];

  for (const candidate of sorted) {
    if (candidate.text === "") { continue; }
    if (!(candidate.textWidth > 0) || !(candidate.fontSize > 0)) { continue; }
    if (candidate.bounds.width * view.scale < candidate.textWidth * fitW) { continue; }
    if (candidate.bounds.height * view.scale < candidate.fontSize * fitH) { continue; }

    const base = mapToScreen(view, candidate.anchor.x, candidate.anchor.y);
    if (!Number.isFinite(base.x) || !Number.isFinite(base.y)) { continue; }
    if (Math.abs(base.x) > COORD_LIMIT || Math.abs(base.y) > COORD_LIMIT) { continue; }

    const boxW = candidate.textWidth + padX * 2;
    const boxH = candidate.fontSize + padY * 2;

    let rect = null;
    let chosen = -1;
    let centreY = base.y;

    for (let i = 0; i < NUDGE_OFFSETS.length; i += 1) {
      const offset = NUDGE_OFFSETS[i];
      const cx = base.x + offset.x * candidate.textWidth;
      const cy = base.y + offset.y * candidate.fontSize;
      // Offset 0 IS the anchor, and `resolveLabelAnchor` already proved the
      // anchor is in-country. Re-testing it would cost a bitmap read per label
      // per frame for nothing. Every other offset MUST be tested, or a nudge
      // pushes the label into the sea.
      if (i > 0) {
        const back = screenToMap(view, cx, cy);
        if (!contains(candidate.countryId, back.x, back.y)) { continue; }
      }
      const trial = { x: cx - boxW / 2, y: cy - boxH / 2, width: boxW, height: boxH };
      let hit = false;
      for (const other of placed) {
        if (rectsOverlap(trial, other)) { hit = true; break; }
      }
      if (hit) { continue; }
      rect = trial;
      chosen = i;
      centreY = cy;
      break;
    }

    // Every offset collided or left the country. The larger countries already
    // own this space; drop the label rather than draw it on top of one.
    if (rect === null) { continue; }

    placed.push(rect);
    out.push({
      countryId: candidate.countryId,
      text: candidate.text,
      x: rect.x + padX,
      y: centreY,
      fontSize: candidate.fontSize,
      rect,
      offsetIndex: chosen,
      visible: rectsOverlap(rect, viewRect),
    });
  }

  return out;
}
```

`mapToScreen` and `screenToMap` come from `./view`. That is the only import
`label-layout.ts` needs besides the two type imports.

### 5.3 `NUDGE_OFFSETS` and `rectsOverlap`

```ts
// x in units of the label's TEXT WIDTH, y in units of its FONT SIZE.
// Vertical first: on a political map a name shifted up or down still reads as
// belonging to the same country, while a horizontal shift drifts toward a
// neighbour.
const NUDGE_OFFSETS: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 0, y: -1.25 },
  { x: 0, y: 1.25 },
  { x: -0.55, y: 0 },
  { x: 0.55, y: 0 },
  { x: 0, y: -2.5 },
  { x: 0, y: 2.5 },
];

// Touching edges are NOT an overlap. Two labels flush against each other are
// legible; treating that as a collision drops a label for nothing.
function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}
```

### 5.4 Pan invariance — read this before writing the loop

**The collision pass runs over every candidate that passes the fit test, on-screen or
not. `visible` decides only what gets drawn.**

The tempting shortcut is to cull off-screen candidates before the greedy pass, to save
work. It is wrong. Under that shortcut a label that scrolls out of view frees its slot,
so its neighbour — previously dropped — pops in; scroll back and it pops out again. Every
pan makes labels appear, vanish and jump. The correct behaviour is a placement that is a
function of the view transform alone, not of which labels happen to be visible.

The saving is worthless anyway: the candidate count is the country count, tens at most,
and the whole pass is a handful of rect comparisons per candidate.

Zoom still changes the placement, because `fontSize` and `view.scale` both change. That is
expected and is why the ramp is clamped — it stops the layout thrashing across a wheel
burst.

---

## 6. `src/ui/label-layer.ts` — public API

```ts
import { labelFontSize, layoutLabels } from "../map/label-layout";
import type { CountryLabelSource, ContainsFn, LabelCandidate, LabelPlacement }
  from "../map/label-layout";
import type { Size, View } from "../map/view";

// Mirrors `--font` in `src/index.css`. Canvas cannot read a CSS custom property
// without a `getComputedStyle` call per frame, so the stack is duplicated here.
// If `--font` changes, change this line too.
const LABEL_FONT_STACK = "\"Inter\", \"Segoe UI\", system-ui, sans-serif";
const LABEL_FONT_WEIGHT = "600";
const METRIC_FONT_PX = 100;
const METRIC_CACHE_LIMIT = 256;
const LETTER_SPACING_EM = 0.18;
const LABEL_FILL = "rgba(24, 20, 14, 0.92)";
const LABEL_HALO = "rgba(248, 246, 240, 0.80)";
const HALO_WIDTH_RATIO = 0.24;
const HALO_WIDTH_MIN = 2;

type LabelMetrics = {
  // One advance per CODE POINT, measured at METRIC_FONT_PX. Letter spacing is
  // NOT included.
  advances: readonly number[];
  total: number;
};

type LabelLayoutInput = {
  sources: readonly CountryLabelSource[];
  view: View;       // the SNAPPED view
  viewport: Size;
  contains?: ContainsFn;
};

type LabelStats = { candidates: number; placed: number; drawn: number };

function labelFont(sizePx: number): string;
function measureLabelMetrics(ctx: CanvasRenderingContext2D, text: string): LabelMetrics;
function labelTextWidth(metrics: LabelMetrics, fontSize: number): number;
function layoutCountryLabels(
  ctx: CanvasRenderingContext2D,
  input: LabelLayoutInput,
): LabelPlacement[];
function drawCountryLabels(
  ctx: CanvasRenderingContext2D,
  placements: readonly LabelPlacement[],
): void;
function clearLabelMetricsCache(): void;
function getLastLabelStats(): LabelStats;

export {
  HALO_WIDTH_MIN,
  HALO_WIDTH_RATIO,
  LABEL_FILL,
  LABEL_FONT_STACK,
  LABEL_FONT_WEIGHT,
  LABEL_HALO,
  LETTER_SPACING_EM,
  METRIC_CACHE_LIMIT,
  METRIC_FONT_PX,
  clearLabelMetricsCache,
  drawCountryLabels,
  getLastLabelStats,
  labelFont,
  labelTextWidth,
  layoutCountryLabels,
  measureLabelMetrics,
  type LabelLayoutInput,
  type LabelMetrics,
  type LabelStats,
};
```

### 6.1 The font string

```ts
function labelFont(sizePx) {
  return LABEL_FONT_WEIGHT + " " + sizePx + "px " + LABEL_FONT_STACK;
}
```

`src/index.css` declares **no `@font-face` and no `@import`**. `--font` resolves to a
locally installed Inter or falls back through the stack, and that resolution cannot change
mid-session. So the metric cache needs no `document.fonts.ready` invalidation.
`clearLabelMetricsCache` exists for tests and for a future web font, not for today.

### 6.2 Metrics — measured once per name, scaled thereafter

```ts
const metricCache = new Map<string, LabelMetrics>();

function measureLabelMetrics(ctx, text) {
  const cached = metricCache.get(text);
  if (cached) {
    return cached;
  }

  // Save and restore. `drawCountryLabels` calls this AFTER it has set the draw
  // font, and a leaked 100px font would render every label at 100px.
  const previous = ctx.font;
  ctx.font = labelFont(METRIC_FONT_PX);

  // `Array.from`, never `split("")`. A surrogate pair split in half measures and
  // draws as two replacement glyphs.
  const glyphs = Array.from(text);
  const advances = [];
  let total = 0;
  for (const glyph of glyphs) {
    const width = ctx.measureText(glyph).width;
    const safe = Number.isFinite(width) && width >= 0 ? width : 0;
    advances.push(safe);
    total += safe;
  }
  ctx.font = previous;

  if (metricCache.size >= METRIC_CACHE_LIMIT) {
    const oldest = metricCache.keys().next();
    if (!oldest.done) {
      metricCache.delete(oldest.value);
    }
  }
  const metrics = { advances, total };
  metricCache.set(text, metrics);
  return metrics;
}

function labelTextWidth(metrics, fontSize) {
  const gaps = Math.max(0, metrics.advances.length - 1);
  return (metrics.total * fontSize) / METRIC_FONT_PX + LETTER_SPACING_EM * fontSize * gaps;
}
```

Three decisions to keep:

- **Per glyph, not per string.** The draw advances the pen glyph by glyph (6.4), so the
  measurement must too. `ctx.measureText(wholeString).width` includes kerning the draw
  never applies, and the two would disagree by a few pixels per label — enough to make the
  fit test and the collision rects wrong.
- **Measured once at 100 px, then scaled.** Advance widths are linear in font size to
  within sub-pixel hinting noise. Re-measuring at the live size would mean N `measureText`
  calls per label per frame, and the live size changes on every wheel notch.
- **`(n - 1)` tracking gaps, not `n`.** There is no trailing space after the last glyph.
  Pin it with a test — an off-by-one here inflates every rect by one tracking unit.

`ctx.letterSpacing` was rejected: Firefox shipped it late, and the measured width it
produces has to agree with the drawn width across engines. Manual advance is exact
everywhere and is what makes the pure layout module trustworthy.

### 6.3 `layoutCountryLabels`

```ts
let lastStats = { candidates: 0, placed: 0, drawn: 0 };

function layoutCountryLabels(ctx, input) {
  const fontSize = labelFontSize(input.view.scale);
  const candidates = [];
  for (const source of input.sources) {
    const metrics = measureLabelMetrics(ctx, source.text);
    candidates.push({ ...source, fontSize, textWidth: labelTextWidth(metrics, fontSize) });
  }
  const placements = layoutLabels({
    candidates,
    view: input.view,
    viewport: input.viewport,
    contains: input.contains,
  });
  let drawn = 0;
  for (const placement of placements) {
    if (placement.visible) {
      drawn += 1;
    }
  }
  lastStats = { candidates: candidates.length, placed: placements.length, drawn };
  return placements;
}
```

Every label takes the same `fontSize`. A per-country size scaled by area was rejected: a
political map uses one type size per rank, and a continuous size makes small countries
illegible exactly where the fit test was going to hide them anyway.

**No layout cache.** The layout is a pure function of `(sources, view, viewport)`, all of
which change on every pan, and the whole pass is tens of rect comparisons after the metric
cache is warm. Caching it would be a keying problem for no measurable gain.

### 6.4 `drawCountryLabels`

Runs in the CSS-pixel transform `prepare` installed and `drawBorders` restored. It sets
context state and does **not** restore it, which is legal only because labels are the last
thing `drawOverlay` draws and `prepare` resets the transform every frame. If anything is
ever appended after labels, add the save/restore then.

```ts
function drawCountryLabels(ctx, placements) {
  for (const placement of placements) {
    if (!placement.visible) {
      continue;
    }
    const metrics = measureLabelMetrics(ctx, placement.text);
    const glyphs = Array.from(placement.text);
    const scale = placement.fontSize / METRIC_FONT_PX;
    const tracking = LETTER_SPACING_EM * placement.fontSize;

    ctx.font = labelFont(placement.fontSize);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = Math.max(HALO_WIDTH_MIN, placement.fontSize * HALO_WIDTH_RATIO);
    ctx.strokeStyle = LABEL_HALO;
    ctx.fillStyle = LABEL_FILL;

    // TWO PASSES. Halo for every glyph first, then fill for every glyph. A
    // per-glyph stroke-then-fill lets glyph N's halo eat the right edge of
    // glyph N-1's fill wherever the tracking is tighter than the halo width.
    let pen = placement.x;
    for (let i = 0; i < glyphs.length; i += 1) {
      ctx.strokeText(glyphs[i], pen, placement.y);
      pen += (metrics.advances[i] ?? 0) * scale + tracking;
    }
    pen = placement.x;
    for (let i = 0; i < glyphs.length; i += 1) {
      ctx.fillText(glyphs[i], pen, placement.y);
      pen += (metrics.advances[i] ?? 0) * scale + tracking;
    }
  }
}
```

**The halo is a stroke, not `shadowBlur`.** `shadowBlur` is the slow path in every 2D
canvas implementation and produces a soft glow; a political map wants a crisp casing.
`lineJoin: "round"` with `miterLimit: 2` keeps the casing from growing spikes at sharp
letter joins.

**The colours assume light map art.** T04 chose dark border ink
(`rgba(12, 9, 6, 0.85)`) for the same reason, so dark type with a light casing is the
consistent choice. The implementer must confirm this against a screenshot at fit zoom and
at 8x over both land and water. If the art turns out to be dark, swap the two constants
(`LABEL_FILL` light, `LABEL_HALO` dark) and record the swap in `memory.md`. Do not add a
runtime brightness probe.

---

## 7. `src/state/label-store.ts`

```ts
import { computed, signal } from "@preact/signals-react";
import { countryAggregates, maxProvinceId } from "./country-store";
import { countries, countryOfProvince } from "./world-store";
import { loadPhase, provinceAt, provinceById } from "./map-store";
import { resolveLabelAnchor } from "../map/label-layout";
import type { AnchorCandidate, CountryLabelSource } from "../map/label-layout";
import type { Point } from "../map/view";
import type { ReadonlySignal, Signal } from "@preact/signals-react";

const showLabels: Signal<boolean>;
const countryLabelSources: ReadonlySignal<readonly CountryLabelSource[]>;

function toggleLabels(): void;
function countryContainsPoint(countryId: number, x: number, y: number): boolean;
function clearLabelAnchorCache(): void;
function labelAnchorCacheSize(): number;

export {
  clearLabelAnchorCache,
  countryContainsPoint,
  countryLabelSources,
  labelAnchorCacheSize,
  showLabels,
  toggleLabels,
};
```

### 7.1 `countryContainsPoint`

```ts
function countryContainsPoint(countryId, x, y) {
  const provinceId = provinceAt(x, y);
  if (provinceId === null) {
    return false;
  }
  return countryOfProvince.peek().get(provinceId) === countryId;
}
```

`provinceAt` is `map-store`'s wrapper. It floors its arguments, returns `null` outside the
map and `null` on unpainted pixels — the sea — and returns `null` for everything until the
load finishes. All three are exactly what this predicate wants.

`.peek()`, not `.value`. This function is called from two places: from inside the
`countryLabelSources` computed, which already depends on `countries` and therefore on
everything `countryOfProvince` derives from, and from `drawOverlay` inside a
`requestAnimationFrame` callback where there is no tracking context at all. `.peek()` is
correct in both and cannot accidentally widen a dependency set.

### 7.2 The anchor cache

```ts
type AnchorEntry = { ids: readonly number[]; anchor: Point | null };
const anchorCache = new Map<number, AnchorEntry>();
```

Keyed by `countryId`, **validated by `provinceIds` array identity**. `assignProvinces` in
`world-store.ts` returns the same `Country` object — and therefore the same `provinceIds`
array — for every country it did not touch, and builds a fresh array for every country it
did. So `entry.ids === country.provinceIds` is an exact "the territory is unchanged" test
with no hashing.

This is what keeps a paint drag cheap. A pointermove changes at most the active country
and the previous owners of the painted provinces; every other country's anchor is a
`Map.get` and a `===`.

A rename changes `country.name` but not `country.provinceIds`, so it does not recompute
an anchor. Pinned by a test on `labelAnchorCacheSize()`.

### 7.3 `countryLabelSources`

```ts
const EMPTY: readonly CountryLabelSource[] = [];

const countryLabelSources = computed(() => {
  if (!showLabels.value) {
    return EMPTY;
  }
  // THE TRAP THIS FILE INHERITS: `provinceById` and `provinceAt` read
  // `getMapAssets()`, a plain module variable that notifies nobody. Without this
  // read, a country hydrated from localStorage never gets an anchor, because the
  // computed ran once before the map loaded and nothing invalidates it.
  if (loadPhase.value !== "ready") {
    return EMPTY;
  }
  void maxProvinceId.value;

  const aggregates = countryAggregates.value;
  const list = countries.value;
  const alive = new Set<number>();
  const out: CountryLabelSource[] = [];

  for (const country of list) {
    alive.add(country.id);
    const aggregate = aggregates.get(country.id);
    if (!aggregate || aggregate.bounds === null || aggregate.centroid === null) {
      continue;
    }
    const text = country.name.trim().toUpperCase();
    if (text === "") {
      continue;
    }
    const anchor = anchorFor(country, aggregate);
    if (anchor === null) {
      continue;
    }
    out.push({
      countryId: country.id,
      text,
      anchor,
      bounds: aggregate.bounds,
      area: aggregate.pixelCount,
    });
  }

  for (const id of [...anchorCache.keys()]) {
    if (!alive.has(id)) {
      anchorCache.delete(id);
    }
  }

  return out;
});
```

Gating on `loadPhase === "ready"` does double duty: it is the invalidation subscription,
**and** it guarantees no anchor is ever computed while `provinceAt` returns `null` for
every pixel. Without the gate the cache would fill with `null` anchors on the first pass
and no country would ever get a label. Do not replace it with a "compute anyway and
recompute later" scheme.

```ts
function anchorFor(country, aggregate) {
  const cached = anchorCache.get(country.id);
  if (cached && cached.ids === country.provinceIds) {
    return cached.anchor;
  }

  const candidates: AnchorCandidate[] = [];
  for (const provinceId of country.provinceIds) {
    const province = provinceById(provinceId);
    if (province === null) {
      continue;
    }
    candidates.push({
      x: province.centroid.x,
      y: province.centroid.y,
      pixelCount: province.pixelCount,
      bounds: province.bounds,
    });
  }
  // Descending by area, `x` then `y` breaking a tie so the order is total and
  // the anchor does not depend on the order `provinceIds` happens to be in.
  candidates.sort((a, b) => {
    return b.pixelCount - a.pixelCount || a.x - b.x || a.y - b.y;
  });

  const resolved = resolveLabelAnchor({
    countryId: country.id,
    centroid: aggregate.centroid,
    provinces: candidates,
    contains: countryContainsPoint,
  });
  const anchor = resolved === null ? null : resolved.point;
  anchorCache.set(country.id, { ids: country.provinceIds, anchor });
  return anchor;
}
```

`anchorFor` is a private helper. It is not exported; the pure half it delegates to is what
the tests cover.

### 7.4 `showLabels`

A plain writable `signal(true)`. `toggleLabels()` flips it. It exists as the verification
instrument for "the label is not in the sea" — press `L`, see what is underneath — and it
is deliberately **not** persisted. Nothing about labels enters `civitas.state.v1`.

---

## 8. Integration

### 8.1 `src/ui/render.ts`

`OverlayInput` gains two fields, both optional, so `drawOverlay` called without them still
produces byte-identical output to the T06 version. `render.test.ts` already asserts that
property for the T04/T06 fields; extend the assertion, do not replace it.

```ts
import { drawCountryLabels, layoutCountryLabels } from "./label-layer";
import type { ContainsFn, CountryLabelSource } from "../map/label-layout";

type OverlayInput = {
  // ... every existing field, unchanged ...
  // T07. In MAP pixels. `drawOverlay` measures and lays out; the caller only
  // supplies the sources, so no store type crosses into this module.
  labelSources?: readonly CountryLabelSource[] | null;
  countryContains?: ContainsFn | null;
};
```

Appended to `drawOverlay`, **after** the bounds hairline:

```ts
  // LAST. Labels sit on top of the tint, the highlights and both border layers,
  // because nothing may obscure them. They also draw in CSS pixels, which is the
  // transform `drawBorders` restored and the hairline used.
  if (input.labelSources && input.labelSources.length > 0) {
    const placements = layoutCountryLabels(ctx, {
      sources: input.labelSources,
      view,
      viewport,
      contains: input.countryContains ?? undefined,
    });
    drawCountryLabels(ctx, placements);
  }
```

`view` here is the local `snapView(input.view, ratio)` result already computed at the top
of `drawOverlay`. **Do not pass `input.view`.** The label positions must agree with the
art to the device pixel for the same reason the tint and the borders must.

Layering: `render.ts` may import `../map/label-layout` (pure, no state) and `./label-layer`
(a sibling ui module, the same direction as `./border-layer` and `./highlight-layer`). It
must **not** import `../state/label-store`. That is why `CountryLabelSource` is declared in
`src/map/label-layout.ts` and not in the store.

### 8.2 `src/ui/MapCanvas.tsx`

Four edits.

1. Import:
   ```ts
   import {
     countryContainsPoint,
     countryLabelSources,
     showLabels,
     toggleLabels,
   } from "../state/label-store";
   ```
   and `getLastLabelStats` from `./label-layer` for the HUD.

2. In `draw()`, two more fields on the `drawOverlay` call:
   ```ts
       labelSources: countryLabelSources.value,
       countryContains: countryContainsPoint,
   ```
   Reading `.value` inside `draw()` is safe — `draw` runs from a `requestAnimationFrame`
   callback, outside any tracking context, exactly like the existing `getTintCanvas()` read.

3. In the draw-scheduling `useSignalEffect`, one more line beside the existing `void`
   reads:
   ```ts
       void countryLabelSources.value;
   ```
   Without it a rename repaints nothing: no other signal in that effect changes when only
   `country.name` changes.

4. A window `keydown` listener toggling labels on `L`:
   ```ts
   useEffect(() => {
     const onKeyDown = (event: KeyboardEvent) => {
       if (event.altKey || event.ctrlKey || event.metaKey) {
         return;
       }
       if (event.key !== "l" && event.key !== "L") {
         return;
       }
       const target = event.target;
       // CountryPanel has text inputs. Typing an "l" into a country name must
       // not blank the map.
       if (target instanceof HTMLElement) {
         if (target.isContentEditable) {
           return;
         }
         const tag = target.tagName;
         if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
           return;
         }
       }
       toggleLabels();
     };
     window.addEventListener("keydown", onKeyDown);
     return () => {
       window.removeEventListener("keydown", onKeyDown);
     };
   }, []);
   ```

5. Two HUD readouts in `Hud`, beside `mode` and `active`:
   ```
   labels  <showLabels.value ? "on" : "off">
   placed  <stats.drawn>/<stats.candidates>
   ```
   `getLastLabelStats()` is a plain module variable and is one frame stale by construction.
   That is fine for an instrument: `Hud` re-renders on every `cursorMap` change, so the
   number is live while anyone is looking at it. It is T07 verification UI and T08 replaces
   the whole HUD.

### 8.3 What is NOT wired

- No `App.tsx` change. There is no init and no disposer — the store is a computed plus a
  `Map`, with no worker, no timer and no listener of its own.
- No `borders-store` change, no `country-store` change, no worker message.
- No CSS change. Labels are canvas pixels.

---

## 9. Tests

Run with `tsx --test`, beside the source, pure logic only. No DOM, no jsdom.

### 9.1 `src/map/label-layout.test.ts` — the bulk

**`labelFontSize`**

1. Returns `basePx` at `referenceScale`.
2. Clamps to `minPx` below the range and `maxPx` above it; `labelFontSize(8)` is `maxPx`.
3. Is monotonically non-decreasing over 200 samples from 0.05 to 8.
4. Returns `minPx` for `NaN`, `0`, `-1` and `Infinity`.
5. Is **sub-linear**: `labelFontSize(1.28) / labelFontSize(0.32)` is well under 4. This is
   the assertion that kills a "just multiply by scale" rewrite.

**`chamferDistance`**

6. An all-zero mask gives an all-zero result.
7. A single set cell in a 3 x 3 grid scores 1 — the out-of-grid neighbours count as
   background.
8. A 9 x 9 all-set grid peaks at the centre cell, and the peak is `> 4` (the √2 diagonals
   are doing their job; plain Manhattan would give exactly 5 there, so assert the shape of
   the field, not one number — see the test for the exact form).
9. The field is symmetric under a horizontal flip of a symmetric mask.

**`findInteriorPoint`**

10. A filled rectangle returns a point within one grid step of its centre.
11. Zero width, zero height, or negative bounds return `null`.
12. A mask with no in-shape sample at any level returns `null`.
13. **The crescent test.** `inside(x, y)` is "inside a circle of radius 100 at (150, 150)
    AND outside a circle of radius 72 at (196, 150)". The returned point must satisfy
    `inside`, and must be more than 40 units from (150, 150) — the naive centre is in the
    hole. This is the headline test for "do not let a label float in the sea".
14. A shape that thins out under refinement keeps the coarse answer rather than returning
    `null` (drive it with an `inside` that answers true only at level 0's sample grid).

**`resolveLabelAnchor`**

15. Centroid inside -> `source: "centroid"`, and the point equals the centroid exactly.
16. Centroid outside, first province candidate inside -> `source: "province"`, and the
    point is that province's centre. Assert it took the **first** candidate, i.e. the
    largest, by making a later smaller candidate also valid.
17. `candidateLimit` is honoured: with the only valid candidate at index 9 and a limit of
    8, the result falls through to the pole search, not to that candidate.
18. Centroid outside and every candidate outside -> `source: "pole"`, and `contains` is
    true at the returned point.
19. `centroid: null` with an empty `provinces` array returns `null`.
20. **The invariant, as a property test.** 200 pseudo-random shapes from a seeded LCG
    (union of two or three discs, one of them subtracted). For every shape that produces a
    non-null anchor, `contains(countryId, point.x, point.y)` is true. Nothing else in this
    task matters as much.
21. `contains` is never called with a different `countryId` than the one passed in.

**`rectsOverlap`**

22. Overlapping, disjoint, and **flush** (`a.x + a.width === b.x`) — flush is NOT an
    overlap.
23. Full containment counts as an overlap, both directions.

**`layoutLabels`**

24. **No two placed rects overlap.** Property test: 100 seeded random candidate sets of up
    to 30 candidates; assert pairwise non-overlap over the returned placements every time.
25. Largest area is placed first: two candidates at the identical anchor, one twice the
    area — the larger keeps `offsetIndex: 0`, the smaller is nudged or dropped.
26. Deterministic under input reordering: shuffle a candidate list ten ways, assert the
    output is deep-equal each time. Equal areas resolve by `countryId` ascending.
27. **The fit test, width.** A candidate whose `bounds.width * scale` is just under
    `textWidth * FIT_WIDTH_RATIO` is dropped; widen `bounds.width` by one map pixel and it
    is placed.
28. **The fit test, height.** Same, against `fontSize * FIT_HEIGHT_RATIO`.
29. **Pan invariance.** Lay out the same candidates twice with view translations 400 px
    apart. The set of placed `countryId`s and each placement's `offsetIndex` are identical;
    only `visible` and the absolute coordinates differ. This is the test that fails if
    someone "optimises" by culling off-screen candidates before the greedy pass.
30. A nudge that leaves the country is rejected: with `contains` returning true only at the
    anchor, a colliding label is dropped rather than moved.
31. A nudge that stays inside is taken: with `contains` always true, a colliding label
    comes back with `offsetIndex > 0` and a non-overlapping rect.
32. Geometry: `x === rect.x + LABEL_PADDING_X` and `y === rect.y + rect.height / 2` for
    every placement.
33. `visible` is false for a placement whose rect lies wholly outside the viewport, and the
    placement is still in the returned array.
34. A non-finite or non-positive `view.scale` returns `[]`.
35. Empty text, zero `textWidth` and zero `fontSize` are each skipped.

### 9.2 `src/ui/label-layer.test.ts` — recorder context

Build a fake context the way `render.test.ts` does. It records `fillText`, `strokeText`,
`measureText` and every style assignment, and `measureText` returns a width derived from
the px size parsed out of the `font` string it currently holds — so the 100 px reference
scaling is genuinely under test.

36. `labelFont(20)` is `"600 20px \"Inter\", \"Segoe UI\", system-ui, sans-serif"`.
37. `measureLabelMetrics` measures at `METRIC_FONT_PX` and **restores** `ctx.font` to
    whatever it held on entry.
38. It is cached: a second call for the same text issues zero further `measureText` calls.
39. It splits by code point: a string with one surrogate pair and one BMP character yields
    two advances.
40. `labelTextWidth` scales linearly in `fontSize` and adds exactly `n - 1` tracking gaps.
    Assert the `n - 1` directly against a hand-computed number.
41. `drawCountryLabels` strokes **every** glyph before it fills **any** — assert the index
    of the last `strokeText` is below the index of the first `fillText`.
42. Pen advance: the x of the last `fillText` equals
    `x + (sum of advances[0..n-2]) * fontSize / 100 + tracking * (n - 1)`.
43. A placement with `visible: false` produces no `fillText` and no `strokeText`.
44. `lineWidth` is `max(HALO_WIDTH_MIN, fontSize * HALO_WIDTH_RATIO)`, checked at a small
    and a large `fontSize` so both sides of the `max` are exercised.
45. `layoutCountryLabels` gives every candidate the same `fontSize`, equal to
    `labelFontSize(view.scale)`.
46. `getLastLabelStats` reports `candidates`, `placed` and `drawn`, and `drawn <= placed
    <= candidates`.
47. `clearLabelMetricsCache` forces a re-measure.

### 9.3 `src/ui/render.test.ts` — two appended tests

48. Labels draw **after** the bounds hairline: the index of the `strokeRect` call is below
    the index of the first `fillText`.
49. `drawOverlay` with `labelSources` omitted produces a call list identical to the same
    input with the field explicitly `null` and to the T06 baseline — no `fillText`, no
    `strokeText`, no `measureText`.

### 9.4 `src/state/label-store.test.ts` — what is reachable

In Node the manifest never loads, so `loadPhase` never becomes `"ready"` and
`countryLabelSources` can only ever be empty. That is a real constraint, not an oversight;
the T06 memory records the same limit for `maxProvinceId`. What is still worth pinning:

50. `countryLabelSources.value` is `[]` while `loadPhase` is not `"ready"`, even with
    countries in the store.
51. `showLabels` starts `true`; `toggleLabels` flips it both ways; with it `false` the
    computed is `[]` regardless of anything else.
52. `countryContainsPoint` returns `false` before the map loads, for every argument,
    including `NaN` and negative coordinates.
53. `clearLabelAnchorCache` empties the cache and `labelAnchorCacheSize` reports 0.

State honestly in `memory.md` that 50-53 are thin and that the real coverage is 9.1 and
9.2. Do not fabricate a fake `ProvinceIndex` in the store test to reach further — the
store's own logic is a cache lookup and a loop; the maths under it is fully covered.

### 9.5 Mutation check

Apply each mutant to the SOURCE alone, run `yarn test`, restore, and prove the restore with
a `shasum -a 256` compare, exactly as T06 did. Every one must be KILLED.

| # | Mutant |
|---|---|
| 1 | `labelFontSize` drops the exponent (linear in scale) |
| 2 | `labelFontSize` drops the `maxPx` clamp |
| 3 | `chamferDistance` uses weight 1 for diagonals |
| 4 | `chamferDistance` runs only the forward pass |
| 5 | `findInteriorPoint` returns the bbox centre instead of searching |
| 6 | `findInteriorPoint` runs one level instead of `GRID_LEVELS` |
| 7 | `resolveLabelAnchor` returns the centroid without testing `contains` |
| 8 | `resolveLabelAnchor` skips the province step and goes straight to the pole |
| 9 | `resolveLabelAnchor` ignores `candidateLimit` |
| 10 | `rectsOverlap` uses `<=` so flush rects collide |
| 11 | `layoutLabels` sorts by area ASCENDING |
| 12 | `layoutLabels` drops the `countryId` tie-break |
| 13 | `layoutLabels` culls off-screen candidates before the greedy pass |
| 14 | `layoutLabels` skips the `contains` test on nudged offsets |
| 15 | `layoutLabels` compares the fit test against `bounds.width` without `view.scale` |
| 16 | `layoutLabels` places a colliding label anyway instead of dropping it |
| 17 | `labelTextWidth` uses `n` tracking gaps instead of `n - 1` |
| 18 | `measureLabelMetrics` does not restore `ctx.font` |
| 19 | `measureLabelMetrics` uses `text.split("")` |
| 20 | `drawCountryLabels` interleaves stroke and fill per glyph |
| 21 | `drawCountryLabels` ignores `visible` |

---

## 10. Edge cases and failure modes

| Case | Behaviour |
|---|---|
| Country with no provinces, or only phantom ids 1318 / 1458 | `aggregateCountry` gives `bounds: null` and `centroid: null`. The source loop skips it. No label, no throw. |
| Country name empty or all whitespace | Skipped at the source loop, before any measurement. |
| Country name at the 120-char `NAME_MAX` | Measured normally. The fit test hides it at every zoom where it does not fit. No ellipsis and no wrapping — see section 11. |
| Two countries with equal `pixelCount` | `countryId` ascending breaks the tie. The output does not depend on array order. |
| Crescent or ring country | Step 1 fails the `contains` test; step 2 or step 3 answers. |
| Split country (islands) | The weighted centroid can land in the sea between them; step 2 puts the label on the largest island. |
| Anchor far off-screen | Placed normally (pan invariance), `visible: false`, not drawn. Guarded at `COORD_LIMIT` so a degenerate transform cannot produce absurd rects. |
| `view.scale` non-finite or `<= 0` | `drawOverlay` already returns before the label block; `layoutLabels` also returns `[]`. Two guards on purpose. |
| Viewport 0 x 0 | Every `visible` is false. Nothing draws. |
| dpr change | Font sizes are CSS px under the dpr transform. Nothing to do. |
| Map not loaded | `countryLabelSources` is `[]`. `drawOverlay` skips the whole block. |
| localStorage carries countries, map still loading | The computed re-runs when `loadPhase` reaches `"ready"`, because it reads `loadPhase.value`. This is the single easiest bug to ship in this task. |
| Surrogate pairs / combining marks in a name | `Array.from` keeps a code point whole. Combining marks still measure as separate advances and will look wrong; accepted, names are Latin. |
| Paint drag over 300 provinces | Anchors are cached on `provinceIds` identity, so only the touched countries recompute. |
| Anchor recomputation storm | Bounded: the expensive branch is step 3, and it needs both an outside centroid and eight outside province centres. |
| A label overlapping the `CountryPanel` or the HUD | Not handled. Those are DOM siblings above the canvas. Listed in section 11. |

---

## 11. Explicitly NOT part of T07

- **Province labels.** Only country names.
- **Curved or arced text.** Straight and horizontal. No rotation along a country's long
  axis, no text-on-a-path.
- **Line wrapping, abbreviation, ellipsis or auto-sizing to fit.** A name is drawn whole or
  hidden.
- **A true "does the text fit inside the shape" test.** The fit test is against the
  bounding box, per the brief. A run-length probe along the anchor row is a future
  refinement.
- **Per-country label size.** One size per frame for every label.
- **User-adjustable label position, a per-country offset, or any persisted label state.**
  Anchors are derived. `civitas.state.v1` gains no field.
- **Collision against the DOM chrome** — the `CountryPanel`, the HUD, the warning banner.
- **Web fonts, `@font-face`, `document.fonts` loading.** The stack is system-resolved.
- **Label fade in/out animation.** A label appears or does not.
- **Right-click country selection, the panel shell, flags, slogans** — T08 and T09.
- **Touch.** As everywhere else in this prototype.
- Anything under `../civitas-map`. Read-only reference.

---

## 12. Verification

### 12.1 Commands the implementer must run

From `javascript/packages/prototypes/civitas/civitas-interactive-map`:

```bash
yarn typecheck
yarn test
yarn build
```

`yarn typecheck` must print nothing and exit 0. `yarn test` must report the T06 baseline of
**348 passing** plus every new test, with **0 failed and 0 regressed** — quote the real
counts in `memory.md`. `yarn build` must emit only the three pre-existing asset-size
warnings for `map.png`, `provinces_map.png` and `provinces_manifest.json`. Do not silence
them.

Style self-checks, each must print nothing:

```bash
grep -rn "^export type \|^export default \|^export \(const\|let\|var\|function\|class\|interface\|type\|enum\|async\)\b" src/
grep -n "'" src/map/label-layout.ts src/ui/label-layer.ts src/state/label-store.ts
grep -n "if (.*) [^{]" src/map/label-layout.ts src/ui/label-layer.ts src/state/label-store.ts
awk "length > 100 {print FILENAME\": \"FNR}" src/map/label-layout.ts src/ui/label-layer.ts src/state/label-store.ts
```

The second may legitimately hit an apostrophe inside a prose comment; nothing else.

### 12.2 Browser checklist — `yarn dev`, Chrome

Quote a real reading for each. The tab is BACKGROUNDED between MCP tool calls, so
`requestAnimationFrame` never fires and nothing draws until a screenshot activates the tab.
T06's memory documents the workaround, including the `setPointerCapture` stubs needed to
dispatch synthetic pointer events. Reuse it.

1. **A label appears.** Create a country, paint 20 provinces, rename it. The name renders
   uppercase and tracked at the country's centre. Quote the HUD `placed` readout.
2. **Zoom range.** Screenshot at fit zoom, 100%, 300% and 800%. The label is legible at all
   four and is visibly smaller at fit than at 300%, and the SAME size at 300% and 800%
   (the `maxPx` clamp). Quote `zoom` from the HUD at each.
3. **Hidden when too small.** Zoom out until a small country's label disappears, then in one
   notch until it returns. Quote the two zoom percentages. Confirm it is the fit test and
   not a collision by pressing `L` twice and watching only that label change.
4. **No overlap.** Build six adjacent small countries. At fit zoom, screenshot and confirm
   no two labels touch. Quote `placed <drawn>/<candidates>` — `drawn` must be below
   `candidates` at some zoom, proving the greedy pass is actually dropping labels.
5. **Larger wins.** Two adjacent countries, one much larger, anchors close together. The
   larger one keeps its position; the smaller is nudged or gone.
6. **Never in the sea.** Build a ring-shaped country (paint a loop of provinces, leave the
   middle unassigned). Its label must sit on the ring, not in the hole. Press `L` and
   screenshot with labels off to confirm what is underneath. **This is the headline check.**
7. **Split country.** Assign two clusters far apart, one much larger. The label sits on the
   larger cluster, not between them.
8. **Pan invariance.** Note which labels are drawn, pan 600 px, pan back. The same labels
   are drawn, at the same country-relative positions. Nothing popped in or out except at
   the viewport edge.
9. **Halo legibility.** Screenshot a label crossing a country border and one over the
   busiest terrain in the art. The casing must keep every glyph readable. If it does not,
   raise `HALO_WIDTH_RATIO` or the halo alpha — and if the art turns out to be dark, swap
   `LABEL_FILL` and `LABEL_HALO` per section 6.4 and say so in `memory.md`.
10. **Alignment.** At 800%, pan and confirm the label does not swim against the art. It is
    positioned from the snapped view, so it must not.
11. **No freeze while painting.** Paint a 60-province drag with five countries labelled.
    The HUD `country` recompute readout must stay in the range T06 measured (1-11 ms).
12. **Reload with assignments.** Seed countries, hard reload, zero clicks. Labels appear
    without any interaction. This is the check that proves the `loadPhase` subscription in
    `countryLabelSources`.
13. **Rename repaints.** Rename a country and confirm the label changes without touching
    the map. This proves the `void countryLabelSources.value` line in the draw effect.
14. **`L` in a text field.** Type an "l" into a country name. The labels must not toggle.

---

## 13. Order of work

1. `src/map/label-layout.ts` and its test. Everything else depends on it and it is where
   the risk is. Get 9.1 green before writing a line of canvas code.
2. `src/ui/label-layer.ts` and its test.
3. `src/state/label-store.ts` and its test.
4. `src/ui/render.ts`, then `src/ui/render.test.ts`.
5. `src/ui/MapCanvas.tsx`.
6. `yarn typecheck` / `yarn test` / `yarn build`, then 12.2, then the mutation table.
