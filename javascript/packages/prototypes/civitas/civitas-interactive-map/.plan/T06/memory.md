# T06 — think agent handoff

Design: `.plan/T06/DESIGN.md`. The algorithms are written out; follow them literally.

## Decided, with reasons

- **The tint is ONE map-sized offscreen canvas (3653 x 2855, 41.7 MB), drawn with one
  `drawImage` inside the existing `drawOverlay`.** The alternative, a stamp per province
  like `highlight-layer.ts`, costs 1648 `drawImage` calls per frame at fit zoom. The
  per-frame cost is what matters — it is paid 60 times a second during a pan, while the
  update cost is paid once per click.
- **Updates repaint one province BOUNDING BOX at a time via `putImageData`.** Median box
  is 2 961 px, largest 12 642 px, and the sum of ALL 1648 boxes is 5 126 902 px — half a
  map scan. A whole-canvas rebuild is 10.4 M pixels with a `Map` lookup each (150-250 ms),
  so per-box is always cheaper. Do not add a "just rebuild everything" threshold.
- **`buildTintPixels` resolves the province that OWNS each pixel, not the target
  province.** Bounding boxes overlap and `putImageData` replaces alpha, so a tile built
  the way `buildStampPixels` builds one would erase a neighbour's tint. This makes a box
  repaint globally correct, so repainting the same box twice in a batch is idempotent.
- **The stroke action is decided ONCE, at `beginStroke`, and held for the whole drag.**
  Deciding per province makes a drag that re-enters a province toggle it back, and a drag
  across a rival country leaves a trail of half-assigned provinces.
- **`extendStroke` takes a BATCH of ids, one call per pointermove.** Each
  `assignProvinces` replaces the countries array and invalidates three computeds; batching
  removes a straight N-times multiplier for nothing.
- **The border push is debounced 120 ms on top of the existing latest-wins coalescing.**
  Coalescing bounds the worker at one in flight, but every response still costs
  `buildBorderPaths` on the MAIN thread — T04 measured 5.7 ms for 180 tiles. At 30 events
  a second that is 17% of the frame budget plus 180 discarded `Path2D` per response.
  `endStroke` flushes, so releasing the mouse updates within one round trip.
- **The debouncer is T05's `createStateWriter`**, borrowed from `persistence.ts`. It is a
  generic fixed-window trailing debounce with injectable timers. Slightly misnamed; still
  better than a second copy.
- **Aggregates are a `computed` over `countries` — that IS the cache the brief asks for.**
  A full recompute is 1648 `Map` lookups, tens of microseconds. Per-country memoisation
  would be more code for no measurable gain.
- **`aggregateCountry` takes a province LOOKUP, not a `Country`.** It lives in `src/map/`
  and must not import `src/state/`, and a lookup argument is what makes the maths testable
  in Node where the manifest never loads.
- **Pan moves to the middle button while assign mode is on**, and falls back to left drag
  whenever no country is active, so the map is never unusable.

## Surprises

- **`getMapAssets()` is a plain module variable and notifies nobody.** Every computed that
  touches the manifest must also read `loadPhase.value`, or countries hydrated from
  localStorage never tint until something else happens to invalidate. This is the single
  easiest bug to ship in this task.
- **`assignProvinces` with a country id that no longer exists silently unassigns.** T05
  pinned that behaviour deliberately. So `applyStroke` MUST check
  `countryById.peek().has(stroke.countryId)` first — a country deleted mid-drag would
  otherwise turn the rest of the stroke into a mass unassign.
- **`input type="color"` fires React `onChange` on every native `input` event.** Dragging
  the OS picker emits dozens a second, and each one repaints every province of that
  country (~20 ms at 300 provinces). Debounce colour edits 80 ms in the panel. Name edits
  do not need it.
- **The tint canvas is MAP-sized (3653), not art-sized (3652).** Only `drawScene`'s
  `sourceRect` takes the art width. There is no `drawEdgeColumn` analogue for the tint.
