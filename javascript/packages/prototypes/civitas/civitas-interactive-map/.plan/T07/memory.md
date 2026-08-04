# T07 — think agent handoff

Design: `.plan/T07/DESIGN.md`. The algorithms are written out. Follow them literally.

## Decided, with reasons

- **Three files, split by purity.** `src/map/label-layout.ts` is pure maths (font ramp,
  anchor chain, pole search, greedy layout). `src/ui/label-layer.ts` owns `measureText` and
  the draw. `src/state/label-store.ts` owns the derived signal and the anchor cache. The
  brief demands the maths be testable without a canvas, and this split is what delivers it.
- **`CountryLabelSource` is declared in `src/map/label-layout.ts`, not in the store.**
  `render.ts` must reference the type, and it currently imports only from `./` and
  `../map/`. Declaring the type in the store would drag a `ui -> state` import into the
  renderer and break the layering T03/T04/T06 kept clean.
- **Anchor chain: weighted centroid -> province centres of mass largest-first (8 tries) ->
  pole of inaccessibility inside the LARGEST PROVINCE's bbox -> null.** Step 2 is what
  actually saves the crescent case: a province centre of mass is inside its own province
  for 1634 of 1648 provinces (T02 measured 14 that are not), and a province of the country
  is by construction inside the country. Step 3 is close to unreachable on this asset.
- **The pole search uses the largest province's bbox, never the country union bbox.** A
  union box reaches 3119 x 2427 map px, so a 24 x 24 grid samples every 130 px and misses
  thin arms. A province box is at most 12 642 px of area, which the same grid resolves.
- **The search is a coarse grid + chamfer distance transform + 2 refinement levels.**
  3 x 24² = 1728 `contains` calls. Chamfer weights are (1, √2), not Manhattan: Manhattan's
  iso-contours are diamonds and push the label toward a diagonal tip.
- **Font size follows `basePx * (scale / 0.32) ** 0.45`, clamped to 9..34 CSS px.** The
  zoom range is 25x; a linear ramp gives 328 px type at the cap. Sub-linear plus a clamp
  at both ends is the whole "neither vanishes nor billboards" requirement.
- **Text is drawn glyph by glyph with a manual advance, and measured the same way.**
  `ctx.letterSpacing` is engine-dependent, and the measured width MUST equal the drawn
  width or the fit test and every collision rect are wrong. Metrics are measured once per
  name at 100 px and scaled linearly, so the live size costs zero `measureText` calls.
- **Tracking adds `n - 1` gaps, not `n`.** No trailing space after the last glyph.
- **Halo is `strokeText` before `fillText`, all glyphs stroked before any is filled.**
  `shadowBlur` is the slow path and gives a soft glow, not a political-map casing. A
  per-glyph stroke-then-fill lets glyph N's halo eat glyph N-1's fill under tight tracking.
- **Dark type, light casing.** T04 chose dark border ink, which implies light map art. The
  implementer must confirm against a screenshot and swap the two constants if the art turns
  out dark. No runtime brightness probe.
- **The anchor cache is keyed on `country.provinceIds` ARRAY IDENTITY.** `assignProvinces`
  returns the same `Country` object for every country it did not touch, so identity is an
  exact "territory unchanged" test with no hashing. This is what keeps a paint drag cheap
  and what makes a rename free.
- **Labels draw LAST in `drawOverlay`, after the bounds hairline**, from the same
  `snapView(input.view, ratio)` the tint and the borders use.
- **No layout cache.** The layout is a pure function of (sources, view, viewport), all of
  which change on every pan, and the pass is tens of rect comparisons once metrics are warm.

## Surprises

- **Culling off-screen labels before the greedy pass is a bug, not an optimisation.** Under
  it a label that scrolls out frees its slot, a neighbour pops in, scroll back and it pops
  out — every pan makes labels jump. The collision pass must run over ALL candidates that
  pass the fit test; `LabelPlacement.visible` decides only what is drawn. Mutant 13 and
  test 29 exist for exactly this. It is the non-obvious correctness point of the task.
- **`measureLabelMetrics` is called from inside `drawCountryLabels`, AFTER the draw font is
  set.** It must save and restore `ctx.font`, or a cache miss renders that label at 100 px.
