# T06 — Country model and province assignment

Read `javascript/CLAUDE.md`, `.plan/PLAN.md` sections 2-4, `README.md` and
`.plan/T04/memory.md` + `.plan/T05/memory.md` before writing a line. This design
extends T02-T05. It adds no second copy of anything they built.

---

## 0. Measured facts this design rests on

Read from `assets/provinces_manifest.json` during this pass. They are numbers, not
guesses, and section 3's choices follow from them.

| Fact | Value |
|---|---|
| Provinces | 1648, ids 1..1650 (1318 and 1458 absent) |
| Map | 3653 x 2855 = 10 429 315 px |
| Sum of ALL province bounding-box areas | **5 126 902 px** |
| Largest bounding box | 12 642 px |
| Median bounding box | 2 961 px |
| Sum of `pixelCount` (painted) | 2 756 578 px (26.4% coverage) |
| A map-sized RGBA canvas | 41 717 260 bytes (41.7 MB) |

The load-bearing one is **5.1 M**: repainting every province's bounding box costs
half a map scan, not a full one. Bounding boxes are 53.8% filled on average, so
per-province repainting is cheap enough that no whole-map rescan is ever needed.

Already measured by T04 and reused here: a full worker scan is 300-490 ms in the
browser; a country recompute off the retained crossings is **4-15 ms**;
`buildBorderPaths` on the main thread is **5.7 ms** for 180 tiles; the scene
`drawImage` is 0.8-4 ms.

---

## 1. What T06 delivers

1. Country CRUD in a real panel: create, rename, recolour, delete. Deleting a
   country releases its provinces (already true structurally — provinces live
   inside the country record).
2. A toggleable assignment mode. Left click assigns/removes, left drag paints
   across provinces, Alt forces erase, middle drag pans.
3. A country tint drawn on the existing overlay canvas.
4. Country borders driven from the real assignment through the existing T04
   worker, debounced.
5. Per-country derived aggregates: province count, pixel area, union bounding
   box, area-weighted centroid. Cached in a `computed`, unit tested.

---

## 2. Files

### 2.1 New

| File | Responsibility |
|---|---|
| `src/map/country-aggregate.ts` | PURE. `aggregateCountry`, `unionBounds`, `weightedCentroid`. No signals, no manifest import beyond types, no state import. Takes a province lookup as an argument. |
| `src/map/country-aggregate.test.ts` | The aggregate maths against a fake lookup. |
| `src/map/paint-path.ts` | PURE. `samplePathPixels` — the integer line walk that stops a fast drag from skipping provinces between two pointer samples. |
| `src/map/paint-path.test.ts` | Line-walk tests. |
| `src/ui/tint-layer.ts` | The map-sized offscreen tint canvas and its incremental repaint. `TINT_ALPHA`, `tintWordFor`, `buildTintPixels` (pure), `diffTintWords` (pure), `syncTintLayer`, `getTintCanvas`, `disposeTintLayer`. |
| `src/ui/tint-layer.test.ts` | `tintWordFor`, `buildTintPixels`, `diffTintWords` on a synthetic `ProvinceIndex`. |
| `src/state/country-store.ts` | `maxProvinceId`, `countryAggregates`, `countryTintWords`, and the debounced push of the assignment into the T04 border worker (`initCountrySync`, `flushCountryBorders`, `disposeCountrySync`). |
| `src/state/country-store.test.ts` | Aggregates recompute on assignment; the tint-word table; the debounce arms one timer per window. |
| `src/state/assign-store.ts` | Assign mode, active country, and the paint-stroke state machine. |
| `src/state/assign-store.test.ts` | Stroke action rules, the one-owner invariant, delete-releases-provinces, active-country auto-heal. |
| `src/ui/CountryPanel.tsx` | The CRUD panel and the mode toggle. Minimal chrome — T08 restyles it inside the real shell. |
| `src/ui/country-panel.module.css` | Its styles. One declaration per line. |

### 2.2 Changed

| File | Change |
|---|---|
| `src/ui/render.ts` | `OverlayInput` gains two OPTIONAL fields, `tint` and `tintSize`. `drawOverlay` draws the tint FIRST, before highlights. With both omitted the output is byte-identical to T04's. |
| `src/ui/render.test.ts` | Two tests: the tint draws before the highlights with a `sourceRect`-derived rectangle, and omitting `tint` changes nothing. Do not weaken an existing assertion. |
| `src/ui/MapCanvas.tsx` | Paint gesture, middle-button pan, the tint sync effect, the tint fields on `drawOverlay`, HUD readouts for mode/active country, **delete the two demo-country buttons**. |
| `src/ui/map-canvas.module.css` | `.host[data-mode="assign"]` cursor rules. |
| `src/state/borders-store.ts` | **Delete `applyDemoCountries`, `clearDemoCountries`, `DEMO_COLS`, `DEMO_ROWS`** and the now-unused `buildCountryOf` import. `noUnusedLocals` will catch a leftover. |
| `src/App.tsx` | Mount `CountryPanel`; call `initCountrySync()` in the mount effect beside `initWorldStore()` and dispose it on unmount. |
| `README.md` | Docs agent's job. A `## Countries, tint and assignment` section. |

### 2.3 Untouched

`src/map/borders.ts`, `src/map/borders.worker.ts`, `src/map/view.ts`,
`src/map/manifest.ts`, `src/map/province-index.ts`, `src/state/schema.ts`,
`src/state/persistence.ts`, `src/state/world-store.ts`, `src/state/migrations.ts`,
`src/state/image.ts`, `src/ui/border-layer.ts`, `src/ui/highlight-layer.ts`,
`package.json`, `tsconfig.json`, `rspack.config.mjs`, `index.html`, `assets/`,
`../civitas-map`. No dependency is added.

`world-store.ts` already ships everything the model needs — `addCountry`,
`updateCountry`, `deleteCountry`, `assignProvinces`, `buildCountryAssignment`.
**Do not add a country action to it.** T05 built `assignProvinces` as the single
one-owner entry point and T06 is its first caller.

---

## 3. The tint: one map-sized canvas, repainted per province

