# T03 — think agent handoff

Design: `.plan/T03/DESIGN.md`. The algorithms are written out; follow it literally.

## Decided, with reasons

- **`scale` is CSS px per map px, not device px.** `MAX_SCALE = 8` is therefore 16
  device px per map pixel on a retina display. `dpr` enters only at `snapView` and
  at draw time. Mixing the two units is the easiest way to get a wrong zoom cap.
- **Minimum scale is the fit scale with zero padding.** No padding makes "fully
  zoomed out" unambiguous and makes the pan clamp trivially correct.
- **Pan clamp has two regimes per axis.** Bigger than the viewport: clamp to the
  edges. Smaller: lock to centred. The second regime is not hypothetical — it
  happens on one axis at and near minimum zoom, because `fitScale` takes the `min`.
- **The 1 px width gap is letterboxed, not stretched.** Stretching 3652 -> 3653
  resamples every column by 0.99973 and destroys the pixel-exact correspondence
  with `provinces_map.png` that `provinceAt` depends on. The missing column is
  filled by re-drawing the art's last column (`drawEdgeColumn`), so nothing is
  visible and nothing is blurred.
- **`sourceRect` snaps the source rect to whole source pixels** (floor/ceil) and
  derives the destination from those integers. That makes `dw / sw === scale`
  exactly, which is the property that stops the image shimmering during a pan.
  A fractional source rect resamples with a moving phase — that is the "drift"
  the done-condition names.
- **`snapView` is applied at draw time only, never stored.** Snapping the stored
  view would accumulate rounding across a zoom sequence.
- **`zoomAt` returns the same object reference when nothing changed.** The store
  uses `!==` to skip the signal write. Without it, a wheel held at the 8x cap
  repaints at 60 fps forever and jitters from floating-point noise.
- **Third file beyond the brief: `src/state/view-store.ts`.** T04, T07 and T08 all
  need the view. Component state would strand it. Mirrors the reference's
  `editor-state.ts`. Also `src/ui/render.ts`, to keep canvas drawing out of React.
- **`view.value` is `View | null`.** Map size and viewport arrive from two
  independent async sources; either can be second. `syncView()` is the single
  initialisation point and is called from both paths.
- **Double-click zoom is instant.** An eased zoom needs an animation state machine
  that T08 would have to unwind when it adds click selection.

## Surprises and traps

- **`shouldSmooth` must be `scale * dpr < 1`, not `scale < 1`.** The reference
  package (`../civitas-map/src/ui/render.ts`) uses `view.scale < 1`, which is wrong
  on every retina display: at scale 0.7 / dpr 2 the art is already magnified 1.4x
  and gets smoothed into mush. Do not copy that line.
- **The reference draws the whole bitmap with the 3-argument `drawImage` under a
  scaled transform.** The brief explicitly forbids that. Use the 9-argument form.
- **React's `onWheel` is passive**, so `preventDefault` is ignored there and the
  page scrolls behind the zoom. Native listener with `{ passive: false }`.
- **`deltaMode` conversion `[1, 16, 100]` is not optional.** Firefox reports a
  notch as `deltaY: 3, deltaMode: 1`; treating it as 3 px gives a 0.45 % zoom step,
  which reads as a dead wheel.
- **`src/scaffold.test.ts` scans every file in `src/`** for inline `export`
  keywords and default exports. `MapCanvas.tsx` needs `export { MapCanvas };` at
  the end. That test is already green — do not break it.
- **`noUnusedLocals` + `noUnusedParameters` are on.** `App.tsx` loses the probe
  table; its now-unused imports (`useState`, `getMapAssets`, `provinceAt`,
  `provinceCount`) must go in the same edit or `yarn typecheck` fails.
- `getMapAssets()` returns `null` until `loadPhase.value === "ready"`. Render off
  `loadPhase`, not off a truthy check of the art bitmap. `art` is deliberately not
  closed by T02 — it is this task's render source.
