# T04 — think agent handoff

Design: `.plan/T04/DESIGN.md`. The algorithms are written out; follow them literally.

## Decided, with reasons

- **Stroke width is SCREEN space: 1 CSS px for provinces, 2.25 CSS px for countries.**
  The zoom range is 25x (0.317 fit scale to the 8x cap). A 1-map-pixel border is
  0.32 CSS px at fit — it breaks into a dashed line — and 8 CSS px at the cap, fatter
  than the province blocks it separates. No map-space width works at both ends.
- **Therefore borders are stroked paths, not a blitted mask.** Scaling a bitmap scales
  its features, so a mask necessarily has map-space width. Only `lineWidth = widthCss /
  view.scale` under a map->screen transform gives a zoom-independent width.
- **I benchmarked all three candidates in a real browser** on the real 132 190 merged
  runs (numbers in DESIGN section 0). Tiled stroking is also the *fastest* option at
  every zoom above fit, and within 1 ms of the best at fit: 0.93 ms at fit, 0.04 ms at
  8x on dpr 1. A mask blit measured 3.7-18.6 ms. So the correct choice is also the fast
  one; there is no tradeoff to agonise over.
- **Borders are emitted as collinear-merged runs, not per-pixel coordinates.**
  215 177 crossings merge into 132 190 runs. Runs go into a flat `Float32Array` of
  segment endpoints bucketed into 256-px tiles with a `Uint32Array` offset table — two
  transferable buffers, no objects, per the brief.
- **Segments sit on the shared grid line, not on the up-left pixel.** The crossing set is
  exactly the brief's rule; only the geometry differs. A grid line straddles both
  provinces equally, and it is what a stroke needs.
- **Country recompute walks a retained crossing list, not the bitmap.** A country
  boundary is always a subset of the province crossings, so the worker keeps
  ~215 k pixel indices (0.9 MB) plus the id bitmap (20.9 MB) and rebuilds country runs in
  a few ms instead of rescanning 10.4 M pixels. That is the answer to "design the API so
  T06 can recompute cheaply".
- **The worker gets a `.slice()` copy of `index.pixels`, never the original.** T02 left a
  comment on that field: a transfer detaches it and every later `provinceAt` reads zeroes.
- **`mapPixelsToIds` uses a 33.5 MB `Uint16Array(1 << 24)` lookup table**, not a `Map`.
  One indexed read per pixel instead of a hash lookup, ~40 ms instead of ~200 ms. It is
  transient; do not retain it.
- **One draw path, not a split scene/overlay frame.** Both hover setters deduplicate, so
  a repaint only happens when the cursor actually crosses a province boundary. Repainting
  the scene too costs one `drawImage`. Two rAF handles were not worth it.
- **New file `src/state/selection-store.ts`.** T08 owns selection, but the brief demands
  a working hover/selected input now, and T08 extending this file is cheaper than T08
  unpicking component state.

## Surprises found by measuring

- Only **180 869** of 10.4 M pixels are border pixels — 1.7 %. The scan is big, the
  output is small.
- **49 488 of the 215 177 crossings are coastline** (a province against unpainted). Treating
  `NO_PROVINCE` as a participating id is what gives the landmass an outline; two unpainted
  neighbours are equal so the open sea stays clean.
- **The largest province bounding box is 12 642 pixels** (median 2 960). Building a hover
  highlight stamp is therefore sub-millisecond — no need for a mask, a polygon, or a
  worker round trip.
- **Tiled `Path2D` stroking beat whole-map stroking 4x at the fit scale** even though both
  draw all 133 k segments. Smaller path bounding boxes rasterise better. Do not "simplify"
  the tiles away.
- **The reference package's `dist` already contains a worker chunk** (`300.*.js`), so
  rspack 2.1.4 handles `new Worker(new URL("./x.worker.ts", import.meta.url), { type:
  "module" })` with no config change. If no extra chunk appears in `dist`, the `new URL`
  argument was hoisted into a variable and rspack lost the static reference.
- Average run length is 1.63 pixels, so splitting runs at tile boundaries barely grows the
  segment count. Split rather than duplicate — culling stays exact and there is no overdraw.

## Traps

- **Pass `snapView(view, dpr)` into the border draw**, the same value `drawScene` uses.
  The raw view puts borders up to half a device pixel off the art. That is the drift the
  done-condition forbids.
- **`drawBorders` must restore `setTransform(dpr, 0, 0, dpr, 0, 0)`** before returning;
  the bounds hairline that follows draws in CSS pixels.
- **Keep the T03 bounds hairline.** It is the instrument that proves the two canvases have
  not diverged, and section 9.3's alignment check needs it.
- **Borders use the MAP size 3653 x 2855.** Only `sourceRect` in `drawScene` takes the art
  size 3652. Do not "fix" the scan.
- **`countryOf[0]` must be 0.** Index 0 is `NO_PROVINCE`, not a province. The worker forces
  it on receipt.
- Province ids run 1..1650 for 1648 provinces; 1318 and 1458 are absent. Size `countryOf`
  by the max id and leave the holes at 0.
- `src/scaffold.test.ts` scans every file in `src/` for inline exports. A line starting
  `export type { ... }` **fails** it. Use `export { type Foo };`.
- `tsconfig` has no `WebWorker` lib. Narrow `self` locally in the worker, as
  `../civitas-map/src/map/detect-worker.ts` does. Do not add a second tsconfig.
- Make every new `OverlayInput` field optional so `src/ui/render.test.ts` stays green
  without edits.