### 3.1 The decision

Three candidates:

| Approach | Per-frame cost | Update cost | Memory |
|---|---|---|---|
| A stamp per province, like `highlight-layer` | 1648 `drawImage` calls at fit zoom | tiny | 1648 canvases, ~20 MB |
| One map-sized tint canvas, one `drawImage` | **1 `drawImage`, same profile as `drawScene` (0.8-4 ms)** | one `putImageData` per changed province bbox (median 2 961 px) | 41.7 MB |
| Filled polygons | n/a | n/a | no polygons exist |

Take the second. The per-frame cost is what matters — it is paid 60 times a second
during a pan, while the update cost is paid once per click. 41.7 MB beside the
41.7 MB `ProvinceIndex.pixels` and the 41.7 MB art bitmap is a real cost and is
accepted deliberately.

It also satisfies "reuse the existing overlay canvas": the tint canvas is an
offscreen source, and the only thing that reaches the screen is one extra
`drawImage` inside the existing `drawOverlay`. There is no second rendering path
and no third on-screen canvas.

### 3.2 Tint words

A tint is one 32-bit word per province id, `0xAARRGGBB`, built with `>>> 0` so it
stays unsigned. **`0` means "no tint"** and is unambiguous, because a tinted
province always has alpha >= 1.

The word is unpacked byte by byte at write time and a `Uint32Array` view is never
taken over the pixel buffer — the same endianness rule
`src/map/province-index.ts` states at the top of the file. Copy that rule into a
comment here; a future agent will otherwise "optimise" it into a u32 view.

```ts
const TINT_ALPHA = 0.32;

// `alpha` is 0..1. Returns 0 for an unparseable hex or an alpha that rounds to 0,
// which is exactly the "no tint" word.
function tintWordFor(colorHex: string, alpha: number): number;
```

Rules: accept `/^#[0-9a-f]{6}$/i` only (the same shape `world-store.updateCountry`
admits), clamp `Math.round(alpha * 255)` into `1..255` when alpha > 0, return 0
when alpha <= 0 or the hex does not match.

0.32 is a starting value chosen to sit between the T04 hover fill (alpha 0.22) and
the select fill (0.44), so a hovered province still reads as hovered on top of its
country tint. **Tune it in the browser against the art** and keep it subtle; the
brief's bar is that the underlying render stays readable.

### 3.3 Building a bounding-box tile

```ts
function buildTintPixels(
  index: ProvinceIndex,
  bounds: Bounds,
  wordOf: (provinceId: number) => number,
): Uint8ClampedArray<ArrayBuffer>;
```

Pure — no DOM, so it is unit tested in Node. The `<ArrayBuffer>` argument is not
decoration: the default `ArrayBufferLike` admits a `SharedArrayBuffer` and
`new ImageData(...)` rejects that. `buildStampPixels` in `highlight-layer.ts` has
the same signature for the same reason.

```
out = new Uint8ClampedArray(bounds.width * bounds.height * 4)
for y in 0..height-1:
  for x in 0..width-1:
    id = index.provinceAt(bounds.x + x, bounds.y + y)
    if id === null: continue                 // stays fully transparent
    word = wordOf(id)
    if word === 0: continue
    at = (y * width + x) * 4
    out[at]     = (word >>> 16) & 0xff       // R
    out[at + 1] = (word >>>  8) & 0xff       // G
    out[at + 2] =  word         & 0xff       // B
    out[at + 3] = (word >>> 24) & 0xff       // A
```

**The critical difference from `buildStampPixels`.** The highlight stamp compares
against one province's packed colour and leaves every other pixel transparent.
This one resolves *whatever province actually owns each pixel* and paints that
province's current tint. It has to: bounding boxes overlap, and `putImageData`
REPLACES the destination rectangle including its alpha. A tile that left a
neighbour transparent would erase that neighbour's tint every time its own
province was repainted.

The consequence is a useful property: a bounding-box repaint always leaves the
rectangle globally correct with respect to `words`, so repainting the same
rectangle twice inside one batch is idempotent and order does not matter.

### 3.4 The layer

`src/ui/tint-layer.ts` holds three module variables: the canvas, its 2d context,
and `painted: Uint32Array` — the words currently on the canvas, indexed by
province id.

```ts
type TintSync = { repainted: number; cleared: boolean; created: boolean };

function syncTintLayer(
  index: ProvinceIndex,
  words: Uint32Array,
  lookup: (provinceId: number) => Province | null,
): TintSync;

function getTintCanvas(): HTMLCanvasElement | null;   // null when nothing is tinted
function disposeTintLayer(): void;
function diffTintWords(painted: Uint32Array, wanted: Uint32Array): number[];   // PURE
```

Algorithm of `syncTintLayer`:

1. `words.length <= 1` (the map has not loaded): if anything is painted, clear;
   return.
2. No canvas yet: `document.createElement("canvas")` at
   `index.width x index.height`, `getContext("2d")`; a null context returns
   `{ repainted: 0, cleared: false, created: false }` and the tint stays off.
   `painted = new Uint32Array(words.length)`.
3. `painted.length < words.length`: allocate a longer one and `set` the old
   contents into it. In practice this fires exactly once, when `maxProvinceId`
   goes 0 -> 1650.
4. **All-zero fast path.** If every entry of `words` is 0 and something is
   painted, `ctx.clearRect(0, 0, w, h)`, zero `painted`, set `hasTint = false`,
   return `{ cleared: true }`. This is what makes "delete the only country"
   instant instead of 5.1 M pixel writes.
5. Otherwise, for each id from `diffTintWords(painted, words)`:
   - `province = lookup(id)`. If null (an id the manifest lacks — 1318, 1458, or
     a hostile stored document), set `painted[id] = words[id]` and skip. Nothing
     to draw.
   - `pixels = buildTintPixels(index, province.bounds, (pid) => pid < words.length ? words[pid] : 0)`
   - `ctx.putImageData(new ImageData(pixels, bounds.width, bounds.height), bounds.x, bounds.y)`
   - `painted[id] = words[id]`