- **`countryLabelSources` must gate on `loadPhase.value === "ready"`.** Not just for the
  T06 trap (`getMapAssets()` notifies nobody) — the gate also guarantees no anchor is ever
  computed while `provinceAt` returns `null` for every pixel. Without it the cache fills
  with `null` anchors on the first pass and no country ever gets a label.
- **`countryContainsPoint` must use `countryOfProvince.peek()`, not `.value`.** It runs both
  inside a computed and inside a `requestAnimationFrame` callback. `.peek()` is correct in
  both and cannot widen a dependency set.
- `Array.from(text)`, never `text.split("")`. A split surrogate pair measures and draws as
  two replacement glyphs.
- Node tests can never reach a `"ready"` `loadPhase`, so `label-store.test.ts` is thin by
  construction — the same limit T06 recorded for `maxProvinceId`. Do not fake a
  `ProvinceIndex` to reach further; the maths under the store is fully covered in
  `label-layout.test.ts`.
- `src/index.css` has no `@font-face` and no `@import`, so the metric cache needs no
  `document.fonts.ready` invalidation. `clearLabelMetricsCache` is for tests only.

## Traps inherited

- `src/scaffold.test.ts` fails a line starting `export type { ... }`. Write `type Foo`
  inside the single grouped export at the end of the file.
- Never pass `input.view` into the label layout — only `snapView(input.view, ratio)`.
- Every new `OverlayInput` field stays optional; `render.test.ts` asserts that an overlay
  drawn without them is byte-identical to the previous task's.
- Province ids run 1..1650 over 1648 provinces. 1318 and 1458 do not exist.
- The T06 browser workaround applies: the tab is backgrounded between MCP calls, so nothing
  draws until a screenshot activates it, and synthetic pointer events need the
  `setPointerCapture` stubs.

## Highest-value checks

1. **The property test on `resolveLabelAnchor`** (design 9.1 test 20): over 200 seeded
   random shapes, every non-null anchor satisfies `contains`. "Never in the sea" as a
   theorem, not a spot check.
2. **The pan-invariance test** (test 29): the same candidates laid out from two view
   translations give the same placed set and the same `offsetIndex` per label.
3. **The crescent test** (test 13): the returned interior point must be on the ring, more
   than 40 units from the geometric centre that sits in the hole.
4. **The no-overlap property test** (test 24): 100 seeded random candidate sets, pairwise
   non-overlap over every returned placement.
5. **The `n - 1` tracking assertion** (test 40): an off-by-one there inflates every rect by
   one tracking unit and silently changes what gets dropped.

---

## Implementation (attempt 1)

Followed `.plan/T07/DESIGN.md` literally. Nothing in the design was changed or skipped.

### Files created

- `src/map/label-layout.ts` — PURE. `LABEL_FONT_RAMP`, `labelFontSize`, `chamferDistance`,
  `findInteriorPoint`, `resolveLabelAnchor`, `rectsOverlap`, `layoutLabels` plus the constants
  and types from DESIGN section 2. Imports only `mapToScreen`/`screenToMap` from `./view`.
- `src/map/label-layout.test.ts` — 38 tests, the bulk of the coverage.
- `src/ui/label-layer.ts` — the only file in the project that calls `measureText`. Font stack,
  per-code-point metrics cached at 100 px, `labelTextWidth`, `layoutCountryLabels`,
  `drawCountryLabels` (two-pass halo then fill), `getLastLabelStats`.
- `src/ui/label-layer.test.ts` — 13 tests against a recorder context whose `measureText`
  derives its width from the px size parsed out of the live `font`.
- `src/state/label-store.ts` — `showLabels`, `toggleLabels`, `countryContainsPoint`,
  `countryLabelSources`, the `provinceIds`-identity anchor cache, `clearLabelAnchorCache`,
  `labelAnchorCacheSize`.
- `src/state/label-store.test.ts` — 4 tests; thin by construction, see "Limits" below.

### Files changed

- `src/ui/render.ts` — `OverlayInput` gains optional `labelSources` and `countryContains`;
  labels lay out and draw LAST, after the bounds hairline, from `snapView(input.view, ratio)`.