- Assigning `canvas.width` reallocates and clears the backing store even when the
  value is unchanged. Guard with `!==`.
- A `resolution` media query only fires when the ratio leaves its current value, so
  the dpr listener must be re-armed at the new ratio each time it fires.
- Verification traps from earlier sessions: a hidden Chrome tab renders no frames,
  so pan/zoom smoothness cannot be judged from a background tab, and the Chrome MCP
  `resize_window` is a no-op — drive the resize test by setting a width on `.root`
  from the console.

## Highest-value check

At 8x, hover map pixel (1382, 1329) and the HUD must read province `1000`
(verified pixel from T02). A wrong id there means the screen->map transform has
drifted, and no amount of "it looks smooth" makes up for it.

---

## Implementation (attempt 1)

Followed `.plan/T03/DESIGN.md`. **No new dependency.** One deliberate deviation from the
design's pan-threshold rule and two additions, all called out below.

### Files created

| File | One line |
|---|---|
| `src/map/view.ts` | Pure view transform: `fitScale`/`clampScale`/`clampTranslate`/`clampView`/`fitView`/`translateTo`/`screenToMap`/`mapToScreen`/`zoomAt`/`sourceRect`/`shouldSmooth`/`snapView`, `MAX_SCALE = 8`. No DOM, no canvas, no `window`. |
| `src/map/view.test.ts` | 25 Node tests covering every case in DESIGN section 8. |
| `src/state/view-store.ts` | Signals `view`/`viewport`/`dpr`/`cursorMap`/`panning` plus guarded actions `setViewport`/`setDpr`/`syncView`/`zoomAtPoint`/`panTo`/`resetView`/`setCursor`/`mapPixelAt`. |
| `src/ui/render.ts` | `drawScene` (9-arg `drawImage` + private `drawEdgeColumn`) and `drawOverlay` (map-bounds hairline). No React, no signals. |
| `src/ui/MapCanvas.tsx` | Two stacked canvases, all listeners, the coalesced rAF loop, and the temporary HUD. |
| `src/ui/map-canvas.module.css` | Host/canvas layout, grab cursors, HUD chrome. One declaration per line. |

### Files changed

| File | Change |
|---|---|
| `src/App.tsx` | Body replaced by `<MapCanvas />` plus a load-status overlay. `ensureMapLoaded()` on mount kept. Probe table, facts list and x/y inputs deleted with their now-unused imports. |
| `src/app.module.css` | `.app` is a full-bleed relative box; `.status` is an absolutely centred overlay. `.title`/`.facts*`/`.probes*`/`.lookup*` deleted with their markup. |

Nothing else. `rspack.config.mjs`, `package.json`, `tsconfig.json`, `index.html`,
`src/scaffold.test.ts` and `assets/` are untouched. `../civitas-map` untouched.

### Deviations and additions

1. **Two additions the brief did not name, both from DESIGN sections 1.7 and 2:**
   `src/state/view-store.ts` (T04/T07/T08 all need the view) and `src/ui/render.ts`
   (keeps canvas drawing out of React).
2. **`view-store.ts` also exports `mapPixelAt(sx, sy)`**, not in the design's listed API.
   `MapCanvas` needs screen -> integer-map-pixel with the map-bounds test, and putting it
   in the store keeps `screenToMap` and the bounds check on one side of the boundary.
   T08 will want the same function for picking.
3. **`clampTranslate` treats a non-finite `view.x`/`view.y` as 0** before clamping. The
   design only guards NaN at `zoomAt`; `panTo` takes arbitrary numbers from a pointer
   handler, and DESIGN section 9.4 says a NaN in `view.x` is unrecoverable. Cheapest
   complete fix, and it is asserted by the last case in `translateTo`'s test.