6. `hasTint` = true when any entry of `words` is non-zero. `getTintCanvas`
   returns null when `hasTint` is false, so a project with no countries pays
   exactly the T04 overlay cost.

`document.createElement` stays inside a function body so the module still imports
under Node for its test. Same trick as `highlight-layer.ts`.

Costs, from section 0: one province is a median 2 961-pixel `putImageData`, well
under a millisecond. A 300-province country deleted in one action is ~930 k pixel
writes, roughly 10-20 ms — one dropped frame, not a freeze. The absolute worst
case, every province changing at once, is 5.1 M writes. A whole-canvas rebuild
would be 10.4 M writes *with a `Map` lookup per pixel*, i.e. 150-250 ms, so the
per-bounding-box path is always the cheaper one. Do not add a "just rebuild
everything" threshold.

### 3.5 Drawing it

`src/ui/render.ts`, inside `drawOverlay`, immediately after the degenerate-scale
guard and BEFORE the highlights:

```ts
if (input.tint && input.tintSize) {
  const rect = sourceRect(view, viewport, input.tintSize);
  if (rect) {
    ctx.imageSmoothingEnabled = shouldSmooth(view.scale, ratio);
    ctx.drawImage(input.tint, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
  }
}
```

- `view` is the already-snapped `snapView(input.view, ratio)` the function
  computed. The tint must snap with the art or it slides half a device pixel.
- `tintSize` is the **MAP** size 3653 x 2855, not the art size 3652. The tint
  canvas is built from `ProvinceIndex`, which is map-sized. Only `drawScene`'s
  `sourceRect` call takes the art size. `drawEdgeColumn` has no analogue here and
  must not be copied.
- `shouldSmooth(view.scale, ratio)`, the same rule the art uses. A magnified tint
  must be nearest-neighbour or its edges blur off the province boundaries.
- Order: tint, highlights, province borders, country borders, hairline. Tint goes
  under the highlights so a hovered province still reads.

Both new fields are optional so `render.test.ts`'s "omitted fields draw exactly
what T03 drew" test stays green with no edit.

---

## 4. Country data: `src/state/country-store.ts`

Signals only; no DOM. It imports `tintWordFor` from `../ui/tint-layer` — the same
direction `borders-store.ts` already imports `buildBorderPaths` from
`../ui/border-layer`.

### 4.1 `maxProvinceId`

```ts
const maxProvinceId: ReadonlySignal<number>;
```

`computed`: returns 0 unless `loadPhase.value === "ready"` and `getMapAssets()` is
non-null, otherwise the highest `province.id` in the manifest (1650). Reading
`loadPhase.value` is what makes every downstream computed invalidate when the map
finishes loading — `getMapAssets()` is a plain module variable and notifies
nobody. **This is the trap in this file.** Every computed below that touches the
manifest must read a signal that moves when the manifest arrives.

### 4.2 `countryTintWords`

```ts
const countryTintWords: ReadonlySignal<Uint32Array>;
```

```
max = maxProvinceId.value
out = new Uint32Array(max + 1)
for country of countries.value:
  word = tintWordFor(country.colorHex, TINT_ALPHA)
  for provinceId of country.provinceIds:
    if provinceId >= 1 and provinceId <= max: out[provinceId] = word
return out
```

The hex is parsed once per country, not once per province. Index 0 stays 0 —
`NO_PROVINCE` is never tinted.

### 4.3 `countryAggregates`

```ts
const countryAggregates: ReadonlySignal<ReadonlyMap<number, CountryAggregate>>;
```