- `noUnusedLocals` + `noUnusedParameters` are on.

## Ground truth for the tests

Measured against the real asset. Pin these exactly:

```
borderPixels     180869      verticalCrossings   103835    horizontalCrossings 111342
verticalRuns      66074      horizontalRuns       66116
```

The strongest single test is the identity property: `countryRuns` with `countryOf[p] = p`
must reproduce `scanBorders`'s run set exactly. It exercises the whole recompute path
against the whole scan path, on the real bitmap.

---

# Implementation (attempt 1)

## Files created

| File | What it is |
|---|---|
| `src/map/borders.ts` | All the extraction logic, pure. `mapPixelsToIds` (33.5 MB transient LUT, one indexed read per pixel), `scanBorders` (one row-major pass emitting crossings AND collinear-merged runs), `countryRuns` (walks the retained crossings, never the bitmap), `buildBorderTiles` (counting sort, segments SPLIT at tile edges), `visibleTiles`, `buildCountryOf`. Two private growable typed-array builders so every returned array owns its buffer and is transferable. |
| `src/map/borders.test.ts` | 31 tests. Hand-built synthetic bitmaps with hand-written expectations, plus the five real-asset pins and the identity property over the real crossings. |
| `src/map/borders.worker.ts` | Worker shell. Retains `ids` (20.9 MB) and `crossings` (~0.9 MB), handles `scan` and `countries`, forces `countryOf[0] = 0`, transfers `[tiles.data.buffer, tiles.offsets.buffer]`, wraps everything in try/catch. No logic of its own. |
| `src/state/borders-store.ts` | Worker lifecycle, phase/error/stats signals, `bordersVersion`, `ensureBordersScanned`, `setCountryAssignment` (latest-wins + coalescing), `disposeBorders`, and the T04-only `applyDemoCountries` / `clearDemoCountries`. |
| `src/state/selection-store.ts` | `hoveredProvinceId` / `selectedProvinceId` and deduplicating setters. T08 extends this file. |
| `src/ui/border-layer.ts` | `buildBorderPaths` (one `Path2D` per tile), `drawBorders` (map transform, `lineWidth = widthCss / view.scale`, restores the CSS-pixel transform), `PROVINCE_BORDER` / `COUNTRY_BORDER`. |
| `src/ui/highlight-layer.ts` | `buildStampPixels` (pure), `drawProvinceHighlight` (32-entry insertion-ordered stamp cache), `clearHighlightCache`. |
| `src/ui/highlight-layer.test.ts` | 3 tests over `buildStampPixels` on a synthetic non-square `ProvinceIndex`. |

## Files changed

| File | Change |
|---|---|
| `src/ui/render.ts` | `OverlayInput` gains four optional fields; `drawOverlay` draws highlights, province borders, country borders, then the unchanged bounds hairline. |
| `src/ui/render.test.ts` | +4 tests (11 -> 15): the omitted-fields byte-identity check, draw order + snapped map transform + hairline last, the screen-space `lineWidth`, highlights skipped without an index. No existing test weakened. |
| `src/ui/MapCanvas.tsx` | `ensureBordersScanned()` effect, `disposeBorders()` in the unmount cleanup, the four new `drawOverlay` fields, hover on pointer move, placeholder select on a non-drag left click, a separate `onPointerCancel` (a cancelled pointer must not select), HUD extended with border phase / scan ms / segs / country ms + the two demo buttons. |
| `src/ui/map-canvas.module.css` | `.hudActions` (`pointer-events: auto`) and `.hudButton`. |

No dependency added. `rspack.config.mjs`, `tsconfig.json`, `package.json`, `assets/` and `../civitas-map` untouched.

## Deviations from DESIGN.md

Three `borderPixels` expectations in DESIGN section 8.2 are arithmetically wrong; the code is right and the tests assert the correct values, with a comment saying why:

- 5x5 with one odd centre pixel: design says 4, correct is **3**. There are four crossings but the centre pixel carries two of them and `borderPixels` counts PIXELS. The real-asset pin proves the counting rule: 180 869 < 103 835 + 111 342.
- 4x4 checkerboard `borderPixels`: design says 16, correct is **15**. The bottom-right pixel has neither a right nor a bottom neighbour.
- 4x4 checkerboard run count: design implies 12 one-pixel runs each way; correct is **3 full-length runs** each way. Every interior boundary of a checkerboard is unbroken along its own axis, so the collinear merge fires. The test now asserts the exact triples, which is a stronger check of the merge than the design's version.

`buildStampPixels` returns `Uint8ClampedArray<ArrayBuffer>`, not bare `Uint8ClampedArray`: the default `ArrayBufferLike` admits a `SharedArrayBuffer` and `new ImageData(...)` rejects that under TS 5.9.

## Verification

### `yarn typecheck`

```
$ yarn typecheck
$ echo $?
0
```

(no output, exit 0)

### `yarn test`