- Bounding boxes are only 53.8% filled on average (2 756 578 painted px against
  5 126 902 px of boxes), which is why per-box repainting is affordable at all.
- The `computed` `activeCountryId` over `countryById` auto-heals on delete with no extra
  wiring — no stale country id can ever reach `assignProvinces`.

## Traps inherited

- `src/scaffold.test.ts` fails a line starting `export type { ... }`. Write
  `export { type Foo };`.
- Never take a `Uint32Array` view over the tint pixel buffer — machine-dependent byte
  order. Write the four bytes, as `province-index.ts` states at its top.
- `buildStampPixels`-style `Uint8ClampedArray<ArrayBuffer>` is required; the default
  `ArrayBufferLike` admits a `SharedArrayBuffer` and `new ImageData` rejects it.
- Keep `document.createElement` inside a function body so the module imports under Node.
- `noUnusedLocals` will catch the `buildCountryOf` import left behind when
  `applyDemoCountries` / `clearDemoCountries` are deleted from `borders-store.ts`.
- Province ids run 1..1650 over 1648 provinces; 1318 and 1458 do not exist. Aggregates
  must skip an unresolvable id, not throw.

## Highest-value checks

1. **The weighted-centroid test.** Two provinces with `pixelCount` 1000 and 9000 at x = 0
   and x = 100 must put the centroid at x = 90. An unweighted mean gives 50 and looks
   plausible everywhere else.
2. **The overlapping-bounding-box tint test.** A box that covers a neighbour must paint the
   neighbour in the neighbour's colour. This is the one that catches a copy of
   `buildStampPixels`.
3. **The one-owner test stated as a COUNT**: `countryOfProvince.size` equals the sum of
   every country's `provinceIds.length`. A duplicate cannot hide behind a spot check.

---

## Implementation (attempt 1)

Followed `.plan/T06/DESIGN.md` literally. No dependency added, no schema change, no migration,
nothing under `../civitas-map` touched.

### Files created

| File | What |
|---|---|
| `src/map/country-aggregate.ts` | PURE `aggregateCountry`, `unionBounds`, `CountryAggregate`. Area-weighted centroid with an unweighted fallback, union bbox, `provinceCount` vs `resolvedCount`. |
| `src/map/country-aggregate.test.ts` | 9 tests: weighting, union, empty/phantom ids, no-NaN fallback, no rounding. |
| `src/map/paint-path.ts` | PURE `samplePathPixels`, `MAX_PATH_SAMPLES = 4096`. |
| `src/map/paint-path.test.ts` | 6 tests: horizontal run, zero length, diagonal, shallow diagonal, cap, non-finite. |
| `src/ui/tint-layer.ts` | `TINT_ALPHA = 0.32`, `tintWordFor`, `buildTintPixels`, `diffTintWords`, `syncTintLayer`, `getTintCanvas`, `disposeTintLayer`. One map-sized offscreen canvas, per-bbox `putImageData`, all-zero fast path, four-byte writes (no u32 view). |
| `src/ui/tint-layer.test.ts` | 11 tests incl. the overlapping-bbox neighbour test and the sign-bit test. |
| `src/state/country-store.ts` | `maxProvinceId`, `buildTintWordTable` (pure), `countryTintWords`, `countryAggregates`, `initCountrySync` / `flushCountryBorders` / `disposeCountrySync`, `BORDER_PUSH_MS = 120`. |
| `src/state/country-store.test.ts` | 9 tests incl. the one-timer debounce counted by `set` calls, and the flush. |
| `src/state/assign-store.ts` | `assignMode`, `activeCountryId` (auto-healing computed), `painting`, `strokeActionFor` (pure), `beginStroke` / `extendStroke` / `endStroke` / `cancelStroke`. |
| `src/state/assign-store.test.ts` | 9 tests incl. the one-owner invariant stated as a count. |
| `src/ui/CountryPanel.tsx` | CRUD panel, mode toggle, 80 ms colour debounce, two-step delete confirm, Escape exits assign mode. |
| `src/ui/country-panel.module.css` | Its styles, one declaration per line. |