4. **The drag threshold re-bases by exactly `DRAG_THRESHOLD`, not to the raw pointer
   position.** DESIGN 6.7 says "re-base `startX/startY` to the current client coords".
   That satisfies "the map does not jump by 3 px", but it discards the *whole* first move,
   however large. I proved this in the browser: a single-jump drag of 1500 px panned the
   map by **zero**. Real hands move a pixel at a time so the loss is normally ≤ 3 px, but a
   fast flick on a coarse mouse loses the lot. Re-basing along the direction of travel by
   exactly the threshold keeps the design's intent and bounds the loss at 3 px always.

### Verification — real command output

All from `javascript/packages/prototypes/civitas/civitas-interactive-map`.

```
$ yarn typecheck
typecheck exit: 0
```

(`tsc --noEmit` prints nothing on success.)

```
$ yarn test
... (tail)
✔ index.html keeps both the id and the class the app mounts on (0.107292ms)
✔ no source file imports a map asset into the bundle (0.879667ms)
✔ source files obey the grouped-named-export convention (1.2375ms)
✔ rspack config keeps the settings CSS modules and JSX depend on (72.740458ms)
ℹ tests 106
ℹ suites 0
ℹ pass 106
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 428.927875
```

81 -> **106**, i.e. the 25 new `view.test.ts` cases, 0 fail.

```
$ yarn build
build exit: 0
WARNING in ⚠ asset size limit: The following asset(s) exceed the recommended size limit (300.000 KiB). This can impact web performance.
  │ Assets:
  │   assets/map.png (2.530 MiB)
  │   assets/provinces_map.png (552.626 KiB)
  │   assets/provinces_manifest.json (586.891 KiB)

WARNING in ⚠ Rspack performance recommendations:
  │ You can limit the size of your bundles by using import() to lazy load some parts of your application.
  │ For more info visit https://rspack.rs/guide/optimization/code-splitting

Rspack compiled with 2 warnings in 70 ms
```

The same two pre-existing asset-size warnings T02 recorded. Still not silenced.

```
$ grep -rn "'" src/   (non-test files)
src/ui/MapCanvas.tsx:223:  // React's synthetic `onWheel` is registered passively, so `preventDefault`
src/ui/render.ts:37:// art's last column is repeated. Guarded on `gap > 0`, so a future re-export at
src/state/view-store.ts:8:// package's `../civitas-map/src/state/editor-state.ts`.
src/state/map-store.ts:36:// Idempotent: two components may both ask, and the second gets the first's
src/map/view.ts:130:// `source` is the ART bitmap's size (3652 x 2855), not the map size. Passing
src/map/province-index.ts:95:  // 41.7 MB for the real map, alive for the app's lifetime.
src/map/province-index.ts:137:    // through and `pixels[NaN]` returns `undefined` — a value this method's type
src/map/province-index.ts:150:  // throwing. The manifest's `unregisteredColors` is empty today, so this cannot
```

Every hit is an apostrophe in a comment. **Zero single-quoted string literals.**

### Mutation check — the four mutants DESIGN section 8 names all bite

Each applied to `src/map/view.ts` one at a time, `src/map/view.test.ts` run, then restored.

| Mutant | Fails | Which test |
|---|---|---|
| control | 0 | — |
| `sourceRect` floor/ceil swapped | 1 | `sourceRect leaves no uncovered strip when the map fills the viewport` |
| `zoomAt` reads the anchor AFTER the scale change | 1 | `zoom pins the map point under the cursor` |
| `shouldSmooth` drops the `dpr` factor | 1 | `shouldSmooth decides in device pixels, not CSS pixels` |
| `clampTranslate` small axis freely clamped | 3 | `fitView centres…`, `clampTranslate locks an axis smaller than the viewport to its centre`, `a square viewport exercises the other fit axis end to end` |

```
$ diff <saved original> src/map/view.ts && echo identical
identical
```

Two tests of my own first draft were **wrong** and the suite caught it: I assumed the
3653x2855 map fits a 1200x800 viewport on *width*. It fits on *height* (800/2855 <
1200/3653). The tests now pin both regimes — 1200x800 fits on height, 900x900 fits on
width — so a transposed `fitScale` cannot pass both.

### The real map in Chrome — dev server on port 64061, dpr 1, host 1728x906