```
✔ mapPixelsToIds resolves palette colours and maps everything else to 0 (1.406875ms)
✔ mapPixelsToIds does not alias UNPAINTED onto the white province (0.091125ms)
✔ a 3x3 split down the middle gives exactly one vertical run (0.198417ms)
✔ a 4x4 checkerboard borders on every interior edge and merges each into one run (0.19825ms)
✔ an open horizontal run does not leak across a row boundary (0.075333ms)
✔ the identity assignment reproduces the province run set exactly (0.242709ms)
✔ one country over everything leaves only the coastline (0.050625ms)
✔ a country change splitting a long boundary in the middle gives two runs (0.061ms)
✔ a countryOf shorter than the ids present reads the missing ones as country 0 (0.045833ms)
✔ a non-zero countryOf[0] classifies unpainted pixels, which is why the worker zeroes it (0.057792ms)
✔ splitting at a tile boundary preserves total segment length (0.084417ms)
✔ visibleTiles covers the whole grid when the whole map is on screen (0.063417ms)
✔ visibleTiles keeps a one-tile margin on every side (0.030291ms)
✔ visibleTiles refuses a degenerate view (0.030417ms)
✔ the real province bitmap yields exactly the measured border geometry (218.58525ms)
✔ the identity assignment reproduces the real run counts through the recompute path (5.341916ms)
✔ tiling the real runs preserves their total length (9.574917ms)
✔ the stamp paints the province's own pixels and nothing else (0.700834ms)
✔ drawOverlay with the T04 fields omitted draws exactly what T03 drew (0.073833ms)
✔ borders draw under the map transform and the hairline still comes last (0.363875ms)
✔ stroke width is screen space: lineWidth is the CSS width divided by the scale (0.254291ms)
✔ highlights are skipped when no province index is supplied (0.056167ms)
✔ drawOverlay clears and returns for a degenerate scale (0.051542ms)
ℹ tests 173
ℹ suites 0
ℹ pass 173
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 483.664542
```

Test count 135 -> **173** (+38: 31 in `borders.test.ts`, 3 in `highlight-layer.test.ts`, 4 in `render.test.ts`). All five real-asset pins from DESIGN section 0 hold exactly.

### `yarn build`

```
$ rm -rf dist && yarn build
WARNING in ⚠ asset size limit: The following asset(s) exceed the recommended size limit (300.000 KiB). This can impact web performance.
  │ Assets:
  │   assets/map.png (2.530 MiB)
  │   assets/provinces_map.png (552.626 KiB)
  │   assets/provinces_manifest.json (586.891 KiB)

Rspack compiled with 1 warning in 80 ms

$ ls dist
84.37e5f932b7b1a078.js
assets
index.html
main.604df15fc084edc9.css
main.897be2739aaac9c7.js
```

Only the two pre-existing asset-size warnings. **`84.37e5f932b7b1a078.js` is the separate worker chunk** (4.3 KB) — DESIGN section 9.1's check that the `new URL` argument was not hoisted. Confirmed with:

```
$ grep -c "scanBorders\|onmessage" dist/84.37e5f932b7b1a078.js
1
$ grep -o "new Worker" dist/main.897be2739aaac9c7.js | wc -l
1
```

### Single-quote check

```
$ grep -n "'" <every new/changed file>
```
24 hits, every one inside a comment or a test name (`the brief's rule`, `calloc'd`, `the art's last column`, ...). Zero single-quoted string literals.

### Dev server serves

```
$ yarn dev   # → http://localhost:58118/
$ curl -s -o /dev/null -w "%{http_code}" http://localhost:58118/            → 200
$ curl -s -o /dev/null -w "%{http_code}" .../assets/provinces_manifest.json → 200
```

### Alignment and timing, measured against the real asset

Design 9.3/9.4/9.5 ask for browser measurements. **I could not drive Chrome** — the browser tool requires an interactive browser-selection confirmation from the user, which a workflow subagent cannot obtain. I ran the equivalent measurement in Node instead, through the SHIPPED modules (`scanBorders` -> `buildBorderTiles` -> `visibleTiles` -> the exact transform arithmetic `drawBorders` installs), on the real 3653 x 2855 bitmap, at a 1728 x 906 viewport with dpr 2. Ground truth is read straight from the decoded bitmap: the map `x` values on row 1400 where the province id changes between `x` and `x + 1`.

```
worker scan     : convert 14.2 ms, scan 35.9 ms, tile 6.2 ms, total 56.3 ms
main-thread copy: 2.1 ms for 39.8 MB
segments        : 132500 in 15x12 tiles
country recompute: 3.9 ms, 36020 runs, 36086 segments
scale fit  0.3173 : 68 seams on row 1400, 68 strokes drawn, 68 matched, worst offset 0.000000 device px, lineWidth 3.1512 map px = 2.00 device px (country 4.50)
        first 6 expected: 1218.27, 1248.10, 1279.84, 1285.55, 1294.43, 1305.22
        first 6 drawn   : 1218.27, 1248.10, 1279.84, 1285.55, 1294.43, 1305.22
scale 1.0   : 51 seams on row 1400, 67 strokes drawn, 51 matched, worst offset 0.000000 device px, lineWidth 1.0000 map px = 2.00 device px (country 4.50)
        first 6 expected: 32.00, 132.00, 174.00, 198.00, 284.00, 354.00
        first 6 drawn   : 32.00, 132.00, 174.00, 198.00, 284.00, 354.00
scale 8.0   : 6 seams on row 1400, 23 strokes drawn, 6 matched, worst offset 0.000000 device px, lineWidth 0.1250 map px = 2.00 device px (country 4.50)
        first 6 expected: 256.00, 1056.00, 1392.00, 1584.00, 2272.00, 2832.00
        first 6 drawn   : 256.00, 1056.00, 1392.00, 1584.00, 2272.00, 2832.00
scale fit  0.3173 : spurious strokes on row 1400 = 0
scale 1.0   : spurious strokes on row 1400 = 0
scale 8.0   : spurious strokes on row 1400 = 0
```