### Files changed

| File | Change |
|---|---|
| `src/ui/render.ts` | `OverlayInput` gains optional `tint` / `tintSize`; `drawOverlay` draws the tint first, from the snapped view, with `shouldSmooth`. |
| `src/ui/render.test.ts` | +2 tests: the tint draws first from the MAP size; omitting it is byte-identical to T04. |
| `src/ui/MapCanvas.tsx` | Paint gesture + line walk, middle-button pan, `onAuxClick`, tint sync effect, `tint`/`tintSize` on `drawOverlay`, `disposeTintLayer` on unmount, `mode`/`active` HUD readouts, demo buttons deleted, double-click zoom suppressed in assign mode. |
| `src/ui/map-canvas.module.css` | `.host[data-mode="assign"]` cursors; `.hudActions` / `.hudButton` deleted. |
| `src/state/borders-store.ts` | `applyDemoCountries`, `clearDemoCountries`, `DEMO_COLS`, `DEMO_ROWS` and the `buildCountryOf` import deleted. |
| `src/App.tsx` | Mounts `CountryPanel`, calls `initCountrySync()` and disposes it on unmount. |

### Two deliberate deviations from DESIGN

1. `buildTintWordTable(countries, max)` was factored out of the `countryTintWords` computed and
   exported. The design's test 11.5.1 (a word at each province id) is impossible against the
   computed, because in Node the manifest never loads and `maxProvinceId` is always 0 — the very
   thing test 11.5.4 asserts. Both tests now exist: the table against the pure builder, the
   length-1 guard against the computed.
2. Double-click zoom is suppressed while assign mode is on. The left button is the paint tool
   there; a double click is two strokes and zooming under them moves the map out from under the
   second one. The wheel and the middle drag still zoom and pan.

### Commands, real output

```
$ yarn typecheck
(exit 0, no output)

$ yarn test
ℹ tests 317
ℹ suites 0
ℹ pass 317
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 540.070334
```

271 before this task, 317 after: 46 new, 0 regressed.

```
$ yarn build
WARNING in ⚠ asset size limit: The following asset(s) exceed the recommended size limit (300.000 KiB).
  │ Assets:
  │   assets/map.png (2.530 MiB)
  │   assets/provinces_map.png (552.626 KiB)
  │   assets/provinces_manifest.json (586.891 KiB)
Rspack compiled with 1 warning in 80 ms

$ ls dist
84.37e5f932b7b1a078.js      <- the border-worker chunk, still separate
assets
index.html
main.370dfb1e41326093.css
main.44da9030c725f7f3.js
```

Only the three pre-existing asset-size warnings.

Style self-checks — all empty except apostrophes inside comments and message strings:

```
$ grep -rn "^export type\|^export \(const\|function\|class\|interface\|enum\|async\|let\|var\)" src/
(nothing)
$ grep -rn "applyDemoCountries\|clearDemoCountries" src/
(nothing)
```

### Mutation check (DESIGN 11.7)

Each mutant applied alone, `yarn test` run, source restored, restore proven by a
`shasum -a 256` compare before and after. Every restore came back `ok`.

| Mutant | Result |
|---|---|
| `aggregateCountry` uses an unweighted mean | KILLED |
| empty country returns `{x:0,y:0}` instead of null | KILLED |
| `unionBounds` uses `max(width)` | KILLED |
| `buildTintPixels` matches one province like `buildStampPixels` | KILLED |
| `buildTintPixels` writes B, G, R, A | KILLED |
| `tintWordFor` drops the `>>> 0` | KILLED (after adding the sign-bit test — the original test used alpha 82, which stays positive without the shift; it took an alpha >= 128 to catch it) |
| `diffTintWords` iterates `painted.length` | KILLED |
| stroke action re-decided per `applyStroke` call | KILLED (after splitting the locked-action test into two `extendStroke` batches — one batch that starts on an owned province hides the mutant) |
| `applyStroke` drops the `countryById.has` guard | KILLED |
| the border push is not debounced | KILLED |
| `samplePathPixels` visits only the endpoint | KILLED |

