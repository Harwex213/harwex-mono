# T06 review 1 — country model and province assignment

Adversarial review. Every command below was re-run by the reviewer; none of the
implementer's pasted output was trusted.

## Verdict

**Accepted. Zero blocking items.**

## Commands, regenerated

Run from `javascript/packages/prototypes/civitas/civitas-interactive-map`.

| Command | Result |
|---|---|
| `yarn typecheck` | exit 0, no output |
| `yarn test` | `tests 317 / pass 317 / fail 0` |
| `yarn build` | exit 0, one warning block listing the 3 pre-existing oversized assets (`map.png`, `provinces_map.png`, `provinces_manifest.json`) |
| `ls dist` | `84.37e5f932b7b1a078.js` — the border-worker chunk is still a separate emit |

## Brief coverage

| Requirement | Where |
|---|---|
| Country CRUD, colour picker | `src/ui/CountryPanel.tsx:175` (`onNew`), `:76` (rename), `:48` (two-step delete), `:63` (colour) |
| Delete releases provinces | `world-store.deleteCountry`; pinned by `src/state/assign-store.test.ts:181` |
| One owner per province, tested | `src/state/assign-store.test.ts:58` `assertOneOwner` states it as a COUNT, used at `:118`, `:141`, `:178`, `:195` |
| Toggleable assign mode | `src/state/assign-store.ts:39`, toggle at `CountryPanel.tsx:190` |
| Click assigns / reassigns / removes | `src/state/assign-store.ts:60` `strokeActionFor` |
| Drag-to-paint | `src/ui/MapCanvas.tsx:477-499` + `src/map/paint-path.ts:16` line walk |
| Tint over the art, existing overlay | `src/ui/render.ts:127-145` — one extra `drawImage` inside `drawOverlay`; no second on-screen canvas, no second render path |
| Tint reuses the T02 province index | `src/ui/tint-layer.ts:76` `index.provinceAt` |
| Assignment fed to the T04 worker | `src/state/country-store.ts:100` `setCountryAssignment(buildCountryAssignment(max))` |
| Recomputation debounced, not a rescan | `country-store.ts:112` 120 ms fixed window; `borders-store.ts:12-14` keeps the worker alive so a country pass reuses the retained crossings |
| Derived aggregates (count, pixels, union bbox, weighted centroid) | `src/map/country-aggregate.ts:46` |
| Cached, invalidated on assignment change | `country-store.ts:81` `computed`; proven by `country-store.test.ts:110` |
| Aggregates unit tested | `src/map/country-aggregate.test.ts` (9 tests) |

Nothing in the brief is stubbed or silently skipped. Both deviations declared in
`memory.md` (the extracted `buildTintWordTable`, double-click suppression in
assign mode) are justified and neither weakens a requirement.

## Style — `javascript/CLAUDE.md`

- Semicolons: present throughout.
- No single-line `if`/`else`/loop in any new or changed file.
- Double quotes only. The only `'` characters in the T06 files are apostrophes
  inside comments and test titles (`country-aggregate.ts:24`, `tint-layer.ts:58`,
  `assign-store.test.ts:77`, …). No single-quoted string literal.
- One grouped named export at the end of every file:
  `country-aggregate.ts:97`, `paint-path.ts:48`, `tint-layer.ts:232`,
  `country-store.ts:159`, `assign-store.ts:159`, `CountryPanel.tsx:238`,
  `MapCanvas.tsx:645`, `render.ts:172`. No inline `export`, no default export.
  `grep -rn "^export "` over `src/` returns only those grouped lines.
- `src/ui/country-panel.module.css`: one declaration per line, closing brace on
  its own line, throughout.

## Bug hunt — checked and clean

- **Byte order.** `tint-layer.ts:85-88` writes R, G, B, A as four bytes. No
  `Uint32Array` view over the pixel buffer anywhere in the file.
- **Overlapping bounding boxes.** `buildTintPixels` resolves the owner of each
  pixel, not the target province (`tint-layer.ts:76-88`), so a `putImageData`
  tile never erases a neighbour's tint. Pinned by `tint-layer.test.ts:93`.
- **Tint size.** `MapCanvas.tsx:265` passes `mapSize` (3653), never the art's
  3652. `render.test.ts` asserts the source rect comes from `MAP`.
- **Snapping.** `render.ts:128` calls `sourceRect(view, …)` with the already
  snapped `view`, not `input.view`.
- **Smoothing leak.** `render.ts:132` sets `imageSmoothingEnabled`, but
  `drawProvinceHighlight` (`highlight-layer.ts:117`) sets it again before its own
  `drawImage`, so the tint cannot change how a highlight stamp resamples.
- **The `getMapAssets()` notifies-nobody trap.** `maxProvinceId`
  (`country-store.ts:32`) reads `loadPhase.value` first;
  `countryAggregates` (`:84`) and the tint effect (`MapCanvas.tsx:308`) both read
  it too. Hydrated countries therefore tint when the map arrives.
  `map-store.ts:57-61` sets `assets` and `byId` before `loadPhase = "ready"`, so
  the read order is safe.
- **Mass-unassign on mid-stroke delete.** `assign-store.ts:83` keeps the
  `countryById.peek().has()` guard.