Reading these:

- **Alignment is exact, not "within a pixel": worst offset 0.000000 device px at all three zoom levels.** Every seam in the bitmap is stroked, and every stroke maps back to a real seam (`spurious = 0`). The `drawn > matched` counts at 1.0 and 8.0 are seams just outside the viewport, inside the one-tile margin `visibleTiles` keeps on purpose.
- **Width is screen space**: the drawn thickness is **2.00 device px** for province borders and **4.50** for country borders at 0.3173, 1.0 AND 8.0 — a 25x zoom range with a constant width. `lineWidth` in map units moves from 3.1512 to 0.1250 to compensate, which is exactly `widthCss / view.scale`. A map-space width would have gone 0.32 -> 1 -> 8 device px.
- **The scan cannot block first paint**: 56.3 ms of it runs in the worker. The only new main-thread cost is the 39.8 MB `pixels.slice()` at **2.1 ms**, and it happens in an effect after the map is already rendered. (Node timings; a browser worker will differ, and DESIGN 9.2's 100-250 ms estimate is the right expectation there.)
- **The country recompute is cheap**: **3.9 ms** for the 8-country demo assignment against 56.3 ms for a full rescan — 14x less, and it never touches the 10.4 M-pixel bitmap. Well under the 50 ms ceiling DESIGN 9.5 sets.

The script that produced this lived at the package root as `t04-verify.ts` and has been **deleted**; it is not part of the deliverable.

### Mutation check (DESIGN 8.8)

Each mutant applied to `src/map/borders.ts` one at a time, `src/map/borders.test.ts` run, then the source restored.

| Mutant | Required | Actually failing |
|---|---|---|
| `scanBorders` never closes `openH` at end of row | ≥ 1 | **6** |
| `scanBorders` closes `openV` unconditionally each row | ≥ 1 | **11** |
| `scanBorders` uses `<=` instead of `<` in `x + 1 < width` | ≥ 1 | **16** |
| run geometry drops the `+ 1` on `x` / `y` | ≥ 1 | **2** |
| `countryRuns` compares province ids instead of country ids | ≥ 2 | **6** |
| `countryRuns` drops the `last[x] !== y - 1` adjacency test | ≥ 1 | **3** |
| `buildBorderTiles` duplicates instead of splitting | ≥ 1 | **4** |
| `visibleTiles` drops the `-1` / `+1` margin | ≥ 1 | **2** |
| `mapPixelsToIds` masks with `0xffffff` before the `UNPAINTED` test | ≥ 1 | **2** |

```
source restored byte-identical: True
```

(SHA-256 of `borders.ts` compared before and after the whole run.)

## Deliberately left undone

- **The browser checklist, DESIGN 9.2 and 9.6-9.8**, is NOT done: first paint observed live, hover/selection felt by hand, per-frame `drawOverlay` cost during a real pan, and the forced-worker-failure path. The browser tool needs an interactive confirmation I cannot produce here. 9.3/9.4/9.5 are covered numerically above; **9.2, 9.6, 9.7 and 9.8 still need a human or a reviewer with a browser.** Nothing was temporarily broken and left broken — no worker URL was ever edited.
- No unit tests for `borders.worker.ts`, `borders-store.ts`, `selection-store.ts`, `buildBorderPaths`, the highlight canvas wrapper or `MapCanvas.tsx`. All need a worker, a canvas, a DOM or signals; PLAN section 4 forbids those and there is no jsdom. This matches DESIGN 8.9.
- The border style values are the design's starting values, untuned against the art in a browser (DESIGN 6.3 says to tune them and keep the ratio).
- Everything in DESIGN section 10 stays out: country CRUD and the real assignment UI, map tinting, labels, right-click country selection, country highlight fills, persistence. The left-click select in `MapCanvas.tsx` is marked in-code as a T08 placeholder, and `applyDemoCountries` / `clearDemoCountries` are marked as T06 deletes.

---

# Implementation (attempt 2)

Attempt 1 was rejected on two blocking findings. Both are fixed, and the browser
checklist that attempt 1 skipped was actually run. A Chrome instance was reachable
this time.

## Files changed

| File | Change |
|---|---|
| `src/ui/MapCanvas.tsx` | **BLOCKING FIX 1.** New `isHudControl(target)` helper; `onPointerDown`, `onPointerUp` and `onDoubleClick` return early when the event originated inside `[data-hud-control]`. The demo-country buttons moved out of the readout row into their own anchored box (see below) and carry `data-hud-control`. HUD gained a `reason <message>` field fed by `borderError`. |
| `src/ui/map-canvas.module.css` | `.hudActions` is now `position: absolute; bottom: 12px; right: 12px` instead of the last cell of the readout flex row. |

Nothing else was touched. `src/map/borders.ts`, `borders.test.ts`,
`borders.worker.ts`, `borders-store.ts`, `selection-store.ts`, `border-layer.ts`,
`highlight-layer.ts`, `highlight-layer.test.ts`, `render.ts` and `render.test.ts`
are byte-identical to attempt 1. No dependency added. `../civitas-map` untouched.

### Why the buttons also moved

The pointer-capture guard alone is not enough to make the buttons usable. The
readouts and the buttons were one flex row, so the province name growing and
shrinking as the pointer crosses the map slid the buttons sideways — measured
108 CSS px of travel between "province —" and "province 314 Province 314". A
pointer approaching a button changes the readout and moves the button out from
under itself; in the browser this made the button a 2-cycle that could not be hit
at all. Anchoring the actions to the host's bottom-right corner fixes it and
costs one CSS rule. This is also why the reviewer's requested check could not
have passed with the guard alone.

### Why `borderError` is now in the HUD

DESIGN 9.8 requires "`border failed` in the HUD **with a message**". Attempt 1
rendered the phase only, so a failed scan looked like a slow one. One conditional
span.

## Verification — real command output

### `yarn typecheck`

```
$ yarn typecheck
$ echo $?
0
```

(no output, exit 0)

### `yarn test`

```
✔ borders draw under the map transform and the hairline still comes last (0.376166ms)
✔ stroke width is screen space: lineWidth is the CSS width divided by the scale (0.266708ms)
✔ highlights are skipped when no province index is supplied (0.07775ms)
✔ drawOverlay clears and returns for a degenerate scale (0.050166ms)
ℹ tests 173
ℹ suites 0
ℹ pass 173
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 473.269084
```

173/173, unchanged from attempt 1 — the fix is in the two files that have no unit
tests (PLAN section 4 forbids DOM tests), so the count could not move.

### `yarn build`

```
$ rm -rf dist && yarn build
WARNING in ⚠ asset size limit: The following asset(s) exceed the recommended size limit (300.000 KiB). This can impact web performance.
  │ Assets:
  │   assets/map.png (2.530 MiB)
  │   assets/provinces_map.png (552.626 KiB)
  │   assets/provinces_manifest.json (586.891 KiB)

Rspack compiled with 1 warning in 72 ms
build exit=0

$ ls dist
84.37e5f932b7b1a078.js
assets
index.html
main.2e13a6ed3ed7a302.css
main.f604cd8871bc95b4.js

$ grep -c "scanBorders\|onmessage" dist/*.js
84.37e5f932b7b1a078.js:1
main.f604cd8871bc95b4.js:1
```

Only the two pre-existing asset-size warnings. `84.37e5f932b7b1a078.js` is still
the separate worker chunk (DESIGN 9.1).

### Single-quote check on the changed files

```
$ grep -n "'" src/ui/MapCanvas.tsx src/ui/map-canvas.module.css src/map/borders.worker.ts
src/ui/MapCanvas.tsx:68:// events and `click` to the capture element, so the button's `onClick` never
src/ui/MapCanvas.tsx:345:  // React's synthetic `onWheel` is registered passively, so `preventDefault`
src/map/borders.worker.ts:62:// Retained for the worker's life: 20.9 MB of ids and ~0.9 MB of crossings. That
src/map/borders.worker.ts:128:  // request arriving before a successful scan's response was posted.
```

Four hits, all inside comments. Zero single-quoted string literals.

## Browser checklist — actually run this time

Chrome, `yarn dev` on `http://localhost:60193/`. Two device-pixel ratios were
exercised because the window moved between displays mid-session: `dpr 1` at
1920 x 936 and `dpr 2` at 1728 x 940. Every number below is a real readout.

### 9.2 — the scan does not block first paint — PASS

Hard reload, then a forced frame 600 ms in:

```
{"now":936,"sceneW":1920,"overlayW":1920,"scenePainted":true,
 "hud":"zoom 33% px — province — selected — border scanning scan — segs — country —"}
```

The full-size scene canvas is already painted while `border` still reads
`scanning` and `scan`/`segs` are still `—`. The screenshot at that instant shows
the whole map drawn with no borders yet. A later reload reached `border ready`
with `scan 400 ms` at `performance.now() === 1117` while no animation frame had
run at all (`sceneW` still the default 300) — the scan advances entirely off the
paint path. Measured scan times across reloads: 303, 375, 400, 420, 492 ms,
which brackets DESIGN 9.2's 100-250 ms estimate on the high side (dev build,
unminified worker).