Console across the whole session, filtered on everything: **one message**, and it is the
Chrome extension's own `port disconnected from addon code` warning. No app error, no
unhandled rejection, no `setPointerCapture` throw.

1. **Fitted and centred on load.** HUD `zoom 32%`; `906 / 2855 = 0.3173` -> 32% exactly, so
   the fit axis is height. Black letterbox left and right, no scrollbars
   (`documentElement.scrollWidth === clientWidth === 1728`).
2. **The transform is exact — probes read back through the HUD:**
   client (475, 124) -> map (599, 391) -> **province 1 "Province 1"**;
   client (150, 400), outside the map -> **none**;
   at 800%, map (1382, 1329) -> **province 1000 "Province 1000"**.
3. **Zoom pins the cursor, proven over the full range.** From 98%, sixty separate wheel
   events at a fixed client point (715, 449), all the way to the 800% cap: the map pixel
   under that point read **(1382, 1329) before and (1382, 1329) after**, province 1000
   both times. Zero drift over 60 zoom steps.
4. **Zooming out terminates at exactly the fit scale.** Forty wheel-down events land on
   `zoom 32%` and stop there.
5. **The clamp's small-axis regime is visible and correct.** Zooming in from the fit scale
   toward a cursor does *not* pin the x anchor until the scaled map exceeds the viewport
   width (scale > 1728/3653 = 0.473), because x is locked to centred below that. That is
   DESIGN decision 3 working, not drift — it disappears entirely above 0.473.
6. **Double-click zooms toward the clicked point, exactly.** Double-click at CSS (800, 343)
   from the fit view: `x` went 284.38 -> -231.2 and `y` 0 -> -343, against the predicted
   `2*284.38 - 800 = -231.24` and `-343`. Scale 32% -> 63% (0.3173 * 2 = 0.6347).
7. **Pan clamps flush, with no background sliver.** Dragged hard to the bottom-right: the
   HUD-derived view came out `x = -1121`, `y = -1321` against the computed limits
   `1728 - 3653*0.78 = -1121` and `906 - 2855*0.78 = -1321`. The map's right and bottom
   edges land exactly on the viewport edges.
8. **Scene and overlay share one coordinate system — measured, not eyeballed.** Read back
   both canvases' pixels at the fit view, row 400:
   ```
   {"dpr":1,
    "hairlinePixelsOnRow400":[{"x":284,"rgba":[215,163,74,89]},
                              {"x":1443,"rgba":[218,161,75,68]},
                              {"x":1444,"rgba":[219,158,73,21]}],
    "sceneFirstPaintedX":284, "sceneLastPaintedX":1443}
   ```
   The overlay hairline sits at 284 and 1443/1444; the scene's painted extent on the same
   row is 284..1443. They coincide to the pixel. Predicted edges: `(1728 - 3653*0.3173)/2
   = 284.38` and `284.38 + 1159.24 = 1443.62`. **`sceneLastPaintedX` reaching 1443 also
   proves `drawEdgeColumn` fills map column 3652** — the art is only 3652 wide, so without
   it the scene would stop at 1443 minus one scaled column and a background sliver would
   show inside the hairline.
9. **Crisp past 1:1.** At 800% the province art has hard, blocky pixel edges with no
   interpolation blur (screenshot inspected at 1:1 crop).
10. **Resize re-fits without stretching or drift.** `document.querySelector(".root")
    .style.width = "600px"` -> host 600x906, both canvas backing stores 600x906, CSS size
    600px/906px, zoom stayed 63% (legal: the new fit scale is `600/3653 = 0.164`). Set to
    1000px and back to auto: backing store followed each time, and the map content that
    stayed on screen did not move by a pixel across the restore.

**Verification trap, worth recording.** A Chrome tab driven by the MCP extension delivers
**no ResizeObserver callbacks and no rAF frames** until something forces a frame — a
screenshot does. I armed my own independent `ResizeObserver` on the same host and it saw
nothing either, which is how I established this is the harness and not the component.
Take a screenshot after any DOM change before reading the canvas back, or you will read a
stale backing store and think the observer is broken. This extends the existing
"hidden tabs never animate" note in memory to ResizeObserver.

