# T08-FIX — handoff

Design: `.plan/T08-FIX/DESIGN.md`. Read it before writing code; this is the summary.

## What is being fixed

VISUAL-CHECK-PHASE2 section 3. D1 resize ratchet (must), D2 dead `resetView` (must),
D3 label overhang (best effort — the design says DO it, with a fallback pass).

## The shape of the fix

- **No new source file.** Edits only: `src/map/view.ts`, `src/state/view-store.ts`,
  `src/ui/MapCanvas.tsx`, `src/ui/Shell.tsx`, `src/ui/shell.module.css`,
  `src/map/label-layout.ts`, three test files, `README.md`.
- **`clampScale`, `clampView`, `zoomAt` and `MAX_SCALE` do not change.** The fit
  floor is right for user zoom and is pinned by tests. Only the RESIZE path stops
  using it, through a new `resizeView` that clamps to `MIN_SCALE..MAX_SCALE` and
  re-clamps the translation.
- **`clampView` stays exported.** It is now used only by `view.test.ts` and by ~15
  `render.test.ts` fixtures. Do not delete it; do not route the resize through it.
- **`viewFitted` is a derived flag**, recomputed inside `writeView` as
  `scale === fittedScale(map, viewport)` and stored in a signal. Zoom in clears it,
  zoom out to exactly fit sets it, `resetView` sets it — with no per-action wiring.
  It is read one viewport STALE in `syncView`, which is the whole mechanism: it has
  to answer "was this fitted before the resize".

## Traps

- `writeView` must derive the flag BEFORE its `sameView` early return, or a resize
  that leaves the view untouched keeps a stale flag.
- `writeView` reads `mapSize` and `viewport` with `.peek()`, never `.value`.
- `isFittedScale` must compare against `fittedScale` (fit capped at `MAX_SCALE`), not
  raw `fitScale`. A viewport over 8x the map would otherwise read "not fitted"
  forever and never re-fit again.
- **Add `viewFitted.value = true;` to `reset()` in `view-store.test.ts`.** Without it
  a leftover `false` leaks into later tests in that file.
- A non-fitted scale below the new fit now letterboxes on all four sides. That is the
  briefed policy, not a bug. `0` re-fits.
- Exact `===` on the scale is safe: `fitScale` is deterministic and `zoomAt` returns
  the floor value itself. The existing "terminates at exactly the fit view" test
  already relies on it.

## D2

`0` resets the view. It joins the EXISTING keydown effect in `MapCanvas.tsx` (do not
add a second window listener), sharing a lifted `isTypingTarget` helper with the `l`
label toggle. The `Reset view` button goes in `Shell`'s `.bar`, a sibling of the map
host, so it needs no `data-hud-control`. The HUD gains a `fit yes|no` readout — that
is the browser instrument for D1.

## D3

The end probe lives in `layoutLabels`' offset loop: back-project the two ends of the
TEXT SPAN and require `contains` on both. Run the 7-offset trial once with the probe
on; if it finds nothing, run it again with the probe off. The fallback is what makes
it safe — the probe can change which offset wins, never whether a label is placed.
**If an existing label test fails anyway, put the probe behind `probeEnds?: boolean`
defaulting to false and opt in from `layoutCountryLabels`. Never weaken a T07 test.**

## Done when

`yarn test` reports ≥ 493 passing and 0 failing (per-file today: `view.test.ts` 27,
`view-store.test.ts` 16, `label-layout.test.ts` 38), `yarn typecheck` is silent,
`yarn build` emits, and the browser sequence 906 → 1400 → 906 returns to 32%.

---

## Implementation (attempt 1)

Followed the design. One deviation, in D3 — see below.

### Files changed

