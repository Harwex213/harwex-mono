# T08-FIX — review 1 (adversarial)

Reviewer: review agent. Did not write the code. Regenerated every command below.

Verdict: **ACCEPTED. Zero blocking items.**

---

## 1. Commands — real output, run from the package root

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
ℹ duration_ms 570.445916

$ yarn build
WARNING in ⚠ asset size limit: ... assets/map.png (2.530 MiB),
assets/provinces_map.png (552.626 KiB), assets/provinces_manifest.json (586.891 KiB)
Rspack compiled with 1 warning in 82 ms
```

The build warning is the pre-existing asset-size one. 507 = 493 + 14 new. The memory
file's numbers reproduce exactly.

## 2. The brief, item by item

**D1 — the resize ratchet.** Implemented as briefed, no substitution.

- `src/map/view.ts:90` `fittedScale`, `:99` `isFittedScale`, `:120` `resizeView`,
  `:31` `MIN_SCALE`. `clampScale`, `clampView`, `zoomAt`, `fitScale` and `MAX_SCALE`
  are byte-identical; only `fitView` (`src/map/view.ts:105`) was rewritten to reuse
  `fittedScale`, which returns the same number it computed before.
- `src/state/view-store.ts:48` `viewFitted`, derived in `writeView`
  (`src/state/view-store.ts:61-66`) **before** the `sameView` early return at `:68`,
  reading `mapSize.peek()` / `viewport.peek()` at `:57-58`. The trap from the memory
  file is honoured.
- `src/state/view-store.ts:97` branches on `viewFitted.peek()` — fitted re-fits,
  otherwise `resizeView` at `:101`. `resetView`, `panTo`, `zoomAtPoint` all still go
  through `writeView`, so the flag follows with no per-action wiring. Verified: a
  fresh load starts fitted (`view-store.ts:48` initial `true`, and the first-view path
  at `:90` now goes through `writeView`).
- Scale is still clamped: `resizeView` caps at `MAX_SCALE` and floors at `MIN_SCALE`,
  with a `clampScale` fallback for a non-finite or non-positive input
  (`src/map/view.ts:121-128`).

The required regression test exists and drives the exact sequence:
`src/state/view-store.test.ts:380` `"a viewport that grows and shrinks back returns to
the fit scale"` — `HOST` is `1728 x 906` (`:27`), grows to `1400` (`:387`), returns to
`906` (`:398`), and asserts `deepEqual(view.value, fitView(MAP, HOST))`. It also
asserts the intermediate scale is strictly greater than the 906 fit (`:395`), so the
test cannot be satisfied by a "resize never touches the scale" implementation.

**D2 — reachable reset.** `resetView` is imported and called from both
`src/ui/MapCanvas.tsx:51,449` (the `0` key, inside the **existing** keydown effect at
`:436`, no second window listener) and `src/ui/Shell.tsx:10,145` (the `Reset view`
button in `.bar`). `0` collides with neither `l`/`L` nor `Escape`. Documented in
`README.md` under "Keyboard and the reset control" with the full shortcut table.
The HUD gained a `fit yes|no` readout (`src/ui/MapCanvas.tsx:163-168`).

**D3 — label overhang.** Done, behind `probeEnds` (`src/map/label-layout.ts:93`),
default false, forwarded by `layoutCountryLabels` (`src/ui/label-layer.ts:133`) and
turned on by `drawOverlay` (`src/ui/render.ts:195`). The fallback pass
(`src/map/label-layout.ts:502-504`) means the probe can only change which offset wins,
never whether a label is placed. The deviation from the design's "probe always on" is
recorded in the memory file rather than hidden, and **no existing test was weakened to
make it fit** — that is precisely why the flag exists.

Nothing silently skipped or stubbed.

## 3. Hard-failure checks