### 9.5 — country recompute and toggling — PASS

| Action | HUD `country` |
|---|---|
| first `demo countries` | `15 ms / 36086` |
| after 5 rapid alternating presses ending on `clear` | `0 ms / 0` |
| `demo countries` again | `4 ms / 36086` |
| later run, fresh page | `13 ms / 36086` |

4-15 ms against a 375-492 ms full scan, well under DESIGN 9.5's 50 ms ceiling —
the worker is walking the retained crossings, not rescanning. Five rapid toggles
coalesced to the last one and left `country 0 ms / 0` with the thick lines gone
from the render; re-applying brought them back. `36086` country segments each
time, exactly the number the Node measurement in attempt 1 predicted.

### BLOCKING FIX 1 verified in the browser

Buttons measured at their live positions before each press, so the click really
lands on them:

```
1 map click selects        selected 616   panning false   country —
2 demo countries button    selected 616   panning false   country 13 ms / 36086
3 clear button             selected 616   panning false   country 0 ms / 0
```

`applyDemoCountries()` and `clearDemoCountries()` both run, the selection is
untouched by either press, and `data-panning` never leaves `"false"`. Under
attempt 1's code step 2 would have set `selected` to whatever sat under the
button and might not have run `onClick` at all.

### 9.6 — hover and selection — PASS

At `zoom 800%`, `dpr 2`, hovering province 314 with province 307 selected, the
whole overlay contains exactly two fill colours and nothing else:

```
rgba(216,162,75,112) x826394     <- select
rgba(214,164,73,56)  x586295     <- hover
```

So the select fill is exactly twice the hover alpha, the two provinces are filled
separately, and the hovered-and-selected province is never double-filled.