- `src/map/view.ts` — added `MIN_SCALE`, `fittedScale`, `isFittedScale`, `resizeView`; `fitView` now builds on `fittedScale`; four names added to the grouped export. `clampScale`, `clampView`, `zoomAt`, `fitScale` and `MAX_SCALE` untouched.
- `src/map/view.test.ts` — 3 new tests for `resizeView` / `fittedScale` / `isFittedScale`. No existing test edited.
- `src/state/view-store.ts` — new `viewFitted` signal; `writeView` derives it before its `sameView` early return, reading `mapSize`/`viewport` with `.peek()`; `syncView` branches fitted -> `fitView`, not fitted -> `resizeView`; the first-view path now goes through `writeView`. Import changed from `clampView` to `fitView, isFittedScale, resizeView, ...`.
- `src/state/view-store.test.ts` — `reset()` also sets `viewFitted.value = true`; 6 new tests, including the required 906 -> 1400 -> 906 sequence.
- `src/ui/MapCanvas.tsx` — module-level `isTypingTarget`; the existing keydown effect now handles `l`/`L` and `0` through that one guard (no second window listener); `Hud` gained a `fit yes|no` readout.
- `src/ui/Shell.tsx` — a `Reset view` button plus a divider in the existing `.bar`, calling `resetView()`.
- `src/ui/shell.module.css` — `.barDivider` and `.barAction` (+ `:hover`), tokens only, one declaration per line.
- `src/map/label-layout.ts` — the 7-offset trial extracted to `chooseOffset(..., requireEndsInside)`; new `LayoutOptions.probeEnds`, default false; `layoutLabels` runs the probe pass then falls back to the plain pass.
- `src/map/label-layout.test.ts` — 4 new tests (the probe moves a label off a thin stem to a wide arm, the fallback never costs a label, pan invariance, and the default stays probe-free).
- `src/ui/label-layer.ts` — `LabelLayoutInput.probeEnds`, forwarded verbatim.
- `src/ui/label-layer-cache.test.ts` — 1 new test pinning the forwarding and the default.
- `src/ui/render.ts` — `drawOverlay` passes `probeEnds: true`. This is the deviation; see below.
- `README.md` — "The fitted policy (T08-FIX)" under the view store, a "Keyboard and the reset control" subsection with the shortcut table, and "The end probe (T08-FIX)" under the label layout; the old "a run-length probe is the next refinement" trap replaced.

### D3 deviation: the probe is opt-in and `render.ts` opts in

The design's primary plan (probe always on, fallback pass) broke two EXISTING tests, both of which pin that offset 0 consults `contains` zero times:

- `src/map/label-layout-edges.test.ts` — "contains is never consulted when nothing collides"
- `src/ui/label-layer-cache.test.ts` — "layoutCountryLabels forwards contains to the collision pass" (`only the nudged country is ever asked about`)

The end probe cannot honour that and still fix the overhang: the overhang IS offset 0. Neither test was weakened. The design's escape hatch (`probeEnds` defaulting false, opted into from `layoutCountryLabels`) does not clear the second failure, because that test calls `layoutCountryLabels` itself. So the opt-in was moved one level up: `layoutCountryLabels` forwards the flag and `drawOverlay` turns it on. Both settings are covered by new tests at both levels. The cost is that the two pinned tests now describe a configuration production does not use — recorded here rather than hidden.

`render.test.ts` is unaffected: its label fixtures pass no `countryContains`, so the default predicate accepts every point and the probe changes nothing.

### Verification — real output

```
$ yarn typecheck
(no output, exit 0)

$ yarn test
ℹ tests 507
ℹ suites 0
ℹ pass 507
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 606.120208

$ yarn build
WARNING in ⚠ asset size limit: The following asset(s) exceed the recommended size limit (300.000 KiB). This can impact web performance.
  │ Assets:
  │   assets/map.png (2.530 MiB)
  │   assets/provinces_map.png (552.626 KiB)
  │   assets/provinces_manifest.json (586.891 KiB)

Rspack compiled with 1 warning in 83 ms
```

493 before, 507 after: 14 added, 0 changed, 0 removed.

Sanity greps:

```
$ grep -rn "clampView" src/ | grep -v "\.test\."
src/map/view.ts:85:function clampView(...)          # still exported, still test-used
src/map/view.ts:111:# a comment naming it
src/map/view.ts:241:  clampView,
src/state/view-store.ts:77:# a comment naming it — no call site
```

`resetView` in `src/ui/`: `Shell.tsx:10,145` and `MapCanvas.tsx:51,449`.

### Browser verification

`yarn dev` on `http://localhost:54376/`, Chrome, host 1728 x 906, the host's own `ResizeObserver` driven by setting the shell's height — the same method `.plan/VISUAL-CHECK-PHASE2.md` used.

| Step | Host height | HUD zoom | HUD fit |
|---|---|---|---|
| load | 906 | 32% | yes |
| grown | 1400 | 47% | yes |
| restored | 906 | **32%** | yes |

The ratchet is gone: the visual check recorded 47% at the last step.

| Step | HUD zoom | HUD fit |
|---|---|---|
| wheel in | 134% | no |
| grown to 1400 | 134% | no |
| back to 906 | 134% | no |
| press `0` | 32% | yes |
| deep zoom | 800% | no |
| click `Reset view` | 32% | yes |

The typing guard: with the view at 93% and a country-name field focused, `0` and `l` dispatched at the field changed neither the zoom nor the label state. With the field blurred, `l` toggled labels off and `0` returned the view to 32%.

Console across the whole session: one message, the Claude Chrome extension's own `port disconnected from addon code` warning. Zero from the app.

### Deliberately left undone

- No animated or eased reset; `resetView` is an instant jump, as designed.
- No zoom in/out buttons, slider, minimap or keyboard panning.
- The view, the zoom and `viewFitted` are still session state — nothing new is persisted and no migration was added.
- `clampView` kept, exported and test-used. The resize path simply no longer calls it.
- The label FIT test still uses the union bounding box. Only the placement stage probes.