| Check | Result |
|---|---|
| `civitas-map` modified? | **No.** `git diff` and `git status --porcelain` on that path are both empty. |
| Existing test weakened or deleted? | **No.** `git diff -- 'src/**/*.test.ts'` is additions only, plus one added line in `view-store.test.ts`'s `reset()` helper (`viewFitted.value = true`, `:41`) which strengthens isolation rather than weakening an assertion. No `assert` was changed or removed anywhere. |
| Style (`javascript/CLAUDE.md`) | **Clean.** No single-quoted string literal in any changed file (every `'` hit is an English apostrophe inside a comment or a double-quoted string). No single-line `if`/`for`/`while`. No inline `export` keyword; `view.ts:236-250` and `view-store.ts:202-218` keep one grouped named export at the end. `shell.module.css:88-115` is one declaration per line with a closing brace on its own line, and uses tokens only — all twelve (`--civ-rule-strong`, `--civ-plaque`, `--civ-border-plaque`, `--civ-radius-sm`, `--civ-ink-dim`, `--civ-font-display`, `--civ-text-sm`, `--civ-tracking-caps`, `--civ-space-3`, `--civ-space-5`, `--civ-gild`, `--civ-ink`) are defined in `src/ui/theme.css`. |

## 4. Bug hunt

- **Missing `useSignals()`** — no. `Hud` reads the new `viewFitted.value` and already
  calls `useSignals()` at `src/ui/MapCanvas.tsx:136`. `Shell` calls it at `:29` and
  reads no new signal anyway.
- **Stale closures over signals** — no. The `0` handler calls the module-level
  `resetView`, which reads live signal values through `currentContext()`.
- **Reactive-context violations** — `writeView` reads `mapSize` and `viewport` with
  `.peek()` and is only ever reached from DOM handlers or plain `useEffect`s.
  `syncView` is called from `useEffect(..., [phase])` (`src/ui/MapCanvas.tsx:399-401`)
  and from `setViewport`, never from a `useSignalEffect`. The store rule holds.
- **Leaked listeners** — no new listener. The single keydown effect
  (`src/ui/MapCanvas.tsx:436-456`) still removes itself in its cleanup.
- **Unbounded re-renders** — `writeView` only assigns `viewFitted` when the boolean
  actually flips (`src/state/view-store.ts:63`), so a `ResizeObserver` flurry or a
  wheel held at the cap notifies nothing extra.
- **localStorage / quota / downscaling** — untouched. No new persisted field, no new
  key, no migration, no image path in this change.
- **Coordinate off-by-ones** — the end probe back-projects the ends of the *text span*,
  not the padded box (`src/map/label-layout.ts:400-408`), which is the right span:
  the padding is casing and is allowed to overhang. Pan invariance holds and is pinned
  by a new test.

## 5. Performance

Nothing proportional to 1648 provinces or 10.4M pixels was added.

- The resize path is O(1) arithmetic.
- The end probe adds at most 2 `contains` calls per offset trial and at most one extra
  7-trial pass per label, i.e. ≤ 28 predicate calls per label per overlay draw against
  ≤ 7 before. `countryContainsPoint` (`src/state/label-store.ts:47`) is one
  `provinceAt` lookup plus one `Map.get`, both O(1), and countries number in the tens.
- No list rendering was added, so the un-virtualised-1648-rows failure mode does not
  apply here.

## 6. Non-blocking notes (recorded, no action required)

1. `README.md` and the design both claim the probe means "`placed` in the HUD cannot go
   down". Strictly, moving label A to a different offset can occupy space that later
   blocks label B in the greedy pass, so the placed count is not formally monotonic. The
   probe still cannot cost *the probed label* its own placement, which is the property
   that matters, and D3 is cosmetic and best-effort. Documentation overstatement only.
2. `writeView` reads `viewFitted.value` rather than `.peek()` at
   `src/state/view-store.ts:63`. Harmless today — `writeView` never runs in a tracking
   context, and it already read `view.value` at `:67` before this change — but `.peek()`
   would match the comment two lines above it.
3. `.plan/PLAN.md` and `.plan/T08/memory.md` show uncommitted modifications. They are
   pre-existing (T11 source material and the T08 handoff), not part of this task's file
   list, and contain no code.

## 7. Blocking items

None.