- **Stale active id.** `activeCountryId` is a `computed` over `countryById`
  (`assign-store.ts:23`), so it heals to `null` on delete.
- **Effect loops.** The border-push effect (`country-store.ts:124`) reads
  `countryOfProvince`, `borderPhase`, `maxProvinceId` and writes nothing;
  `setCountryAssignment` bumps `countryBorderStats` / `bordersVersion`, neither
  of which the effect reads. The tint effect writes no signal either.
- **`useSignals()`.** Present in `MapCanvas` (`:166`), `Hud` (`:96`) and
  `CountryPanel` (`:97`). `CountryRow` reads no signal, so it correctly omits it.
- **Listeners / observers.** The `Escape` window listener (`CountryPanel.tsx:169`)
  and the colour-debounce timer (`:140`) are both torn down; the arm timer
  (`:150`) is cleared per `armedId`. `disposeTintLayer()` was added to the
  existing `MapCanvas` unmount cleanup (`:324`) and `disposeCountrySync` to
  `App.tsx`'s.
- **localStorage.** No new persistence path, no schema change, no migration. A
  quota failure still lands in T05's warning banner and the in-memory state
  survives.
- **PLAN facts.** Ids 1..1650 over 1648 provinces are handled: an unresolvable id
  is skipped by `aggregateCountry` (`:65`) and recorded-but-not-drawn by
  `syncTintLayer` (`tint-layer.ts:191-195`). Centroid is treated as centre of
  mass and is not rounded.

## Performance — checked

- Per frame the tint costs exactly one `drawImage` of a map-sized offscreen
  canvas inside the existing `drawOverlay`. No per-province stamp loop.
- Per assignment change: `buildTintWordTable` + `anyNonZero` + `diffTintWords`
  are three passes over 1651 entries, then one `putImageData` per *changed*
  province bounding box. No 10.4 M pixel rescan; `tint-layer.ts:172-181` has the
  all-zero fast path for "delete the last country".
- Border recompute is bounded twice: a 120 ms fixed-window debounce
  (`country-store.ts:27`) on top of `borders-store`'s latest-wins coalescing
  (`borders-store.ts:188-197`).
- `extendStroke` batches one `assignProvinces` per pointermove
  (`assign-store.ts:122`), and `samplePathPixels` is capped at
  `MAX_PATH_SAMPLES = 4096`.

## Hard-failure checks

- **`../civitas-map` modified?** No. `git status --short -- ../civitas-map`
  returns nothing.
- **Existing test weakened or deleted?** No. `git diff HEAD --stat` touches
  exactly one test file, `src/ui/render.test.ts`, and the diff is +73 lines of
  two new tests. The T04 assertion
  `"drawOverlay with the T04 fields omitted draws exactly what T03 drew"` is
  unedited and still passes. No other `*.test.ts` appears in the diff.

## Mutation testing — re-run by the reviewer, not taken on trust

`shasum -a 256` taken before and after; all three files restored `OK`.

| Mutant | Applied to | Result |
|---|---|---|
| `aggregateCountry` uses the unweighted mean | `country-aggregate.ts:82` | **KILLED** — 317/316/1 |
| `applyStroke` drops the `countryById.has` guard | `assign-store.ts:83` | **KILLED** — 317/316/1 |
| the border push is not debounced (`schedule()` → direct `pushCountryBorders()`) | `country-store.ts:132` | **KILLED** — 317/315/2 |

The suite genuinely catches the three failures the design named as most likely.

## Non-blocking observations, for the docs agent and T07/T08

1. `README.md:354` still documents `applyDemoCountries` / `clearDemoCountries`,
   which T06 deleted. DESIGN §2.2 assigns the README to the docs agent, so this
   is that agent's item, not a defect in the implementation.
2. `map-canvas.module.css`: `.host[data-mode="assign"]` and
   `.host[data-panning="true"]` have equal specificity and the assign rule comes
   later, so a middle-button pan while assign mode is on keeps `crosshair`
   instead of `grabbing`. Cosmetic only.
3. `samplePathPixels` with fractional inputs where `0 < steps < 0.5` gives
   `Math.round(steps) === 0`, so `t = 0 / 0` and it visits `(NaN, NaN)`.
   Unreachable from the app — `mapPixelAt` (`view-store.ts:149`) floors to
   integers — and `provinceAt` returns `null` for a NaN coordinate
   (`province-index.ts:140`). Latent only.
4. `Escape` turns assign mode off but does not cancel a live stroke; the drag
   keeps painting until pointerup. Minor.
5. `onPointerUp` (`MapCanvas.tsx:545`) ends a paint stroke without checking
   `event.button`, so releasing a second button mid-drag ends the stroke early.
   Minor.
6. Clicking a row's colour swatch does not make that country active — the
   `closest("input, button")` guard at `CountryPanel.tsx:42` returns first. Minor
   UX; T08/T09 restyle this panel anyway.

## Not verified by the reviewer

The DESIGN §12.2 browser checklist. This reviewer did not drive Chrome; the
readings in `memory.md` are the implementer's and were not independently
reproduced. Everything a static and test-level review can reach is clean, and
the build emits a working bundle plus the separate worker chunk.