Alignment, read back from the overlay at `zoom 800%`, `dpr 1`, device row 400:

```
stroke 429-429  rgba(21,16,16,49)
fill   430-925  rgba(149,112,53,139)
stroke 926-926  rgba(21,16,16,49)
```

The border stroke occupies the single device column immediately left of the
fill's first pixel and the one immediately right of its last. Zero gap, zero
overlap. The fill comes from `buildStampPixels` on the main thread and the stroke
from the worker's run scan; two independent paths over the same bitmap agree to
the pixel, at 8x.

Behaviour:

```
before drag   px 2462, 1470  province 1153  selected 307
after drag    px 2557, 1508  province 1182  selected 307    <- panned, did NOT select
after click   px 2557, 1508  province 1182  selected 1182   <- click without drag DOES select
```

Pointer leaving the map clears the hover: fill pixels went `hoverPixels 100067`
-> `hoverPixels 0`, `px`/`province` back to `—`, and the select fill was
unaffected.

### 9.4 — width is screen space — PASS, in the browser this time

Modal stroke width in DEVICE pixels, measured by scanning every 7th row of the
overlay and bucketing dark runs by alpha (province style is alpha 0.38, country
0.85), `dpr 2`:

| zoom | province stroke | country stroke |
|---|---|---|
| 33 % (fit) | 3 px | 6 px |
| 147 % | 3 px | 8 px |
| 362 % | 3 px | 5 px |
| 800 % (single row, exact) | 2 px on every run | — |

Province borders stay 2-3 device px over an 11x zoom range: 1 CSS px x dpr 2 plus
antialiasing. A map-space width would have gone 1 -> 4 -> 11 -> 24 device px. The
country stroke measurement is noisier because at these zooms the demo country
boundary follows the coastline and is crossed at shallow angles, which inflates a
horizontal run's width; it is always visibly thicker and darker than the province
stroke, which is what DESIGN 9.4 asks for.

### 9.8 — failure path — PASS, and reverted

`throw new Error("TEMPORARY DESIGN 9.8 forced failure");` was added as the first
statement of `handleScan` in `src/map/borders.worker.ts`, the page hard-reloaded,
then the line removed again.

```
border failed  reason TEMPORARY DESIGN 9.8 forced failure  scan —  segs —  country —
```

With the scan failed the map still rendered, still panned (drag), still zoomed
(`zoom 33%` -> `70%`), and still picked (`province 616 Province 616`,
`selected 616`). No borders drawn, no exception, the bounds hairline still there.

The temporary edit is reverted and the file is byte-identical to before it:

```
$ shasum -a 256 src/map/borders.worker.ts     # before the edit
7550804a5fe889b79a93906719eba8556af242ee52c90e83242e866b6c3bf61b
$ shasum -a 256 src/map/borders.worker.ts     # after the revert
7550804a5fe889b79a93906719eba8556af242ee52c90e83242e866b6c3bf61b
```

After the revert and a reload: `border ready`, `scan 375 ms`, `segs 132500`,
borders drawn again.

## Deliberately left undone

- **DESIGN 9.7 (per-frame `drawOverlay` cost during a pan) is still not measured.**
  The Chrome window this session was never `document.visibilityState === "visible"`
  — `requestAnimationFrame` fired 0 times in 3 s of waiting, and frames only
  happened when a screenshot forced one. Every state check above works under that
  constraint, but a per-frame timing during a live pan does not: there are no
  free-running frames to time. DESIGN section 0's own browser benchmark
  (tiled stroke 0.93 ms at fit, 0.04 ms at 8x on dpr 1; 8.70 / 0.30 ms on dpr 2)
  is the standing number. This was not in the reviewer's blocking list.
- The border style values are still DESIGN 6.3's starting values. Having now seen
  them on the art at 33 %, 147 %, 362 % and 800 %, they read correctly — province
  lines subdued and hairline-thin, country lines clearly heavier and darker — so
  nothing was retuned.
- Everything in DESIGN section 10 stays out, unchanged from attempt 1. The
  left-click select is still marked in-code as a T08 placeholder and
  `applyDemoCountries` / `clearDemoCountries` are still marked as T06 deletes.
- No unit tests were added for `MapCanvas.tsx`; PLAN section 4 forbids DOM tests
  and there is no jsdom. The browser checklist above is its gate.

---

# Tests

The implement agent already shipped 38 tests for T04 (31 in `src/map/borders.test.ts`,
3 in `src/ui/highlight-layer.test.ts`, 4 in `src/ui/render.test.ts`). I did not rewrite
them. I read the code against DESIGN sections 4 and 7, found the branches nothing
exercised, and added 13 tests to `src/map/borders.test.ts`.

**173 -> 186 tests, 186 pass, 0 fail.** No source file was changed. No dependency added.
The `test` script and the `tsx` devDependency were already in `package.json` from T01.

## What I added, and the branch each one pins