Second trap: `mcp__claude-in-chrome__computer` coordinates are in **screenshot** space
(1512x793 here), not CSS pixels (1728x906). The factor was 1.1429. Every coordinate I
computed from HUD readings had to go through it, and check 6 above only reconciled once I
applied it.

Third trap: `javascript_tool` runs in the extension's **isolated world**. Dispatching DOM
events from there works, but patching a global or a prototype (`requestAnimationFrame`,
`CanvasRenderingContext2D.prototype.drawImage`) does not reach the app. I tried to count
repaints that way and got a confident, meaningless zero. Injecting a `<script>` tag did
not fix it either. **I have no measurement of the rAF coalescing** — see below.

### Deliberately left undone

- **No measurement of repaint coalescing.** The isolated-world problem above defeated both
  attempts. The guarantee is structural — one `frameRef` handle, `scheduleDraw` is a no-op
  while a frame is pending, nothing paints inside an event handler, and `zoomAt` returns
  the same reference at the cap so the store skips the signal write entirely — but it is
  argued, not measured. A reviewer who wants it measured should drive the page from
  DevTools rather than through the extension.
- **No unmount-leak test.** The app never unmounts `MapCanvas`; there is no route change
  to drive one. Every effect returns a cleanup (observer disconnected, wheel listener
  removed, media listener removed, pending frame cancelled) and `draw()` re-reads both
  refs and bails when either is null, but that is code review, not a run.
- **The two `yarn build` asset-size warnings are still not silenced**, same as T02.
- **No DOM/canvas/React tests.** PLAN section 4 forbids them and there is no jsdom.
- **Everything in DESIGN section 11**: borders (T04), hover highlight and selection (T08),
  country tinting/labels/panels, view persistence (T05), eased zoom, pinch-to-zoom,
  middle-button and keyboard panning, tile caches, and rendering `provinces_map.png`.
- **`README.md` not updated.** The docs agent owns it.

### Notes for the next agent

- **`shouldSmooth` is `scale * dpr < 1`.** Do not "fix" it to `scale < 1`; the reference
  package has that bug and it blurs the art on every retina display.
- **`sourceRect` takes the ART size (3652 x 2855)**, every other call takes the MAP size
  (3653 x 2855). Mixing them puts a `drawImage` source rect one column past the bitmap.
  `drawEdgeColumn` fills the resulting one-column gap and is guarded on `gap > 0`.
- **`view.value` is `View | null`** and stays null until both the map size and a non-zero
  viewport exist. Guard it; do not invent a default.
- **No store action may be called from inside a `useSignalEffect`** — they write signals
  they also read. DOM handlers and plain `useEffect`s only.
- **T04 appends to `drawOverlay` and must keep the bounds hairline.** It is the instrument
  that proves the two canvases have not diverged; check 8 above is only possible with it.
- The HUD in `MapCanvas.tsx` is marked in a comment as T03 verification UI. T08 replaces it.

---

## Tests

Three files touched, **+29 tests, 106 -> 135, 0 fail**. Node's runner via `tsx`, no new
dependency, no DOM, no jsdom, no React.

| File | Tests | What it pins |
|---|---|---|
| `src/map/view.test.ts` | 25 -> 27 | The implementer's own suite, plus two gaps: `clampView` clamps the scale AND recomputes the translate in one call (both the fit end and the `MAX_SCALE` end), and `snapView` passes a non-finite translate through by reference instead of rounding a NaN into a plausible number. |
| `src/state/view-store.test.ts` | 16 (new) | The store's guard logic — the part of T03 that had no tests at all. |
| `src/ui/render.test.ts` | 11 (new) | The geometry `render.ts` computes before it touches a context. |

### `src/state/view-store.test.ts`