- `src/ui/render.test.ts` — recorder gained `font`/`measureText`/`fillText`/`strokeText`/
  `textAlign`/`textBaseline`/`miterLimit`/`fillStyle`; +2 tests (labels after the hairline,
  omitting `labelSources` is byte-identical to the T06 output).
- `src/ui/MapCanvas.tsx` — passes the two overlay fields, adds `void countryLabelSources.value`
  to the draw effect, adds the `L` keydown toggle with the INPUT/TEXTAREA/SELECT/contentEditable
  guard, adds the `labels` and `placed` HUD readouts.

No CSS change, no `App.tsx` change, no schema field, no storage key. Anchors are derived only.

### Deviations from the design

One addition, no removals: DESIGN 9.1 test 10 does not distinguish `GRID_LEVELS` from 1 —
refinement is a sub-cell precision step, and for a filled shape it converges back onto the
coarse winner. Mutant 6 therefore survived the first mutation run. Added
`"the search refines GRID_LEVELS deep by default, not once"`, which pins that the default equals
`{ levels: GRID_LEVELS }`, differs from `{ levels: 1 }` on the crescent fixture, and that the
coarse answer sits exactly on the level-0 lattice while the refined one does not. Mutant 6 is
killed by it. Test count for `label-layout.test.ts` is therefore 38, not 37.

`LABEL_FILL` / `LABEL_HALO` were NOT swapped. DESIGN 6.4 asked for a screenshot check because
the art might be dark. The art IS fairly dark (slate sea, medium olive land), but dark glyphs
inside a light casing still read cleanly at every zoom — the casing is what carries the
contrast. Screenshots at 33 %, 100 %, 300 % and 800 % over land, coast, water, rivers and a
country border all stayed legible. Constants left as designed.

## Verification — real command output

```
$ yarn typecheck
(no output, exit 0)

$ yarn test
ℹ tests 405
ℹ suites 0
ℹ pass 405
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 591.991625

$ yarn build
WARNING in ⚠ asset size limit: The following asset(s) exceed the recommended size limit (300.000 KiB). This can impact web performance.
  │ Assets:
  │   assets/map.png (2.530 MiB)
  │   assets/provinces_map.png (552.626 KiB)
  │   assets/provinces_manifest.json (586.891 KiB)

Rspack compiled with 1 warning in 81 ms
```

T06 baseline was **348 passing**. T07 adds **57** (38 + 13 + 4 + 2) for **405 passing, 0 failed,
0 regressed**. No existing assertion was weakened, deleted or edited; the only edits to
`render.test.ts` are the extra recorder fields and two appended `test(...)` blocks.

Style self-checks — all four printed nothing except prose apostrophes in comments and test
names (the grep for `if (.*) [^{]` matched only multi-condition `if (...) {` lines whose body is
on its own line, and the >100-column hit `MapCanvas.tsx:141` is pre-existing T04 JSX):

```
$ grep -rn "^export type \|^export default \|^export \(const\|let\|var\|function\|class\|interface\|type\|enum\|async\)\b" src/
(nothing)
```

## Mutation check (DESIGN 9.5) — 21/21 KILLED

Script: `scratchpad/t07-mutate.py`. Each mutant is applied to the SOURCE alone, `yarn test` runs,
the file is restored, and the restore is proved by a sha256 compare before the next mutant.

```
 1 KILLED (1 failing)  labelFontSize drops the exponent (linear in scale)
 2 KILLED (1 failing)  labelFontSize drops the maxPx clamp
 3 KILLED (1 failing)  chamferDistance uses weight 1 for diagonals
 4 KILLED (3 failing)  chamferDistance runs only the forward pass
 5 KILLED (5 failing)  findInteriorPoint returns the bbox centre instead of searching
 6 KILLED (1 failing)  findInteriorPoint runs one level instead of GRID_LEVELS
 7 KILLED (4 failing)  resolveLabelAnchor returns the centroid without testing contains
 8 KILLED (3 failing)  resolveLabelAnchor skips the province step
 9 KILLED (1 failing)  resolveLabelAnchor ignores candidateLimit
10 KILLED (1 failing)  rectsOverlap uses <= so flush rects collide
11 KILLED (2 failing)  layoutLabels sorts by area ASCENDING
12 KILLED (1 failing)  layoutLabels drops the countryId tie-break
13 KILLED (3 failing)  layoutLabels culls off-screen candidates before the greedy pass
14 KILLED (1 failing)  layoutLabels skips the contains test on nudged offsets
15 KILLED (1 failing)  layoutLabels compares the fit test without view.scale
16 KILLED (4 failing)  layoutLabels places a colliding label anyway
17 KILLED (2 failing)  labelTextWidth uses n tracking gaps instead of n - 1
18 KILLED (1 failing)  measureLabelMetrics does not restore ctx.font
19 KILLED (1 failing)  measureLabelMetrics uses text.split("")
20 KILLED (2 failing)  drawCountryLabels interleaves stroke and fill per glyph
21 KILLED (1 failing)  drawCountryLabels ignores visible
--- restore verified, sha256 unchanged ---
bdf4b0219992b30c57f2a0497e591b71ba45f9a3ded8ae3f8cae208c129faa57  src/map/label-layout.ts
332819f9170e8ec6ec53f71439a3c952922a9106a3ba64c3399963fb7b337a26  src/ui/label-layer.ts
```