### Browser checklist (DESIGN 12.2) — `yarn dev`, Chrome, real readings

The tab is BACKGROUNDED between tool calls, so `requestAnimationFrame` never fires and
`setTimeout` is throttled to about a second. Nothing draws until a screenshot activates the tab;
the canvases sit at their default 300x150 until then. Pointer events were dispatched from
`javascript_tool`, with `setPointerCapture` / `releasePointerCapture` / `hasPointerCapture`
stubbed — a dispatched (untrusted) PointerEvent has no active pointer id and the real API throws.
Every reading below is quoted from the HUD, the panel, `localStorage`, or `getImageData`.

1. **CRUD.** `+ new` three times gave `Country 1/2/3` with `#c0563f`, `#4f7fb5`, `#6f9e57`.
   Rename persisted: `"name": "Renamed Land"` in `civitas.state.v1`.
   Recolour: 30 native `input` events in 26 ms wrote exactly ONE value, the last —
   `colorHex: "#a49e57"` — and the input kept showing the live value. The debounce works.
2. **Paint.** One left drag of 30 pointermove events assigned 9 provinces:
   `9 prov · 10,743 px`. HUD before `country 11 ms / 0`, after `country 5 ms / 673`, and
   `9 ms / 699` once `endStroke` flushed.
3. **Re-click removes.** Clicking province 1141 while its owner was active took Country 2 from
   1 province to 0.
4. **Reassign.** With Country 2 active, painting 1141 (owned by Country 3) moved it:
   `ownerOf1141: 2`, Country 3 down to 8 ids, and a duplicate scan over the stored
   `provinceIds` returned `duplicate: null`.
5. **Alt erases.** An alt-drag across the centroids of 853, 861, 896, 915 left exactly
   `[932, 1094, 1114, 1135]`. HUD `country 1 ms / 460`.
6. **Middle drag pans.** With `mode assign`, a middle-button drag moved the map pixel under the
   cursor from `789, 1242` to `1538, 1370` — the opposite direction a bare cursor move would give
   — and assigned nothing. The wheel still zoomed: `zoom 33%` -> `zoom 800%`.
7. **Delete.** The first click armed the row (`delete` -> `delete?`, country still in storage),
   the second deleted it. `active —` immediately (the computed auto-heal), and the country border
   layer went to `country 1 ms / 0`.
8. **No freeze.** Every recompute reading was 1-11 ms, far under the 50 ms bar:
   `11 ms / 0`, `5 ms / 673`, `9 ms / 699`, `5 ms / 736`, `1 ms / 460`, `1 ms / 0`, `11 ms / 5418`.
9. **Tint subtlety.** Screenshots at 33% and 800%: the terrain shading, the river, the province
   hairlines and the thick country border all still read through the tint. `TINT_ALPHA` left at
   0.32.
10. **Alignment at 800%.** `getImageData` over one overlay row (device y 694), runs quoted:
    `? 535-535`, `B 536-539` (the country stroke, 2.25 CSS px x dpr 2), `T 540-904` (tint begins
    on the pixel after the stroke), `? 905-906` (an internal province hairline), `T 907-1240`,
    `? 1241-1242`, `H 1243-1414` (the hover fill reading ON TOP of the tint), `B 1416-1419`.
    The tint edge and the border stroke coincide to the device pixel.
11. **Empty state.** After the last populated country was deleted the country layer reported
    `1 ms / 0` segments and the tint cleared through the all-zero fast path.
12. **Reload with assignments.** 62 provinces seeded into Country 1, hard reload, zero clicks:
    `62 prov · 106,933 px` in the panel and `country 11 ms / 5418` in the HUD, with the red tint
    and its border visible in the screenshot. This is the check that proves `maxProvinceId` and
    `countryTintWords` really do subscribe to `loadPhase`.

### Left undone, deliberately

- Nothing from DESIGN section 13 was started (labels, right-click country selection, flag/slogan/
  lore, the province list, economics).