---

## Tests

14 regression tests added on top of the implementation's 14. `yarn test` goes
507 -> 521. No existing test was edited, weakened or deleted, and no source file
was changed — every mutation below was reverted after it was measured.

### What was added

`src/map/view.test.ts` (+4)

- `MIN_SCALE is 0.02, and 0.02 still leaves a map on screen` — pins the number
  itself plus the 3653 x 2855 -> 73 x 57 px claim from the source comment, and
  that MIN_SCALE sits below the fit scale of even a 320 x 240 viewport.
- `resizeView returns every legal scale unchanged, at every viewport, idempotently`
  — 6 scales x 6 viewports. The idempotence half is the ResizeObserver flurry:
  the second report of the same size must be a no-op.
- `THE RATCHET: a grow-then-shrink round trip moves clampView and not resizeView`
  — the defect as a property over three grown viewports, asserting `clampView`
  really ratchets on each one so the comparison is never vacuous.
- `isFittedScale rejects a non-finite scale and the UNCAPPED fit scale` — NaN and
  both infinities, plus the past-the-cap case from the other side: the raw
  `fitScale` is NOT the fitted scale there.

`src/state/view-store.test.ts` (+6)

- `a resize that leaves the view identical still re-derives the fitted flag` —
  THE TRAP, as a test. Map 1000 x 1000, host 500 x 500, zoom x1.8 to scale 0.9,
  pan flush to the top-left, then resize to 900 x 900: `resizeView` returns a view
  equal to the current one, `sameView` bites, nothing is written — and 0.9 is
  exactly the 900 x 900 fit scale, so the flag must still flip to true. Verified
  the reference is unchanged and the write count is 0.
- `fractional viewport jitter re-fits in BOTH directions and leaves no residue` —
  906.4 / 905.6 / 907.25 / 904.125 / 906, scale equal to the fit at every step
  and `deepEqual(fitView(MAP, HOST))` at the end.
- `a viewport more than 8x the map is still a FITTED view and still re-fits` —
  100 x 100 map in a 1200 x 1000 host (raw fit 10, capped to 8), then shrink to
  400 x 400 and assert the scale is 4. This is the case that distinguishes
  `fittedScale` from `fitScale` at the store level.
- `a dpr change never touches the view or the fitted flag` — both while fitted
  and while zoomed, with the view write count pinned at 1.
- `a 0 x 0 report does not re-arm a zoomed view` — the complement of the existing
  fitted-survives test.
- `a pan never re-arms the re-fit` — the flag is derived from the SCALE alone.

`src/map/label-layout.test.ts` (+3)

- `the probe never costs a placement — 100 seeded random countries` — the safety
  property, over random unions of three discs with the anchor always in-country.
  Asserts the counts match, and that whenever the offset differs the plain
  placement's span ends were OUTSIDE and the probed one's are inside. A `moved`
  counter fails the test if no fixture ever exercised the probe.
- `the probe measures the TEXT SPAN, not the padded box, and it runs at offset 0`
  — a strip exactly `textWidth / 2` either side of the anchor wins offset 0 after
  exactly 2 `contains` calls; a strip 0.1 px narrower needs more than 2 and falls
  back to offset 0. The 2 is the signature of "offset 0 is probed at all".
- `with no country predicate the probe changes nothing at all` — 30 random
  candidates, `deepEqual` with the probe on and off. This is the claim
  `render.test.ts`'s byte-identical label fixtures rest on.

`src/ui/render.test.ts` (+1)

- `drawOverlay turns the end probe ON for the production label path` — the D3
  deviation was previously pinned by nothing. `countryContains` is called
  exactly twice, both calls on the same y and left before right. Deleting
  `probeEnds: true` from `render.ts` made the fix dead code and no test noticed.

### Mutation check — every new test was proved to fail on a real regression

| Mutation | Failing tests |
|---|---|
| derive the flag AFTER `sameView` returns | 1 |
| `isFittedScale` uses `fitScale`, not `fittedScale` | 3 |
| `resizeView` goes back through `clampScale` | 5 |
| `render.ts` passes `probeEnds: false` | 1 |
| the probe measures `boxW / 2`, not `textWidth / 2` | 2 |
| the fallback pass is removed | 3 |
| `syncView` drops its fitted branch | 8 |

### Not tested, and why

`MapCanvas.tsx`'s `0` shortcut and `isTypingTarget`, and `Shell.tsx`'s
`Reset view` button. There is no jsdom in this repo and the runner is
`tsx --test` over `src/**/*.test.ts`; a DOM test would need a new dependency.
The action behind both, `resetView`, is pinned by the store tests. Reachability
stays a browser check (memory.md, "Browser verification").

### Verification — real output

```
$ yarn typecheck
(no output, exit 0)

$ yarn test
ℹ tests 521
ℹ suites 0
ℹ pass 521
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 593.824042
```