| Test | Branch it covers |
|---|---|
| `mapPixelsToIds stops at the shorter of the two palette arrays` | `Math.min(paletteColors.length, paletteIds.length)`. The dangerous direction is an over-long id list: `paletteColors[k]` reads `undefined`, `undefined & 0xffffff` is **0**, so a phantom entry lands at LUT slot 0 and every BLACK pixel resolves to it. 0x000000 is a legal province colour. |
| `the exported constants are the values the worker and the tiler assume` | `NO_PROVINCE === 0`, `TILE_SIZE === 256`, and the default `tileSize` argument. `borders-store.ts` never passes a tile size, so the default is load-bearing and nothing checked it. |
| `a one-pixel-wide bitmap produces horizontal runs and never touches openV` | width 1 makes `x + 1 < width` false on every pixel, so the whole vertical branch — including its `else if (openV[x] >= 0)` close — is skipped. The end-of-scan flush must find nothing. |
| `a one-pixel-tall bitmap produces vertical runs closed by the end-of-scan flush` | The transpose: `hasDown` false everywhere, so every vertical run is still open when the row loop ends and ONLY the final per-column flush emits it. |
| `a country boundary does not merge across a row boundary` | **The real gap.** `countryRuns`'s horizontal `openY !== y` guard. Crossings arrive row-major, so the last kept column of one row and the first kept column of the next can be adjacent by the `lastX !== x - 1` test alone. The identity property does **not** catch this — I checked all three existing identity fixtures, and none puts the two columns adjacent. |
| `a country change splitting a horizontal boundary gives two runs` | The `lastX !== x - 1` adjacency test on the horizontal path with a gap mid-row. The existing split test is vertical only. |
| `an empty countryOf puts every province in country 0 and emits nothing` | `countryAt` with a zero-length array. |
| `a boundary line exactly on a tile edge belongs to the higher tile` | DESIGN 4.4's tie-break rule, previously assumed rather than asserted. `visibleTiles`'s `-1` margin compensates for it in one direction only, so a flip would make the margin wrong. |
| `a line on the far map edge is clamped into the last tile instead of past it` | `clampIndex` in `eachTileSegment`. Without it the index becomes `r * cols + cols`, which is a **valid index for another row's tile** — the segment silently lands in the wrong tile and is culled at the wrong time rather than crashing. |
| `buildBorderTiles clamps a degenerate tile size to one pixel` | `Math.max(1, Math.floor(tileSize))`. `tileSize` crosses the worker boundary as a plain number; a 0 makes `ceil(width / size)` Infinity and `new Uint32Array(Infinity)` throws, taking the scan down. |
| `visibleTiles clamps a viewport that is entirely off the map` | The clamp in the other direction from the existing margin test. `drawBorders` indexes `paths[r * cols + c]` straight off the range, so an unclamped index hands `ctx.stroke` an undefined `Path2D`. |
| `buildCountryOf never returns a zero-length array` | `Math.max(1, maxProvinceId + 1)` for `maxProvinceId <= 0`. |
| `a country run set is always a subset of the province crossings` | **DESIGN 4.3's soundness claim, on the real 3653 x 2855 bitmap.** With an 8-country `id % 8` assignment, every pixel of every country run must be a province crossing, and both counts must strictly drop. This is what makes the cheap recompute legitimate: a country run the province scan never saw would draw a line through the middle of a province. 24 ms. |

## Mutation check — every new test kills its mutant

Each mutant applied to `src/map/borders.ts` alone, the full suite run, the source
restored. Only tests I added are listed; pre-existing tests that also fired are marked.

| Mutant | Failing | Which |
|---|---|---|
| `countryRuns` drops the horizontal `openY !== y` guard | **3** | `a country boundary does not merge across a row boundary`, `a country run set is always a subset...`, + the real-asset identity test |
| `countryRuns` drops the horizontal `lastX !== x - 1` test | **4** | `a country change splitting a horizontal boundary...`, `a country run set is always a subset...`, + 2 pre-existing |
| `buildBorderTiles` drops the clamp on the vertical line column | **1** | `a line on the far map edge is clamped...` |
| `buildBorderTiles` assigns an edge line to the LOWER tile | **1** | `a boundary line exactly on a tile edge...` |
| `buildBorderTiles` does not clamp a degenerate tile size | **1** | `buildBorderTiles clamps a degenerate tile size...` |
| `buildCountryOf` allows a zero-length array | **1** | `buildCountryOf never returns a zero-length array` |
| `visibleTiles` drops the clamp on the column range | **2** | `visibleTiles clamps a viewport that is entirely off the map` + 1 pre-existing |
| `mapPixelsToIds` walks the full ID array, ignoring the colour array length | **1** | `mapPixelsToIds stops at the shorter...` |
| `scanBorders` uses `<=` in the right-neighbour guard | **18** | includes both new single-axis-bitmap tests |

```
source restored byte-identical: True
```

One mutant did **not** survive contact and forced a test rewrite: `entries =
paletteColors.length` (the truncated-ID direction) fails 0 tests, because
`paletteIds[k]` reading `undefined` coerces to 0 and leaves the LUT slot at 0 — the
same value it already held. My first version of that test asserted the unobservable
direction and was therefore worthless. I rewrote it to assert the id-array-longer
direction, which is the one that corrupts LUT slot 0. **No assertion was weakened and
no source was changed to make anything pass.**

## Deliberately not covered

- **`borders.worker.ts`, `borders-store.ts`, `selection-store.ts`, `border-layer.ts`'s
  `Path2D` construction, `highlight-layer.ts`'s canvas wrapper, `MapCanvas.tsx`.**
  All need a `Worker`, a `Canvas`, a DOM or the signals runtime. PLAN section 4 forbids
  those tests and the repo has no jsdom. This matches DESIGN 8.9. Specifically NOT
  covered by any unit test, and still resting on the browser checklist in this file:
  the latest-wins `requestId` guard, the in-flight coalescing slot, the
  `pixels.slice()`-not-transfer rule, worker `try/catch` -> `error` response, the
  worker forcing `countryOf[0] = 0`, the 32-entry stamp cache eviction, and the
  `snapView` argument threading.