The store is a module singleton, so each test calls a `reset()` helper that nulls `view`,
`mapSize` and `cursorMap` and zeroes `viewport`. `mapSize` is a plain writable signal
exported by `map-store`, so the map load never runs — no fetch, no `createImageBitmap`.
Signal writes are counted through `signal.subscribe` (the immediate first call is
discounted), which is how "writes nothing" is asserted rather than argued.

Covered: both arrival orders of map size and viewport (DESIGN 9.2); a 0x0 ResizeObserver
report leaving the previous view untouched **by reference** (9.1); a repeated viewport
writing neither signal; a resize that raises the fit scale re-clamping the scale and
re-centring (9.3); a resize that leaves the scale legal not touching it; 60 wheel steps
reaching `MAX_SCALE` and then 20 more writing nothing and keeping the same object
reference (9.5); the verified probe pixel (1382, 1329) staying under the cursor across 60
zoom steps up to the cap — the store-level version of the highest-value browser check;
zoom-out terminating on exactly `fitView`; `panTo` landing flush on all four limits and
surviving NaN (9.4); every action being a no-op before the map size exists; `resetView`
being idempotent; `setDpr` rejecting 0, negative, NaN and Infinity; `setCursor`
deduplicating on the integer pixel; `mapPixelAt` flooring, agreeing with `screenToMap`,
and rejecting map pixel 3653 / 2855 — the first illegal pixel of the authoritative
3653 x 2855 surface, which is the one an off-by-one bound lets through.

### `src/ui/render.test.ts`

**Not a canvas test.** The context is a plain recorder object (`as unknown as
CanvasRenderingContext2D`) and the art is `{ width, height } as unknown as ImageBitmap`.
Nothing renders; what is asserted is the arithmetic and the argument order.

Covered: `setTransform(dpr, 0, 0, dpr, 0, 0)` first and `clearRect` second, before any
draw; `drawImage` receiving eight numbers (the 9-argument form) in exactly `sourceRect`'s
order, so a transposed pair fails; the source rect being built from the ART size, never
the map size, checked panned hard right at scale 1, 4 and 8 (9.6); the edge column
drawing source column 3651 exactly one pixel wide at `view.x + 3652 * scale` for `scale`
CSS pixels, with the main draw plus the fill covering the map width exactly; the edge
column skipped when the right edge is off screen; the edge column disappearing entirely
if the art is ever re-exported at 3653 (`gap > 0` guard); smoothing decided in device
pixels (0.5/dpr 2 -> off); a degenerate view still clearing the stale frame and drawing
nothing; the overlay hairline using 3653 x 2855 with the half-pixel offset and
`lineWidth` 1; and the scene and overlay landing on the same snapped grid at dpr 2 with a
fractional translate (9.12).

### Mutation check — every new test earns its place

Each mutant applied to the source alone, the relevant test file run, then restored.
`diff` against the saved originals is empty for all three sources.

| Mutant | Fails |
|---|---|
| `drawScene` transposes `dx`/`dy` | 2 |
| `drawScene` feeds `sourceRect` the map size instead of the art size | 2 |
| `drawEdgeColumn` call removed | 1 |
| `drawOverlay` skips `snapView` | 2 |
| `writeView` always writes | 2 |
| `syncView` does not re-clamp on resize | 1 |
| `mapPixelAt` rounds instead of flooring | 3 |
| `mapPixelAt` bounds use `>` instead of `>=` | 1 |
| `setCursor` writes unconditionally | 1 |
| `syncView` accepts a 0 x 0 viewport | 2 |
| `clampView` clamps the scale but not the translate | 3 |

One mutant **survives and is equivalent**: dropping the `next === current` early return in
`zoomAtPoint`. `writeView` compares field by field, so the signal write is skipped anyway
and the stored reference is unchanged. The early return saves three comparisons and
documents the contract; no assertion can tell the two apart. Left in place, recorded here.

### Deliberately not covered