## Browser checklist (DESIGN 12.2) — `yarn dev`, Chrome, real readings

Fixture: nine countries seeded straight into `civitas.state.v1` and hard-reloaded — a RING
(`Ringwald`, 77 provinces in an annulus around map (1100, 1250) with the middle left
unassigned), a SPLIT country (`Splitania`, a 133-province northern cluster plus a small far
eastern island), a blob (`Aurelia`, 107 provinces) and six small adjacent countries
(`Vesk`/`Doria`/`Kelmar`/`Onso`/`Pyra`/`Tarn`, 3-11 provinces each).

The tab is BACKGROUNDED between tool calls, so `requestAnimationFrame` never fires and nothing
draws until a screenshot activates it. `setPointerCapture`/`releasePointerCapture`/
`hasPointerCapture` were stubbed to dispatch synthetic pointer events, per the T06 workaround.
The screenshot is 1493 px wide for a 1728 px CSS window, so screenshot coordinates were scaled
by 1.1574 before being fed to `getImageData`.

1. **Labels appear.** After the reload, zero clicks: `RINGWALD`, `SPLITANIA`, `AURELIA`, `VESK`,
   `TARN`, `ONSO` all drew, uppercase and tracked, each with a light casing.
   HUD `placed 6/9`. **This is also check 12** — nothing was clicked, so the
   `loadPhase.value === "ready"` read in `countryLabelSources` is doing its job.
2. **Zoom range.** Ink extents of `RINGWALD`, measured off the overlay canvas with
   `getImageData` (near-white halo pixels only, so borders and tint are excluded):

   | HUD zoom | ink w x h, CSS px |
   |---|---|
   | 33 % | 86 x 12.5 |
   | 300 % | 223 x 33 |
   | 800 % | 222.5 x 33 |

   Visibly smaller at fit, and IDENTICAL at 300 % and 800 % — the `maxPx = 34` clamp. The half
   pixel of difference is sub-pixel placement of the same 34 px type.
3. **Hidden when too small.** `Pyra` (bounds 72 x 137 map px). Predicted cut-over from the fit
   test: 97 %. Measured: at **HUD `zoom 94%`** the `PYRA` label is absent while every other
   label still draws; at **HUD `zoom 99%`** it is back. Pressing `L` twice at 94 % changed only
   whether labels drew at all, so the disappearance is the fit test and not a collision.
4. **No overlap.** At 99 % all seven surviving labels drew — `VESK`, `DORIA`, `TARN`, `KELMAR`,
   `PYRA`, `ONSO`, `LORLAND REPUBLIC` — and no two casings touch. `drawn` is below `candidates`
   at several zooms (`6/9` at 33 %, `4/9` at 100 %, `1/9` at 300 % and 800 %), so the greedy
   pass really is dropping labels.
5. **Larger wins.** `Kelmar` (7,803 px) keeps the upper slot; `Pyra` (4,454 px, the smallest
   country) is the one that is nudged below-left, and it is the first to vanish as the map
   zooms out.