`computed` over `countries.value` and `maxProvinceId.value` (the second only to
subscribe to the manifest's arrival), calling the pure `aggregateCountry` per
country with `provinceById` as the lookup. **The `computed` IS the cache the brief
asks for**: it recomputes only when the countries array identity changes, which is
exactly "on assignment change", and `assignProvinces` returns without writing when
nothing actually changed.

Cost of a full recompute: 1648 `Map` lookups plus arithmetic, tens of
microseconds. Per-country memoisation would be more code for no measurable gain.

### 4.4 The border push

```ts
type CountrySyncOptions = { timers?: Timers; delayMs?: number };

function initCountrySync(options?: CountrySyncOptions): () => void;
function flushCountryBorders(): void;
function disposeCountrySync(): void;
```

`initCountrySync` builds a debouncer with `createStateWriter` from
`./persistence` — it is a generic fixed-window trailing debounce with injectable
timers, and duplicating it would be worse than borrowing a slightly misnamed
export. Default `delayMs` here is **120**, not T05's 400.

It then registers an `effect()` from `@preact/signals-react` that reads
`countryOfProvince.value`, `borderPhase.value` and `maxProvinceId.value`, and
calls `writer.schedule()`. Reading `borderPhase` matters: the first push usually
happens while the worker is still scanning, when `setCountryAssignment` returns
early, so the effect must re-run when the scan completes. It returns a disposer
that stops the effect and cancels the writer.

The write callback:

```
max = maxProvinceId.peek()
if (max <= 0) return
setCountryAssignment(buildCountryAssignment(max))
```

`buildCountryAssignment` is T05's function and already routes through
`buildCountryOf`. Do not write a second conversion.

**Why debounce at all, when `borders-store` already coalesces?** The coalescing
bounds worker concurrency at one in flight plus one queued, but every response
still costs `buildBorderPaths` on the MAIN thread — 5.7 ms for 180 tiles. At 30
pointermove events a second that is 17% of the frame budget plus the garbage of
180 discarded `Path2D` objects each time. 120 ms caps a one-second drag at ~8
recomputes while keeping the border visibly live.

`flushCountryBorders()` fires the pending push immediately. `endStroke` calls it,
so releasing the mouse updates the border within one worker round trip instead of
waiting out the window.

The effect calls no world-store action and writes no signal that it reads, so it
does not violate the "no action inside a signal effect" rule. `setCountryAssignment`
runs from a timer callback, outside any tracking context.

---

## 5. Aggregates: `src/map/country-aggregate.ts`

Pure. It imports only the `Bounds`, `Point` and `Province` **types** from
`./manifest`. It must not import anything from `src/state/`, which is why it takes
a lookup rather than a `Country`.

```ts
type CountryAggregate = {
  countryId: number;
  // Ids the user assigned, including any the manifest does not carry.
  provinceCount: number;
  // Ids that resolved to a manifest province. `provinceCount` when the document
  // is clean; smaller when it carries a phantom id.
  resolvedCount: number;
  pixelCount: number;
  bounds: Bounds | null;
  centroid: Point | null;
};

function unionBounds(a: Bounds | null, b: Bounds): Bounds;
function aggregateCountry(
  countryId: number,
  provinceIds: readonly number[],
  lookup: (provinceId: number) => Province | null,
): CountryAggregate;
```

`unionBounds`: `x = min(ax, bx)`, `y = min(ay, by)`,
`width = max(ax + aw, bx + bw) - x`, `height = max(ay + ah, by + bh) - y`.

`aggregateCountry`:

```
wx = wy = weight = 0        // area-weighted accumulators
sx = sy = n = 0             // unweighted fallback accumulators
pixelCount = 0
bounds = null
for id of provinceIds:
  p = lookup(id); if (p === null) continue
  n += 1
  bounds = unionBounds(bounds, p.bounds)
  w = p.pixelCount > 0 ? p.pixelCount : 0
  pixelCount += w
  wx += p.centroid.x * w; wy += p.centroid.y * w; weight += w
  sx += p.centroid.x;     sy += p.centroid.y
centroid =
  weight > 0 ? { x: wx / weight, y: wy / weight }
: n > 0      ? { x: sx / n,      y: sy / n }
: null
```

- **Not rounded.** T07 places a label at this point and wants the sub-pixel value.
  Rounding is the caller's business.
- The unweighted fallback covers a manifest whose `pixelCount` is 0 — impossible
  on the shipped asset, trivially possible in a test or a re-export. It must not
  produce `NaN`, and `0 / 0` is what an unguarded weighted mean returns.
- A country with no resolvable province gets `bounds: null`, `centroid: null`,
  `pixelCount: 0`. T07 skips it rather than drawing a label at (0, 0).
- The weighted centroid is a centroid of centroids, not the true centre of mass of
  the union. It is what the brief specifies and it is what a label wants — the
  true value would need a pixel pass.

---

## 6. Assignment mode: `src/state/assign-store.ts`

### 6.1 Public API

```ts
type StrokeAction = "assign" | "erase";

const assignMode: ReadonlySignal<boolean>;
const activeCountryId: ReadonlySignal<number | null>;
const painting: ReadonlySignal<boolean>;

function setAssignMode(on: boolean): void;
function toggleAssignMode(): void;
function setActiveCountry(id: number | null): void;

// PURE, exported for its test.
function strokeActionFor(
  provinceId: number | null,
  countryId: number,
  ownerOf: ReadonlyMap<number, number>,
  altKey: boolean,
): StrokeAction;

// Returns the action the whole stroke is locked to, or null when no stroke started.
function beginStroke(provinceId: number | null, altKey: boolean): StrokeAction | null;
function extendStroke(provinceIds: readonly number[]): void;
function endStroke(): void;
function cancelStroke(): void;
```

### 6.2 Active country auto-heals

`activeCountryId` is a `computed` over a private `activeIdSignal` and
`countryById.value`: it returns null when the id names no country. Deleting the
active country therefore disarms assignment with no extra wiring, and no stale id
can reach `assignProvinces`. Assign mode itself is left on and simply inert.

### 6.3 The stroke

Stroke state is a plain module variable, not a signal — nothing renders from it
except `painting`:

```ts
let stroke: { countryId: number; action: StrokeAction; visited: Set<number> } | null = null;
```

**The action is decided once, at `beginStroke`, and held for the whole stroke.**
This is the rule that makes drag-to-paint usable. Deciding per province would make
a drag that re-enters a province toggle it back, and a drag that crosses a rival
country would leave a trail of half-assigned provinces.

`strokeActionFor` — the whole rule in one pure function:

```
if (altKey) return "erase"
if (provinceId !== null and ownerOf.get(provinceId) === countryId) return "erase"
return "assign"
```

So clicking a province already in the active country removes it, clicking anything
else assigns it (reassigning it away from its previous owner), and Alt always
erases. That is the brief's "adds it / reassigns or removes it" made unambiguous.

`beginStroke(provinceId, altKey)`:
1. `assignMode.peek()` false -> return null.
2. `activeCountryId.peek()` null -> return null. The caller then falls back to a
   pan gesture, so the map stays usable with the mode armed but no country picked.
3. `action = strokeActionFor(provinceId, countryId, countryOfProvince.peek(), altKey)`.
4. `stroke = { countryId, action, visited: new Set() }`, `paintingSignal.value = true`.
5. If `provinceId !== null`, apply it.
6. Return `action`.

`extendStroke(provinceIds)` takes a **batch**, one call per pointermove event.
Filter out ids already in `visited`, add the rest, then apply them in one call.
One `assignProvinces` per event instead of one per province: each call replaces
the countries array and invalidates `countryOfProvince`, `countryTintWords` and
`countryAggregates`, so batching removes a straight N-times multiplier for free.

`applyStroke(ids)`:
```
if (stroke === null or ids.length === 0) return
if (!countryById.peek().has(stroke.countryId)) { cancelStroke(); return; }
assignProvinces(stroke.action === "assign" ? stroke.countryId : null, ids)
```

**The `has` check is mandatory.** T05 pinned that `assignProvinces` with an id
naming no country still strips the provinces from their owners. Without the check,
a country deleted mid-stroke turns the rest of the drag into a silent mass
unassign.

Erase passes `null`, which strips the province from whatever country holds it —
an eraser erases, it does not check ownership first.

`endStroke()`: clear `stroke`, `paintingSignal.value = false`, then
`flushCountryBorders()`. `cancelStroke()` is the same without the flush; a pointer
cancel keeps whatever was already applied (the writes are already in the store)
but does not force an extra worker round trip.

### 6.4 The line walk: `src/map/paint-path.ts`

A pointermove at 60 Hz during a fast flick can jump 100+ CSS px, which at the
0.317 fit scale is over 300 map pixels — dozens of skipped provinces. Sampling
only the event's own pixel leaves holes in the painted region.

```ts
const MAX_PATH_SAMPLES = 4096;

// Visits integer map pixels from (x0, y0) to (x1, y1) inclusive. Returns the
// number of samples taken.
function samplePathPixels(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (x: number, y: number) => void,
): number;
```

```
dx = x1 - x0; dy = y1 - y0
steps = max(abs(dx), abs(dy))
if (steps === 0) { visit(x0, y0); return 1 }
count = min(steps, MAX_PATH_SAMPLES)
for i in 0..count:
  t = i / count
  visit(Math.round(x0 + dx * t), Math.round(y0 + dy * t))
return count + 1
```

The cap makes the cost bounded no matter how far the pointer jumped. Above the cap
the walk subsamples, which can skip a one-pixel-wide province on a viewport-length
flick — an acceptable trade against an unbounded loop, and unreachable in practice
(a full-viewport flick at fit scale is ~3 000 map px).

Non-finite inputs return 0 and visit nothing.

`getCoalescedEvents()` is deliberately NOT used. The line walk covers the same gap
and is testable in Node.

---

## 7. `MapCanvas.tsx`

### 7.1 Gesture union

```ts
type Gesture =
  | { kind: "idle" }
  | { kind: "pan"; pointerId; startX; startY; originX; originY; moved: boolean }
  | { kind: "paint"; pointerId; lastX: number; lastY: number };
```

`lastX` / `lastY` are MAP pixels, the start point of the next line walk.

### 7.2 `onPointerDown`

```
if (isHudControl(target)) return
if (!view.value) return
event.preventDefault()

if (event.button === 1) { start a PAN gesture; capture; return }   // middle drag always pans
if (event.button !== 0) return

if (assignMode.value) {
  pixel = mapPixelAt(...)
  id = pixel ? provinceAt(pixel.x, pixel.y) : null
  if (beginStroke(id, event.altKey) !== null) {
    capture; gesture = { kind: "paint", pointerId, lastX: pixel.x, lastY: pixel.y }
    return
  }
  // no active country: fall through to pan, so the map still works
}
start a PAN gesture exactly as T03 does
```

Middle-button drag is the pan in assign mode. `preventDefault` on the pointerdown
stops Chrome's autoscroll; also add `onAuxClick` with `preventDefault` on the host.

When `pixel` is null (the press landed outside the map bounds), do not start a
paint stroke — fall through to pan.

### 7.3 `onPointerMove`

The existing cursor and hover updates run first and unchanged, in both modes. Then:

```
if (gesture.kind === "paint" && gesture.pointerId === event.pointerId) {
  if (!pixel) return                      // pointer left the map; the stroke waits
  ids = []
  samplePathPixels(gesture.lastX, gesture.lastY, pixel.x, pixel.y, (x, y) => {
    id = provinceAt(x, y)
    if (id !== null) ids.push(id)
  })
  extendStroke(ids)
  gesture.lastX = pixel.x; gesture.lastY = pixel.y
  return
}
```

`extendStroke` dedupes, so pushing the same id many times along one line costs a
`Set.has` each.

### 7.4 `onPointerUp` / cancel / leave

- `paint` gesture on button 0: `endStroke()`, release capture, gesture = IDLE.
- `pointercancel` and `lostpointercapture`: `cancelStroke()` as well as the
  existing pan teardown.
- `onPointerLeave`: the existing hover clear, plus `cancelStroke()` if a paint
  gesture was live. Pointer capture normally keeps the events coming, so this is
  the belt-and-braces path.
- The T04 placeholder select (`setSelectedProvince`) stays for the non-assign
  path. T08 owns it; do not extend it here.

### 7.5 The tint sync effect

```tsx
useSignalEffect(() => {
  const words = countryTintWords.value;
  void loadPhase.value;
  const assets = getMapAssets();
  if (!assets) {
    return;
  }
  syncTintLayer(assets.index, words, provinceById);
  scheduleDraw();
});
```

It writes no signal, so it is legal inside `useSignalEffect`. `void loadPhase.value`
is required for the same reason as in `maxProvinceId` — `getMapAssets()` notifies
nobody.

`draw()` passes the tint through:

```ts
tint: getTintCanvas(),
tintSize: size,
```

`getTintCanvas()` is read fresh inside `draw`, exactly as `getProvinceBorderPaths()`
is, so no signal carries the canvas. Add `disposeTintLayer()` to the existing
unmount cleanup beside `disposeBorders()`.

### 7.6 HUD

Delete the two demo buttons and the whole `.hudActions` block if nothing else
lives there (`CountryPanel` supersedes it). Replace with two readouts: `mode`
(`assign` / `pan`) and `country` (the active country's name or `—`). Keep the
existing border/scan/segs readouts; they are still the instrument for section 10.

`.host` gains `data-mode={assignMode.value ? "assign" : "pan"}`; CSS sets
`cursor: crosshair` for `assign` and `cursor: cell` while `painting` is true.

---

## 8. `CountryPanel.tsx`

Mounted in `App.tsx` as a sibling of `MapCanvas`, so its pointer events never
reach the map host and it needs no `data-hud-control` guard. Anchored top-left,
`z-index: 2`, its own scroll region.

`useSignals()` at the top. It reads `countries`, `activeCountryId`, `assignMode`,
`countryAggregates`.

Contents:

- Header: `Countries` and a `+ new` button.
  `+ new` -> `const country = addCountry(); setActiveCountry(country.id);`
  `addCountry()` with no name yields `"Country N"` and a palette colour already.
- A mode toggle button. Label `assign: on` / `assign: off`. **Disabled when
  `activeCountryId.value === null`**, with a title explaining why.
- A one-line hint: `left drag paints · alt erases · middle drag pans`.
- The country list. One row per country in store order:
  - `<input type="color">` bound to `country.colorHex`.
  - `<input type="text">` bound to `country.name`, `onChange` ->
    `updateCountry(id, { name })`.
  - A readout from `countryAggregates`: `<provinceCount> prov · <pixelCount> px`.
    Format `pixelCount` with `toLocaleString()`.
  - A delete button with a **two-step confirm**: the first click arms the row
    (component `useState` holding the armed id) and relabels the button `delete?`,
    the second within ~3 s calls `deleteCountry(id)`. Deleting a 300-province
    country with one misclick and no undo is not acceptable.
  - Clicking the row (not a control) calls `setActiveCountry(id)`; the active row
    carries `data-active="true"`.
- An `Escape` keydown listener on `window`, installed in a `useEffect`, calling
  `setAssignMode(false)`.

**The colour-input trap.** React's `onChange` on an input fires on the native
`input` event, and dragging inside the OS colour picker emits dozens a second.
Each one would replace the countries array and repaint every province of that
country — ~20 ms for a 300-province country, i.e. a locked UI while the user drags
the picker. Route colour edits through an 80 ms trailing debounce held in a
`useRef`, and keep the input's displayed value in local state so it stays
responsive. Flush the debounce on unmount.

Name edits do not need this: a name change does not touch the tint, and
`world-store` already skips a write that changes nothing.

---

## 9. Integration points, by name

Called, not reimplemented:

| From | Function |
|---|---|
| `state/world-store.ts` | `addCountry`, `updateCountry`, `deleteCountry`, `assignProvinces`, `buildCountryAssignment`, `countries`, `countryById`, `countryOfProvince` |
| `state/borders-store.ts` | `setCountryAssignment`, `borderPhase` |
| `state/map-store.ts` | `loadPhase`, `getMapAssets`, `provinceAt`, `provinceById`, `mapSize` |
| `state/view-store.ts` | `mapPixelAt`, `view`, `viewport`, `dpr`, `panTo`, `zoomAtPoint`, `setCursor`, `panning` |
| `state/selection-store.ts` | `setHoveredProvince`, `setSelectedProvince` |
| `state/persistence.ts` | `createStateWriter`, `type Timers`, `type StateWriter` |
| `map/view.ts` | `sourceRect`, `shouldSmooth`, `snapView` (all already inside `render.ts`) |
| `map/province-index.ts` | `ProvinceIndex.provinceAt` (through `buildTintPixels`) |
| `ui/render.ts` | `drawOverlay` — extended, not replaced |

Deleted: `applyDemoCountries`, `clearDemoCountries` and their HUD buttons.

---

## 10. Edge cases and failure modes

| Case | Required behaviour |
|---|---|
| Assign mode on, no active country | The toggle is disabled; a left drag pans. The map never becomes unusable. |
| Active country deleted mid-stroke | `applyStroke` finds no country and calls `cancelStroke`. Nothing is mass-unassigned. |
| Active country deleted between strokes | `activeCountryId` computes to null; the mode goes inert; the toggle disables. |
| Delete a country | Its provinces are released (they lived in its record). The tint's all-zero fast path or the per-bbox diff clears them. `countryOfProvince` shrinks and the border push fires. Province overrides are NOT touched — T05's rule. |
| Assign a province to the country that already owns it | `assignProvinces` no-ops via its `sameIds` check. No signal write, no tint work, no border push. |
| Painting over another country's province | `assignProvinces` strips it from the old owner first. Exactly one word changes; only that province's bounding box is repainted. |
| A stored id the manifest lacks (1318, 1458) | `provinceById` returns null. The aggregate skips it (`resolvedCount < provinceCount`); `syncTintLayer` marks it painted and draws nothing. Never throw. |
| Province id 0 / a click on the sea | `provinceAt` returns null; nothing is pushed into the stroke. |
| Click outside the map bounds | `mapPixelAt` returns null; no stroke starts. |
| Map not loaded yet | `maxProvinceId` is 0, `countryTintWords` has length 1, `syncTintLayer` returns immediately, the border push returns early. All hydrated countries appear the moment the load completes, because both computeds read `loadPhase`. |
| Border worker failed (`borderPhase === "failed"`) | `setCountryAssignment` returns early with no worker. Tint and aggregates still work. Country borders are simply absent. |
| localStorage quota hit while painting | `world-store` raises the `quota` warning and keeps the in-memory state. Painting keeps working; the map is correct; only the save failed. |
| Country with zero provinces | Aggregate `{ provinceCount: 0, pixelCount: 0, bounds: null, centroid: null }`. The panel shows `0 prov`. T07 draws no label. |
| Every province in one country | Country borders reduce to the coastline (T04 pins this). The tint covers 2.76 M pixels. Both are fine. |
| 65535-country ceiling | `addCountry` already warns and returns the last country. Nothing new. |
| A hex the colour input never produces | `tintWordFor` returns 0 -> that country simply has no tint, rather than a black one. `updateCountry` already rejects a malformed hex. |
| Touch input | A one-finger drag paints, so pan is unreachable on touch while the mode is on. Accepted; this is a desktop prototype. Note it in the README. |
| Two tabs | Still clobber each other, unchanged from T05. Out of scope. |

Failure modes to design against, each with a named cause:

- **A `Uint32Array` view over the tint pixel buffer.** Machine-dependent byte
  order; the tint comes out with red and blue swapped on nothing in particular.
  Write the four bytes.
- **`buildTintPixels` copied from `buildStampPixels`.** Comparing against one
  province's packed colour leaves neighbours transparent, and `putImageData` then
  erases their tint. The visible symptom is provinces losing their colour when a
  neighbour is painted.
- **Passing the art size 3652 as `tintSize`.** The last column of the tint is then
  never drawn and the tint drifts against the art at high zoom.
- **Forgetting `snapView`.** `drawOverlay` already snaps; passing `input.view`
  into `sourceRect` instead of the snapped one puts the tint half a device pixel
  off the art.
- **A signal effect that calls a world-store action.** The store's computeds are
  read by the same effect and it loops. The tint effect and the border-push effect
  are both write-free; keep them that way.
- **Pushing the assignment on every pointermove.** 5.7 ms of main-thread
  `buildBorderPaths` per response. The 120 ms debounce is not optional.

---

## 11. Tests

Node's runner through `tsx`, files beside their source. Pure logic only — no DOM,
no canvas, no React. The signal stores ARE testable in Node; T05 proved it.

### 11.1 `src/map/country-aggregate.test.ts`

1. A single province gives its own centroid, its own bounds and its own
   `pixelCount`.
2. Two provinces with `pixelCount` 1000 and 9000 at x = 0 and x = 100 put the
   centroid at x = 90, not 50. **This is the test that catches an unweighted
   mean**, which is the likeliest wrong implementation.
3. The union bounds of two disjoint provinces spans both, including the case where
   the second is entirely above and left of the first.
4. An empty country returns `provinceCount: 0`, `bounds: null`, `centroid: null`.
5. A country of ids the lookup does not resolve returns `provinceCount: 3`,
   `resolvedCount: 0`, `bounds: null`, `centroid: null` — and does not throw.
6. A mix of resolvable and unresolvable ids aggregates only the resolvable ones,
   and `provinceCount !== resolvedCount`.
7. All-zero `pixelCount` falls back to the unweighted mean and never returns
   `NaN`.
8. The centroid is not rounded: a 1/3 result stays fractional.

### 11.2 `src/map/paint-path.test.ts`

1. A horizontal run visits every integer x exactly once, endpoints included.
2. A zero-length path visits its single point once.
3. A 45-degree diagonal visits `steps + 1` points and every one is on the line.
4. A path longer than `MAX_PATH_SAMPLES` is capped at `MAX_PATH_SAMPLES + 1`
   visits and still ends on the endpoint.
5. A non-finite coordinate visits nothing and returns 0.

### 11.3 `src/ui/tint-layer.test.ts`

Uses a synthetic `ProvinceIndex` over a small NON-SQUARE grid — a square grid
hides a transposed index, as `province-index.test.ts` already notes.

1. `tintWordFor("#c0563f", 0.32)` unpacks to r 192, g 86, b 63, a 82, and the word
   is positive (the `>>> 0`).
2. `tintWordFor` returns 0 for `"c0563f"`, `"#xyz"`, `""` and for alpha 0 or a
   negative alpha. An alpha above 1 clamps to 255.
3. `buildTintPixels` paints only the pixels whose own province carries a non-zero
   word, in R, G, B, A order.
4. **A bounding box that overlaps a neighbouring province paints the neighbour in
   the NEIGHBOUR's colour, not transparent.** The one that pins section 3.3.
5. Unpainted pixels inside the bounding box stay `0, 0, 0, 0`.
6. A province whose word is 0 leaves its own pixels transparent, which is how an
   unassignment erases.
7. `diffTintWords` returns exactly the ids that differ, in ascending order, and
   returns an empty array for identical inputs.
8. `diffTintWords` handles `wanted` longer than `painted` (the 0 -> 1651 growth)
   by treating the missing entries as 0.

### 11.4 `src/state/assign-store.test.ts`

Resets with `initWorldStore({ storage: fakeStorage(), timers: fakeTimers() })`.

1. `strokeActionFor` returns `"erase"` for a province already in the active
   country, `"assign"` for one in another country, `"assign"` for an unowned one,
   and `"erase"` for every case with `altKey`.
2. `beginStroke` returns null when the mode is off, and null when no country is
   active. Nothing in the store changed.
3. **One owner.** Country A holds provinces 1-5, country B is active, a stroke
   paints 3, 4, 5 and 6. Afterwards A holds 1 and 2, B holds 3, 4, 5, 6, and
   `countryOfProvince.value.size` equals the sum of both `provinceIds` lengths —
   the invariant stated as a count, so a duplicate cannot hide.
4. The stroke action is locked at `beginStroke`: a stroke started on a province of
   the active country erases every later province it crosses, including ones it
   does not own.
5. `extendStroke` applied twice with the same id changes nothing the second time
   (the `visited` set).
6. Deleting the active country mid-stroke: `applyStroke` cancels and the remaining
   ids are NOT unassigned from their owners.
7. `deleteCountry` releases its provinces — `countryOfProvince` loses every one of
   them and no other country gains them.
8. `activeCountryId` goes null when its country is deleted and the private id is
   never resurrected by a later `addCountry` reusing the number (ids are
   monotonic, so assert the id is not reused).
9. `endStroke` clears `painting`; `cancelStroke` clears it too.

### 11.5 `src/state/country-store.test.ts`

1. `countryTintWords` puts the country's word at each of its province ids and 0
   everywhere else, including index 0.
2. Two countries with different colours produce two different words, and both
   change when `updateCountry` changes a colour.
3. `countryAggregates` recomputes after `assignProvinces` — the same object
   identity before, a different one after.
4. In Node the manifest never loads, so `maxProvinceId` is 0 and
   `countryTintWords` has length 1. Assert that explicitly; it is the guard that
   proves nothing reads the manifest eagerly.
5. The border-push debounce with injected timers: five rapid assignment changes
   arm exactly ONE timer. Count `set` calls, not `pending()` — T05 recorded that
   `pending()` alone cannot tell a fixed window from a restarting one, and that
   mutant survived the first time.
6. `flushCountryBorders` fires the pending push immediately and disarms the timer.

### 11.6 `src/ui/render.test.ts` (+2)

1. With `tint` and `tintSize` supplied, `drawImage` is called with the tint source
   FIRST, before any highlight or border call, and its destination rectangle is
   the one `sourceRect` returns for the snapped view.
2. With `tint` omitted the call log is identical to the T04 case. The existing
   "omitted fields draw exactly what T03 drew" test must still pass unedited.

### 11.7 Mutation check

Apply each mutant to the source alone, run `yarn test`, restore, and prove the
restore with a `shasum -a 256` before and after. Each must fail at least one test:

| Mutant | Kills |
|---|---|
| `aggregateCountry` uses an unweighted mean | 11.1.2 |
| `aggregateCountry` returns `{ x: 0, y: 0 }` instead of null for an empty country | 11.1.4 |
| `unionBounds` uses `max(width)` instead of `max(x + width) - x` | 11.1.3 |
| `buildTintPixels` compares the target province's packed colour, like `buildStampPixels` | 11.3.4 |
| `buildTintPixels` writes B, G, R, A | 11.3.3 |
| `tintWordFor` drops the `>>> 0` | 11.3.1 |
| `diffTintWords` iterates `painted.length` | 11.3.8 |
| `strokeActionFor` decides per province instead of per stroke (move the call into `applyStroke`) | 11.4.4 |
| `applyStroke` drops the `countryById.has` guard | 11.4.6 |
| `assignProvinces` called per province instead of per batch | none — it is an optimisation, not a behaviour. Do not write a test for it. |
| The border push is not debounced | 11.5.5 |
| `samplePathPixels` visits only the endpoint | 11.2.1 |

### 11.8 Not covered, and why

`syncTintLayer`'s canvas half, `getTintCanvas`, `CountryPanel.tsx`, the pointer
handling in `MapCanvas.tsx`, `initCountrySync`'s `effect()` registration. All need
a canvas, a DOM or React, and PLAN section 4 forbids those tests — there is no
jsdom. Section 12's browser checklist is their gate.

---

## 12. Verification

Run every command from
`javascript/packages/prototypes/civitas/civitas-interactive-map`.

### 12.1 Commands, in order

```bash
yarn typecheck                 # exit 0, no output
yarn test                      # 271 before this task; every new test passes, none regress
yarn build                     # exit 0; only the 3 pre-existing asset-size warnings
ls dist                        # the separate border-worker chunk must still be there
```

Style self-checks, all must come back empty or comment-only:

```bash
grep -rn "^export type" src/
grep -rn "^export \(const\|function\|class\|interface\|enum\|async\)" src/
grep -n "'" src/map/country-aggregate.ts src/map/paint-path.ts src/ui/tint-layer.ts \
            src/state/country-store.ts src/state/assign-store.ts \
            src/ui/CountryPanel.tsx src/ui/country-panel.module.css
grep -rn "applyDemoCountries\|clearDemoCountries" src/     # must return nothing
```

`src/scaffold.test.ts` enforces the grouped-export rule itself, so a stray inline
`export` fails `yarn test` too. Write `export { type Foo };`, never
`export type { Foo };`.

### 12.2 Browser checklist — `yarn dev`, in Chrome

Every item needs a real reading, quoted in `memory.md`. T04's memory records that
a workflow subagent may fail to reach Chrome; if that happens, say so explicitly
and leave the item open rather than claiming it.

1. **CRUD.** `+ new` three times gives `Country 1/2/3` with three different
   palette colours. Rename one; reload; the name survives. Recolour one; the tint
   changes with no visible stall while the OS picker is dragged.
2. **Paint.** With `Country 1` active and the mode on, click a province: it tints
   immediately and a country border appears around it within a beat. Drag across
   ~30 provinces in one stroke: all of them tint, none is skipped, and the frame
   rate stays usable. Record `country <ms> / <segments>` from the HUD before and
   after.
3. **Re-click removes.** Clicking a province already in the active country
   un-tints it, and the country border closes back up.
4. **Reassign.** With `Country 2` active, paint over a province owned by
   `Country 1`. It changes colour once, `Country 1` loses it, and no province ends
   up in both — read `countries` out of localStorage and check for a duplicate id.
5. **Alt erases.** Alt-drag across a painted region clears it.
6. **Middle drag pans** while the mode is on, and the wheel still zooms.
7. **Delete.** Delete a country holding 30+ provinces. The tint and its borders
   disappear in one frame; the other country is untouched; reload confirms it.
8. **No freeze.** During a 2-second paint drag, `border`/`country` in the HUD keep
   updating and the map keeps panning under the middle button. Record the
   per-recompute milliseconds. Anything over ~50 ms per recompute means the
   debounce or the coalescing is not working.
9. **Tint subtlety.** At 100% zoom the province art, the province borders and the
   country borders are all still legible through the tint. Screenshot it. If not,
   lower `TINT_ALPHA` and say so.
10. **Alignment.** At 800% zoom the tint edge and the province border stroke
    coincide to the pixel, the same check T04 ran for the highlight stamp
    (`stroke 429-429`, `fill 430-925`, `stroke 926-926`). Read the overlay back
    with `getImageData` and quote the runs.
11. **Empty state.** With no countries at all, the overlay draws exactly what T04
    drew — `getTintCanvas()` returns null and no tint `drawImage` happens.
12. **Reload with assignments.** 50+ provinces assigned, hard reload: the tint and
    the country borders come back after the load, without a click.

---

## 13. Explicitly NOT part of T06

- **Country name labels on the map.** T07. T06 only supplies the
  area-weighted centroid they sit on.
- **Right-click country selection, `selectedCountryId`, the country highlight
  fill, the EU-style shell and its panel chrome.** T08. The T04 left-click
  placeholder in `MapCanvas.tsx` stays a placeholder; `selection-store.ts` is not
  touched.
- **Country flag, slogan and lore editing.** T09. `CountryPanel` here handles name
  and colour only; T09 replaces it with the real overview panel.
- **The province list.** T10.
- **Economics.** T11/T12. `setCountryEconomics` is not called.
- Undo/redo, an assignment history, rectangle select, lasso select, "assign all
  neighbours", flood fill, and multi-province selection.
- Auto-assigning provinces by contiguity, colour or any heuristic.
- Touch-friendly paint/pan disambiguation.
- Cross-tab sync of assignments.
- Any change to the border extraction algorithms, the worker protocol, the view
  transform, or the persistence schema. The `Country` record already carries
  `provinceIds` and `colorHex`; no migration is needed and none may be added.
- Any change to `package.json`, `tsconfig.json`, `rspack.config.mjs`,
  `index.html`, `assets/` or `../civitas-map`.
- Silencing the pre-existing `yarn build` asset-size warnings.
- A WebGL or `OffscreenCanvas` tint path, a tint mip chain, or a second on-screen
  canvas.