- Touch paint/pan disambiguation. A one-finger drag paints and pan is unreachable on touch while
  the mode is on. Accepted; desktop prototype. The README note is the docs agent's job.
- `TINT_ALPHA` was not tuned away from 0.32 — the browser check found it already subtle enough.

---

## Tests

31 regression tests appended to the five T06 test files. **317 -> 348, all passing, none
regressed.** No source file was changed: every new test passes against the implementation as
the review agent left it. No existing assertion was weakened, deleted or edited — the only
edits to existing files are added imports (`readFileSync`/`fileURLToPath`/`parseManifestText`/
`indexProvincesById`, `toggleAssignMode`, `BORDER_PUSH_MS`, `DEBOUNCE_MS`, `borderPhase`,
`loadPhase`, `deleteCountry`) and appended `test(...)` blocks.

### What the 31 cover

`src/map/country-aggregate.test.ts` (+5)

- The centroid weights BOTH axes and does not swap them — (1000 at (0,100), 9000 at (100,0))
  must give (90, 10), not (10, 90).
- A negative `pixelCount` counts as 0 instead of cancelling the weight out to `0 / 0`.
- `unionBounds(null, b)` returns a COPY, so widening a country's box cannot rewrite the
  manifest's own `bounds` object through the alias.
- **The real asset, parsed with `parseManifestText`**: all 1650 ids assigned to one country
  give `provinceCount 1650`, `resolvedCount 1648`, `pixelCount 2 756 578` (equal to the
  manifest's own `painted.pixelCount`), union bounds `{383, 364, 3119, 2427}` inside
  3653 x 2855, and the area-weighted centroid (2114.763…, 1224.913…).
- A country made only of 1318 and 1458 aggregates to `resolvedCount 0`, null bounds, null
  centroid.

`src/map/paint-path.test.ts` (+5)

- A vertical run visits every integer y once.
- A backwards run (15,9 -> 10,7) walks in the direction it was given and ends on the endpoint.
- Every visited coordinate is an integer even from fractional map pixels.
- **Pixel continuity**: over five paths, consecutive samples never differ by more than 1 on
  either axis, and the walk starts and ends exactly on its endpoints. This is the property the
  module exists for — no province can fall through a stroke.
- `MAX_PATH_SAMPLES` is 4096.

`src/ui/tint-layer.test.ts` (+6)

- `TINT_ALPHA` is 0.32 and sits strictly between the T04 hover 0.22 and select 0.44.
- Uppercase hex (`#C0563F`) is accepted and gives the same word as lower case.
- A non-finite alpha returns the no-tint word rather than a silent 255.
- `buildTintPixels` fills exactly `width * height * 4` bytes.
- **Order independence**, via a `paste` helper that replicates `putImageData` (destination
  replaced, alpha included): two overlapping boxes composite to the identical surface in
  either order, neither erases the other, and the sea stays clear. This is DESIGN 3.3's
  idempotence claim stated as a test.
- A bounding box running past the edge of the bitmap paints only the pixels that exist and
  leaves the rest transparent.

`src/state/assign-store.test.ts` (+8)

- `toggleAssignMode` flips both ways.
- An active id naming no country leaves the mode inert; `beginStroke` returns null.
- **A click on the sea** (`provinceId === null`) still arms the stroke, assigns nothing, and
  the drag paints as soon as it reaches land.
- Clicking a province the active country already owns removes it (the "re-click removes" case).
- An alt stroke strips provinces from whatever country holds them, and the active country
  gains none.
- Painting a province the active country already holds writes NO new countries array —
  `assignProvinces`'s `sameIds` no-op, asserted on array identity.
- `extendStroke` / `endStroke` outside a stroke change nothing.
- `cancelStroke` KEEPS what the stroke already painted and accepts nothing more afterwards.

`src/state/country-store.test.ts` (+7)

- `BORDER_PUSH_MS` is 120 and strictly below T05's `DEBOUNCE_MS`.
- `buildTintWordTable` with max 0 or a negative max returns a length-1 array.
- `maxProvinceId` stays 0 when `loadPhase` is "ready" but `getMapAssets()` is still null — the
  guard that stops a throw inside the signal graph.
- `countryAggregates` is empty with no countries and drops a deleted country's entry.
- **The border scan completing re-arms the push**: driving `borderPhase` to "ready" schedules
  a fresh timer. This is the `void borderPhase.value` line in the effect, and nothing else
  covered it.
- The disposer `initCountrySync` RETURNS stops the push (the return value was untested).
- `flushCountryBorders` before any init is a no-op, not a crash.

### Mutation check — 18 mutants, every one killed

Each mutant applied to the SOURCE alone, `yarn test` run, source restored, and the restore
proven by a `shasum -a 256` compare before and after (all "restore ok"). Script:
`scratchpad/mutate.sh`.

| Mutant | Result | Killed by |
|---|---|---|
| `aggregateCountry` drops the `pixelCount > 0` clamp | KILLED | negative pixelCount |
| `unionBounds` returns `b` itself when `a` is null | KILLED | the aliasing test |
| the centroid weights y by `centroid.x` | KILLED | both-axes (+4 older) |
| `samplePathPixels` drops `Math.round` | KILLED | integers, continuity |
| `samplePathPixels` uses `Math.abs(dx)` | KILLED | backwards run, continuity |
| `MAX_PATH_SAMPLES` cut to 512 | KILLED | the cap, continuity |
| the tint hex regex loses its `/i` | KILLED | uppercase hex |
| `TINT_ALPHA` raised to the select alpha 0.44 | KILLED | the band test (+6 older) |
| `tintWordFor` drops the `Number.isFinite` check | KILLED | non-finite alpha |
| `beginStroke` refuses a null province | KILLED | the sea click |
| `extendStroke` paints with no stroke armed | KILLED | outside-a-stroke, cancel |
| `strokeActionFor` loses the alt branch | KILLED | the alt stroke (+1 older) |
| `activeCountryId` trusts an unknown id | KILLED | inert-mode (+1 older) |
| the effect stops reading `borderPhase` | KILLED | scan-completes |
| `maxProvinceId` drops the `!assets` guard | KILLED | ready-with-no-assets (+3) |
| `initCountrySync` returns a dead disposer | KILLED | the returned disposer |
| `flushCountryBorders` drops its null-writer guard | KILLED | flush-before-init (+8) |
| `BORDER_PUSH_MS` becomes T05's 400 | KILLED | the 120 ms window |

### Real output

```
$ yarn typecheck
(exit 0, no output)

$ yarn test
ℹ tests 348
ℹ suites 0
ℹ pass 348
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 511.576166
```

Style self-checks over the five touched test files: no single-quoted strings (the only
apostrophes are inside prose comments and message strings), no inline `export`, no line over
101 characters.

### NOT covered, and why

- `syncTintLayer`'s canvas half, `getTintCanvas`, `disposeTintLayer`. They need
  `document.createElement`, `getContext("2d")`, `ImageData` and `putImageData`. PLAN section 4
  forbids DOM tests and there is no jsdom. The pure pieces they are built from
  (`buildTintPixels`, `diffTintWords`, `tintWordFor`) are covered, and the order-independence
  test now covers the compositing rule `syncTintLayer` relies on. DESIGN 12.2's browser
  checklist remains their only gate.
- `CountryPanel.tsx` — React, plus the 80 ms colour debounce and the two-step delete confirm
  live in component state. No renderer in this repo.
- `MapCanvas.tsx` pointer handling, the gesture union, the middle-button pan and the tint sync
  effect. DOM events and a canvas.
- The actual worker round trip: `pushCountryBorders` returns early in Node because
  `maxProvinceId` is 0, and `setCountryAssignment` returns early without a worker. Only the
  scheduling side of the push is testable here; the payload conversion is T05's
  `buildCountryAssignment`, already covered by `world-store.test.ts`.
- Everything in DESIGN section 13 (labels, right-click selection, flags, the province list,
  economics) belongs to later tasks.