6. **THE HEADLINE — never in the sea.** `Ringwald`'s area-weighted centroid is
   **(1147, 1222)**, which `provinceAt` resolves to **province 832 — owned by nobody**, i.e.
   the hole in the ring. The chain therefore fell through to step 2 and returned
   `source: "province"`, anchor **(999, 1102)**, province **692**, which IS Ringwald's.
   Confirmed live: hovering the drawn label's centre at 33 % put the HUD at
   `px 997, 1096  province 692 Province 692`. Pressing `L` blanked every label and showed the
   ring's hole underneath, untinted. The label sits on the ring.
7. **Split country.** `Splitania`'s weighted centroid (2570, 825) is inside its big northern
   cluster (province 395), so the label sits on the mainland, not on the small eastern island
   and not in the water between them.
8. **Pan invariance.** At 100 %, label ink measured over the whole overlay:
   `A = {pixels: 21144, x: 0, y: 152, w: 1518, h: 493}` -> drag 600 px left ->
   `B = {pixels: 20196, x: 210.5, y: 152, w: 710.5, h: 493}` -> drag 600 px back ->
   `C = {pixels: 21144, x: 0, y: 152, w: 1518, h: 493}`. **C is byte-identical to A.** Nothing
   popped in or out except at the viewport edge.
9. **Halo legibility.** Screenshots at 300 % and 800 % put `RINGWALD` across a coastline and a
   country border; every glyph stays readable. At 99 % `KELMAR` crosses onto a neighbouring
   province and over a river and still reads. The art is dark-ish but the casing carries the
   contrast, so `LABEL_FILL`/`LABEL_HALO` were left as designed.
10. **Alignment.** At 800 % the label sits on its province with no drift, and the pan test above
    shows the ink translating by exactly the drag distance and returning to the same pixel.
11. **No freeze while painting.** A 12-move left drag with `assign: on` and eight countries
    labelled took **9.2 ms** to dispatch end to end and moved `Vesk` from 9 to 41 provinces
    (80,754 px), stealing 11 from `Lorland Republic`. HUD after: `country 4 ms / 12106` —
    inside T06's 1-11 ms range. Every label recomputed its position live.
12. See 1.
13. **Rename repaints.** Renaming `Aurelia` to `Lorland Republic` in the panel changed the map
    label to `LORLAND REPUBLIC` with no map interaction at all. This is the
    `void countryLabelSources.value` line in the draw effect.
14. **`L` in a text field.** Typing `"Lorland Republic"` — which contains both `L` and `l` —
    into the country name input left the HUD at `labels on` throughout.

## Limits, stated honestly

- `src/state/label-store.test.ts` is thin (4 tests) and cannot be otherwise: in Node the
  manifest never loads, `loadPhase` never reaches `"ready"`, and `countryLabelSources` can only
  ever return `[]`. Same constraint T06 recorded for `maxProvinceId`. No fake `ProvinceIndex`
  was built to reach further — the store is a cache lookup and a loop, and the maths under it is
  covered in full by `label-layout.test.ts`. The store's real behaviour was verified in the
  browser instead (checks 1, 6, 11, 13 above).
- The fit test is against the country's BOUNDING BOX, per the brief. A long thin country passes
  the width test even where no part of it is wide enough, so a label can overhang into water at
  its ends. Seen on `Pyra` at 100 %. DESIGN section 11 lists the run-length probe as out of
  scope; it is the obvious next refinement.
- `getLastLabelStats()` is one frame stale by construction, so the HUD `placed` readout always
  reports the PREVIOUS frame. Every reading quoted above accounts for that.

---

## Tests

Tests agent. Two new files, **35 tests**, no source change. `yarn test` goes from 405 to
**440 passing, 0 failed, 0 regressed**. No existing assertion was weakened, deleted or edited.

### Files added

| Path | Tests | What it pins |
|---|---|---|
| `src/map/label-layout-edges.test.ts` | 25 | The tuning constants, the option overrides, the guards, the degenerate inputs. |
| `src/ui/label-layer-cache.test.ts` | 10 | The metric cache lifetime, the degenerate strings, the type state the draw leaves. |

The implementer's `label-layout.test.ts` (38), `label-layer.test.ts` (13),
`label-store.test.ts` (4) and the two `render.test.ts` additions already cover the happy
paths and the headline invariants. These two files cover the boundary around them, chosen
so that every one is a regression a future edit could plausibly cause.

### Covered — `src/map/label-layout-edges.test.ts`