- **The PLAN's numeric facts** (3653 x 2855, 1648 provinces, centroid is centre of mass
  not bbox centre) are already pinned by T01/T02 and I did not duplicate them:
  `src/assets.test.ts` lines 93/126/222 and `src/map/manifest.test.ts` lines 282/293.
  `borders.test.ts` pins 3653 x 2855 again through the scan itself.
- **Numeric drift in the border style constants** (`PROVINCE_BORDER`, `COUNTRY_BORDER`).
  DESIGN 6.3 says to tune them against the art; pinning them now would fight that.
  The screen-space `lineWidth` *rule* is already pinned in `render.test.ts`.
- **`Int32Builder` / `Uint32Builder` growth** is not tested directly. The real-asset
  scan pushes 198 k int32 through a builder that starts at 65 536, so the doubling path
  runs on every test run.

## Real `yarn test` output

```
$ yarn test
✔ mapPixelsToIds resolves palette colours and maps everything else to 0 (0.836542ms)
✔ mapPixelsToIds stops at the shorter of the two palette arrays (0.181166ms)
✔ the exported constants are the values the worker and the tiler assume (0.267792ms)
✔ a one-pixel-wide bitmap produces horizontal runs and never touches openV (0.055708ms)
✔ a one-pixel-tall bitmap produces vertical runs closed by the end-of-scan flush (0.05ms)
✔ a country boundary does not merge across a row boundary (0.0445ms)
✔ a country change splitting a horizontal boundary gives two runs (0.045333ms)
✔ an empty countryOf puts every province in country 0 and emits nothing (0.046541ms)
✔ a boundary line exactly on a tile edge belongs to the higher tile (0.048833ms)
✔ a line on the far map edge is clamped into the last tile instead of past it (0.038208ms)
✔ buildBorderTiles clamps a degenerate tile size to one pixel (0.054042ms)
✔ visibleTiles clamps a viewport that is entirely off the map (0.036333ms)
✔ buildCountryOf never returns a zero-length array (0.030125ms)
✔ a country run set is always a subset of the province crossings (24.332792ms)
✔ drawOverlay clears and returns for a degenerate scale (0.052125ms)
ℹ tests 186
ℹ suites 0
ℹ pass 186
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 592.098584
```

(The 13 new tests are listed in run order among the 186; the totals are the run's own.)

`yarn typecheck` exit 0, no output. The only file I edited is
`src/map/borders.test.ts`. `src/map/borders.ts` is untracked at this point in the task,
so a `git diff` on it proves nothing — the evidence that it is unchanged is the
SHA-256 taken before the mutation run and again after, quoted above.

---

## Docs & commit

Commit: `fad4af7c1cd52056916a15f9f82576f1fcdb8b38` — "civitas interactive map — T04 border extraction and rendering".

### Verification before committing

All three green on the first run. Nothing needed fixing.

```
yarn typecheck   exit 0 (no output)
yarn build       exit 0, the same 2 asset-size warnings T02 recorded (not silenced);
                 dist still contains the separate worker chunk 84.37e5f932b7b1a078.js
yarn test        186 pass, 0 fail, exit 0
```

### README

Appended, not rewritten. One edit to an earlier table and one new section:

- The `Files so far` table gained `src/map/borders.ts`, `src/map/borders.worker.ts`,
  `src/state/borders-store.ts`, `src/state/selection-store.ts`,
  `src/ui/border-layer.ts` and `src/ui/highlight-layer.ts`.
- New `## Borders and highlights` section at the end: extraction (`mapPixelsToIds`'s
  transient LUT, the one-pass scan with `NO_PROVINCE` participating, runs on the grid
  line, `countryRuns` walking the crossings, tiles as two transferable buffers with
  segments split not duplicated, the one-tile margin), the worker and store contract
  (two messages, `countryOf[0] = 0`, latest-wins coalescing, `pixels.slice()` not
  transfer), drawing (per-tile `Path2D`, `lineWidth = widthCss / view.scale`, the two
  styles, the stamp cache, the overlay draw order, optional `OverlayInput` fields),
  and five traps for later tasks.

### Files committed

16 files, all under the package. Nothing else in the working tree was touched.

```
.plan/T03/memory.md          (T03's own "Docs & commit" addendum, left uncommitted by T03)
.plan/T04/DESIGN.md
.plan/T04/memory.md
README.md
src/map/borders.test.ts
src/map/borders.ts
src/map/borders.worker.ts
src/state/borders-store.ts
src/state/selection-store.ts
src/ui/MapCanvas.tsx
src/ui/border-layer.ts
src/ui/highlight-layer.test.ts
src/ui/highlight-layer.ts
src/ui/map-canvas.module.css
src/ui/render.test.ts
src/ui/render.ts
```

### Two things a later agent should know

- **`javascript/yarn.lock` is modified in the working tree and was NOT committed.**
  The diff adds a `@hw/react-di` workspace entry from `packages/prototypes/ai-slop/`,
  which has nothing to do with this package. T04 added no dependency.
- **The repo index held pre-existing staged changes from outside this package** when
  T04 started (`.yarn/cache` deletions, a skills edit, other prototypes). The commit
  was therefore made as `git commit -- <package path>`, a path-scoped partial commit.
  A plain `git commit` would have swept all of it in. Use the same form next time.
