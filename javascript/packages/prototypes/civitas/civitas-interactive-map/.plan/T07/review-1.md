# T07 review 1 — EU-style country labels

Reviewer: adversarial review agent. Verdict: **ACCEPTED, zero blocking items.**

## Commands I ran myself

From `javascript/packages/prototypes/civitas/civitas-interactive-map`. Exit codes captured
directly, not piped through `tail`.

| Command | Exit | Result |
|---|---|---|
| `yarn typecheck` | 0 | no output |
| `yarn test` | 0 | `tests 405  pass 405  fail 0  cancelled 0  skipped 0  todo 0` |
| `yarn build` | 0 | one warning, the three pre-existing asset-size entries (`map.png`, `provinces_map.png`, `provinces_manifest.json`) |

The memory file's pasted counts match what I regenerated. 405 = the 348 T06 baseline plus
38 (`label-layout.test.ts`) + 13 (`label-layer.test.ts`) + 4 (`label-store.test.ts`) + 2
appended to `render.test.ts`, confirmed with `grep -c '^test('` per file.

## Independent probe of the pure module

I wrote my own script against `src/map/label-layout.ts` rather than trusting its test file.

- Font ramp reproduces the DESIGN table exactly: `0.1 -> 9.00`, `0.32 -> 13.00`,
  `1 -> 21.71`, `3 -> 34.00`, `8 -> 34.00`. Clamped at both ends, sub-linear in between.
- 500 randomised `layoutLabels` runs (up to 25 candidates, random view scale 0.1..8, random
  pan, `contains` restricted to a disc): **0 overlapping rect pairs**.
- 300 randomised ring shapes through `resolveLabelAnchor` (centroid always in the hole):
  **0 anchors outside the country, 0 null anchors**. The "never in the sea" invariant holds
  on fixtures the implementer did not write.

## Brief and design coverage

| Brief clause | Where | Verdict |
|---|---|---|
| Area-weighted centroid first | `label-layout.ts:303-310` | ok |
| Fallback to largest contiguous province | `label-layout.ts:315-324` (province centres, largest first, `candidateLimit` 8) | ok |
| Pole-of-inaccessibility fallback | `label-layout.ts:227-294`, called at `:335` | ok |
| Never in the sea | every non-null return passed `contains`; no bbox-centre escape hatch | ok |
| Uppercase, letter-spaced, haloed | `label-store.ts:117` uppercases; `label-layer.ts:21,162` tracking; `:169-171` stroke casing | ok |
| Canvas 2D on the overlay | `render.ts:183-191`, drawn last, from `snapView(input.view, ratio)` | ok |
| Size scales with zoom, clamped | `label-layout.ts:143-152` | ok |
| Hide when the on-screen bbox cannot fit the MEASURED text | `label-layout.ts:396-401`, widths from `measureText` in `label-layer.ts:60-101` only | ok |
| Greedy, area-descending, larger wins | `label-layout.ts:374-376,387-471` | ok |
| Pure module, widths passed in | `label-layout.ts` imports only `./view` and two types; no canvas, no DOM, no signals | ok |
| Unit tested | 38 + 13 tests, including the anchor property test and the pan-invariance test | ok |

Nothing in the design was stubbed or silently skipped. The one declared deviation (an extra
test pinning `GRID_LEVELS` so mutant 6 dies) is an addition, not a removal.

## Style compliance (`javascript/CLAUDE.md`)

- No inline `export` keywords, no `export default`, no `export type {`: only the four
  pre-existing grouped exports show up under `grep -rn "^export"` in `src/`, plus `env.d.ts`'s
  `declare module` block that `scaffold.test.ts` explicitly allows.
- One grouped named export at the end of each new file: `label-layout.ts:476`,
  `label-layer.ts:202`, `label-store.ts:151`.
- No single-quoted strings. Every `'` hit in the three new sources and the three new tests is
  an apostrophe inside prose.
- No unbraced `if`/`else`/loop bodies in any new or changed file.
- No CSS was added or changed, so the one-declaration-per-line rule is not in play.

## Bug hunt

Checked and clean:

- Coordinates. `view.scale`/`x`/`y` are CSS px (`view.ts:5-9`), `mapToScreen`/`screenToMap`
  are exact inverses, and the label block uses the snapped `view` local, not `input.view`
  (`render.ts:184-187`) — the same value the tint, the borders and the hairline use.
- `findInteriorPoint` refinement box is centred on the winning cell: winner centre
  `box.x + (c+0.5)*stepX`, new box `[c-1, c+2)` cells wide, same centre. No off-by-one.
- `chamferDistance` forward/backward neighbour sets are correct and out-of-grid reads return 0.
- Anchor cache keyed on `provinceIds` array identity is sound: `world-store.ts:507-528`
  builds a fresh array for the assigned country AND for every previous owner, and returns the
  same object otherwise. A rename does not touch `provinceIds`, so it costs no recompute.
- `countryLabelSources` gates on `loadPhase.value === "ready"` (`label-store.ts:101`), which
  is both the invalidation subscription for the non-reactive `getMapAssets()` and the guard
  against caching `null` anchors before the bitmap exists.
- `countryContainsPoint` uses `countryOfProvince.peek()` (`label-store.ts:52`) — correct
  inside the computed and inside the rAF callback.
- `provinceAt` floors, rejects non-finite and out-of-range, and returns `null` on unpainted
  pixels, so the back-projected nudge centres are handled.
- `useSignals()` is called in both `Hud` (`MapCanvas.tsx:103`) and `MapCanvas` (`:186`); the
  new `showLabels.value` read is inside `Hud`.
- The `L` keydown listener is removed on unmount (`MapCanvas.tsx:410-413`) and skips
  `INPUT`/`TEXTAREA`/`SELECT`/`contentEditable` and modifier chords.
- No new localStorage key, no schema field, no migration. Anchors are derived only.
- Dead-state leak from `drawCountryLabels` (it does not restore `font`/`fillStyle`/`lineJoin`/
  `miterLimit`) is safe: `prepare` resets the transform every frame and every later drawing
  step sets its own `strokeStyle` and `lineWidth`. The comment at `label-layer.ts:142-146`
  flags the constraint for whoever appends after labels.

Performance:

- Per frame the label path is: N metric-cache hits (N = country count), one sort, and at most
  7 rect trials per candidate. No per-frame work touches 10.4 M pixels or 1648 provinces.
- The only expensive branch, `findInteriorPoint`, costs 1728 `contains` calls and runs on an
  anchor cache miss for a country whose centroid and eight largest province centres are all
  outside. It is not on the frame path.
- `measureText` is called once per distinct name, at 100 px, then scaled; the cache is bounded
  at 256 entries.

## Hard-failure checks

- `../civitas-map` untouched: `git status --porcelain -- .../civitas-map` prints nothing.
- No test weakened or deleted: `render.test.ts` is the only modified test file, and its diff is
  additive — new recorder fields plus two appended `test(...)` blocks. Every prior assertion is
  byte-identical.

## Non-blocking notes

- `README.md` has no `## Country labels` section yet. DESIGN section 1 assigns that to the docs
  agent, not the implementer, so it is not held against this review.
- The fit test is against the country's union bounding box, so a long thin country can pass it
  and let the label overhang into water at its ends. Explicitly out of scope (DESIGN section 11)
  and recorded honestly in `memory.md`.
- `getLastLabelStats()` is one frame stale, and while labels are off the HUD keeps the last
  non-empty counts. It is T07 verification UI that T08 replaces.