- **The constants themselves.** `ANCHOR_CANDIDATE_LIMIT` 8, `GRID_CELLS` 24, `GRID_LEVELS` 3,
  `FIT_WIDTH_RATIO` 1.05, `FIT_HEIGHT_RATIO` 1.6, `LABEL_PADDING_X` 6, `LABEL_PADDING_Y` 3,
  `COORD_LIMIT` 1e6, and the whole `LABEL_FONT_RAMP`. Everything downstream is sized around them.
- **`NUDGE_OFFSETS` shape.** Offset 0 is the anchor, no offset repeats, vertical nudges come
  before horizontal ones, and no offset is large enough to fling a label across the map.
- **The ramp against the PLAN's numbers.** `referenceScale` is within 0.01 of the real
  `fitScale({3653, 2855}, {1150, 900})`, the opening view draws within 0.5 px of `basePx`,
  and `labelFontSize(MAX_SCALE)` is exactly `maxPx`. This is the test that ties the font
  ramp to the authoritative map size instead of to a magic number.
- **A caller-supplied ramp** is honoured, clamps included, and does not disturb the default.
- **A degenerate ramp** (`referenceScale` 0 or negative) returns `minPx` rather than leaking
  `Infinity` or `NaN` into every collision rect.
- **`chamferDistance` on an empty or negative grid** returns an empty field instead of throwing.
- **`chamferDistance` row-major indexing**, pinned as an exact 5 x 3 field. A transposed
  implementation produces a different field and fails.
- **No in-shape cell keeps its `Infinity` seed** on a speckled 9 x 7 mask.
- **The grid options are floored and clamped**, not taken raw: `cells: 1` behaves as
  `cells: 3` on a half-filled box (a 1 x 1 grid would miss the shape entirely), `levels: 0`
  behaves as `levels: 1`, and `cells: 6.9` behaves as `cells: 6`.
- **A `NaN` grid option gives up rather than throwing.**
- **The pole search costs exactly `GRID_LEVELS * GRID_CELLS²` = 1728 probes.** The cost
  budget in DESIGN 4.3, as an assertion.
- **A non-finite centroid** is skipped and never reaches `contains`.
- **A province with non-finite coordinates** is skipped, the next one answers, and the
  bitmap is never asked about the `NaN` pixel.
- **The returned anchor is a copy.** Mutating it cannot corrupt the aggregate's centroid.
- **`input.grid` reaches the pole search** — a `{cells: 3, levels: 1}` search costs 9 probes,
  not 1728.
- **A failed pole search returns `null`**, never a guessed bbox centre. This is the "no label
  in the sea" invariant at its last branch.
- **`COORD_LIMIT`**: an anchor past the limit is dropped; one inside it is placed but invisible.
- **A non-finite anchor** is dropped, on either axis and for `Infinity` as well as `NaN`.
- **`paddingX` / `paddingY` overrides** shape the rect and move the draw origin with it.
- **`fitWidthRatio` / `fitHeightRatio` overrides**, each shown against a candidate the
  default ratio hides and the override reveals.
- **`layoutLabels` sorts a copy** — the caller's array comes back in its original order.
- **`contains` is never consulted when nothing collides.** Offset 0 is trusted, so a
  non-colliding label costs zero bitmap reads per frame.
- **With `contains` omitted every nudge is allowed** (the `?? () => true` default).
- **A 0 x 0 viewport** places every label and draws none.
- **Visibility uses the same flush rule as collision**: a rect whose left edge equals the
  viewport width is not visible; one pixel in, it is.

### Covered — `src/ui/label-layer-cache.test.ts`

- **The metric cache evicts the OLDEST entry** once it holds `METRIC_CACHE_LIMIT` names, and
  the newest survive. Nothing tested the eviction before.
- **The layout and the draw share one cache** — a name is measured once per frame, not twice.
- **An empty name** measures nothing and is zero wide. Without the `Math.max(0, n - 1)` floor
  this returns a NEGATIVE width.
- **A one-glyph name carries no tracking.**
- **A broken `measureText`** (returning `NaN`, or a negative width) cannot put `NaN` into a
  collision rect.
- **A name at the schema's `NAME_MAX` of 120** is measured whole with 119 tracking gaps —
  never truncated, ellipsised or wrapped.