- **`MapCanvas.tsx`** — pointer gestures, the drag threshold and its re-base, the wheel
  `deltaMode` conversion, the rAF coalescing, canvas sizing, the ResizeObserver and the
  dpr media-query re-arm. All of it is DOM and React; PLAN section 4 forbids those tests
  and there is no jsdom. DESIGN section 10's browser checklist is their gate, and the
  implementer ran it.
- **Actual pixels.** Nothing here proves the art is on screen; it proves the numbers
  handed to `drawImage` are right. `map.png` cannot be decoded without a canvas.
- **`react` / signal reactivity.** The store tests read `signal.value` directly. No
  `useSignals`, no render, no effects.
- **The asset numbers themselves** (3653 x 2855, 1648 provinces, centroid as centre of
  mass) — `src/assets.test.ts` already pins them against the shipped files, so the new
  tests consume them as constants instead of re-asserting them. The two verified probe
  pixels from T02 are reused as the T03 transform's fixtures.

### Real output

```
$ yarn typecheck
typecheck exit: 0

$ yarn test
... (tail)
✔ drawScene clears but draws nothing for a view that produces no source rect (0.058708ms)
✔ drawOverlay strokes the AUTHORITATIVE map bounds as a 1 px hairline (0.100083ms)
✔ the overlay and the scene snap the view identically (0.113041ms)
✔ drawOverlay clears and returns for a degenerate scale (0.088792ms)
ℹ tests 135
ℹ suites 0
ℹ pass 135
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 455.448917
```

No source file was changed to make a test pass; the only edits outside the three test
files were the mutants, all reverted.

---

## Docs & commit

Commit: `4af248b2619987086e7a13df8b97bc4964dd1a8d` — "civitas interactive map — T03 renderer with zoom and pan".

### Verification before committing

All three green. Nothing needed fixing.

```
yarn typecheck   exit 0 (no output)
yarn build       exit 0, the same 2 asset-size warnings T02 recorded (not silenced)
yarn test        135 pass, 0 fail, exit 0
```

### README

Appended, not rewritten. Two edits to earlier text and one new section:

- The `Files so far` table gained `src/map/view.ts`, `src/state/view-store.ts`,
  `src/ui/MapCanvas.tsx` and `src/ui/render.ts`.
- `src/App.tsx`'s row no longer describes the deleted probe scaffolding.
- New `## Rendering, zoom and pan` section at the end: the two-canvas layout, the
  view transform (scale units, the fit minimum, the two pan regimes, cursor-anchored
  zoom, the same-reference guard, the snapped source rect), drawing (`prepare`,
  the 9-argument `drawImage`, `shouldSmooth` in device pixels, `drawEdgeColumn`,
  the bounds hairline as an instrument), input (non-passive wheel, `deltaMode`
  conversion, the 3 px drag threshold, double-click zoom, the rAF coalescing),
  the view store's three action rules, and five traps for later tasks.

### Files committed (14)

```
.plan/T02/memory.md          (T02's own docs section, left uncommitted by T02)
.plan/T03/DESIGN.md
.plan/T03/memory.md
README.md
src/App.tsx
src/app.module.css
src/map/view.ts
src/map/view.test.ts
src/state/view-store.ts
src/state/view-store.test.ts
src/ui/MapCanvas.tsx
src/ui/map-canvas.module.css
src/ui/render.ts
src/ui/render.test.ts
```

`javascript/package.json` and `javascript/yarn.lock` were **not** committed. T03
added no dependency. The only diff in `yarn.lock` is still the unrelated
`@hw/civitas-beautiful-map` workspace entry that T01 and T02 both flagged. It
belongs to that other package's commit.

### Trap the next docs agent must repeat

The repo index holds ~120 pre-existing staged files from unrelated work
(`.yarn/cache` zips, a skill file). Always commit with an explicit pathspec:
`git commit -F <msg> -- <PKG>`. A bare `git commit` sweeps them all in.

This section is appended after the commit, so `.plan/T03/memory.md` shows as
modified until T04 sweeps it in. Same pattern as T01 and T02.