- **`labelFont` keeps a fractional size intact** (`labelFontSize` returns floats).
- **The draw leaves the exact type state the design specifies**: `font`, `textAlign`,
  `textBaseline`, `lineJoin`, `miterLimit`, `strokeStyle` and `fillStyle`.
- **An empty source list resets `getLastLabelStats`** instead of leaving the previous frame's
  numbers on the HUD.
- **`layoutCountryLabels` forwards `contains`** to the collision pass, and asks only about
  the country it is nudging.

### NOT covered, and why

- Anything that needs a real canvas, a DOM or a React render. There is no jsdom in this repo.
  `MapCanvas.tsx` — the `L` key toggle, the HUD readouts, the `void countryLabelSources.value`
  line in the draw effect — has no unit coverage and cannot have any. It was verified in the
  browser instead (DESIGN 12.2 checks 13 and 14 in the implementation section above).
- `src/state/label-store.ts` beyond the implementer's 4 tests. In Node `loadPhase` never
  reaches `"ready"`, so `countryLabelSources` can only ever be `[]` and `anchorFor` never
  runs. The `provinceIds` array-identity cache, the dead-country eviction and the
  `loadPhase` re-subscription are therefore unreachable from Node. I did not fake a
  `ProvinceIndex` to reach them — that would test the fake. Browser checks 1, 6, 11 and 13
  are the real evidence for that file.
- Glyph rasterisation, halo appearance, colour choice. Judged on screenshots, not numbers.
- The fit test's known limitation (a long thin country passes the bounding-box width test).
  It is intended behaviour per DESIGN 5.1 and section 11, so there is nothing to regress.

### Mutation check on the NEW tests — 17/17 KILLED

Each mutant is applied to the SOURCE alone, `yarn test` runs, the file is restored, and the
restore is proved with a sha256 compare. Script: `t07-tests-mutate.py` in the session
scratchpad, not committed. These are deliberately DIFFERENT mutants from the
implementer's 21 — each one targets a branch that only the new tests reach.

```
 1 KILLED  layoutLabels sorts the caller's array in place
 2 KILLED  chamferDistance transposes cols and rows
 3 KILLED  findInteriorPoint takes options.cells raw
 4 KILLED  labelFontSize drops the non-finite guard on raw
 5 KILLED  resolveLabelAnchor returns the centroid object itself
 6 KILLED  resolveLabelAnchor ignores the caller's grid options
 7 KILLED  resolveLabelAnchor falls back to the bbox centre
 8 KILLED  layoutLabels drops the COORD_LIMIT guard
 9 KILLED  layoutLabels ignores paddingX / paddingY
10 KILLED  layoutLabels tests contains on offset 0 too
11 KILLED  visible uses a touching-counts rule
12 KILLED  the metric cache evicts the NEWEST entry
13 KILLED  labelTextWidth drops the Math.max(0, ...) floor
14 KILLED  measureLabelMetrics trusts whatever measureText returns
15 KILLED  layoutCountryLabels drops contains on the way through
16 KILLED  layoutCountryLabels leaves stale stats for an empty list
17 KILLED  drawCountryLabels leaves the baseline alone
--- restore verified, sha256 unchanged ---
bdf4b0219992b30c57f2a0497e591b71ba45f9a3ded8ae3f8cae208c129faa57  src/map/label-layout.ts
332819f9170e8ec6ec53f71439a3c952922a9106a3ba64c3399963fb7b337a26  src/ui/label-layer.ts
```

Both hashes match the ones the implementer recorded above, so no source file was touched by
this agent.

One test was rewritten after the mutation run showed it was vacuous: "the grid options are
floored and clamped" originally compared `cells: 1` against `cells: 3` over an
all-inside predicate, where both answers are the box centre whether the clamp exists or
not. It now uses a half-filled predicate, where an unclamped 1 x 1 grid samples an outside
point and returns `null`. Mutant 3 was surviving before that change and is killed now.

### Verification — real command output

```
$ yarn typecheck
(no output, exit 0)

$ yarn test
ℹ tests 440
ℹ suites 0
ℹ pass 440
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 620.184875
```

Style self-checks on the two new files printed nothing except prose apostrophes inside
comments and test names, and no line exceeds 100 columns.
