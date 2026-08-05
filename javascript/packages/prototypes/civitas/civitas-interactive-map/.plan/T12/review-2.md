# T12 review 2 — adversarial

Verdict: **ACCEPTED. Zero blocking items.**

Reviewed the uncommitted T12 work on disk against `.plan/T12/DESIGN.md`,
`.plan/T11/FORMULA-SPEC.md` and `javascript/CLAUDE.md`. Output below was regenerated,
not taken from `memory.md`.

## Commands — real output

Run from `javascript/packages/prototypes/civitas/civitas-interactive-map`.

| command | exit | result |
| --- | --- | --- |
| `yarn typecheck` | 0 | silent |
| `yarn test` | 0 | `tests 861 / pass 861 / fail 0` |
| `yarn build` | 0 | 1 pre-existing asset-size advisory |

Baseline was 796. 861 now, +65 new, none edited and none weakened
(`git diff --stat -- '*.test.ts' '*.test.tsx'` is empty).

Supporting runs:

- `yarn tsx --test src/economy/purity.test.ts` → 5 pass. Engine purity intact.
- `yarn tsx --test` on the four new pure modules → 65 pass.

The build warning now lists `main.js` at 351 KiB alongside the three pre-existing
assets. It is the same single advisory, not an error, and it is the expected cost of
~3 500 new lines. Not a defect.

## 1. The tag table — walked field by field

Every `[P]`/`[V]`/`[A]` classification matches the spec. Zero mismatches.

| field | spec tag | spec line | impl tag | impl |
| --- | --- | --- | --- | --- |
| `sector.name` (other) | P | 406, 1926 | P | `EconomySectors.tsx:115` |
| `sector.grounds` | V | 407, 1927 | V | `EconomySectors.tsx:227` |
| `sector.gdpObor` | V | 402, 1928 | V | `EconomySectors.tsx:131` |
| `sector.growthPermanentPct` | V | 403 | V | `EconomySectors.tsx:145` |
| `sector.growthTemporaryPct` | V | 404 | V | `EconomySectors.tsx:159` |
| `ratingScore` | V | 653 | V | `EconomyStanding.tsx:48` |
| `controlPosition` | V | 722 | V | `EconomyStanding.tsx:129` |
| `emissionPct` | P | 931, 1081 | P | `EconomyBudget.tsx:145` |
| `militaryPct` | P | 931, 1111 | P | `EconomyBudget.tsx:160` |
| 4 ledgers, `label` + `points` | P | 932–935 | P | `EconomyBudget.tsx:50,62` |
| `reserveAdd` / `reserveWithdraw` | P | 1045 | P | `EconomySavings.tsx:47,69` |
| `micStockAdd` / `micStockWithdraw` | P | 1048 | P | `EconomySavings.tsx:106,120` |
| `deposits` | V | 1319 | V | `EconomyResources.tsx:103` |
| `extractionBonusPct` | V | 1320 | V | `EconomyResources.tsx:117` |
| `blockadePct` | V | 1323 | V | `EconomyResources.tsx:131` |
| `importsRequested` | P | 1322 | P | `EconomyResources.tsx:144` |
| `exports` | P | 1322 | P | `EconomyResources.tsx:157` |
| `borrowRequest` | P | 1475 | P | `EconomyDebt.tsx:87` |
| `debtAutoService` | P | 1477 | P | `EconomyDebt.tsx:99` |
| `loans[].allocatedFr` | P only with auto-service off | 1476, 1950 | P, gated | `EconomyDebt.tsx:151-166` |
| `mobilized` | V | 1704 | V | `EconomyFlags.tsx:105` |
| `mobilizationJustified` | V | 1704 | V | `EconomyFlags.tsx:117` |
| `region` | V | 1705 | V | `EconomyFlags.tsx:154` |
| `pendingAction.kind` | P | 1706 | P | `EconomyFlags.tsx:172` |
| `pendingAction.enterprise` | P | 1706 | P | `EconomyFlags.tsx:202` |
| `pendingAction.roll` | V | 1707 | V | `EconomyFlags.tsx:221` |
| `pendingConcession.sectorKey` | V | 1708 | V | `EconomyFlags.tsx:261` |
| `concessions[].active` | V | 1709 | V | `EconomyFlags.tsx:309` |

**`[A]` can never be editable**, enforced three ways:

1. `FieldShellProps.tag: Exclude<FieldTag, "A">` — `EconomyField.tsx:35`. A `tag="A"`
   input does not typecheck.
2. `fieldAccess("A", judge)` returns `auto` in **both** modes —
   `economics-fields.ts:31-33`.
3. `EconomyReadout.tsx` contains no `<input>`, `<select>` or `contentEditable`. I
   grepped every component: the only raw `<input>` outside `EconomyField.tsx` is the
   judge toggle itself, `EconomicsPanel.tsx:101`.

**A `[V]` cannot be edited as a player.** `fieldAccess("V", false)` →
`{ editable: false, locked: true }` (`economics-fields.ts:34-36`), and all four field
kinds render `disabled={!access.editable || isBlocked(...)}` —
`EconomyField.tsx:105,183,220,250`. The `withRange` slider honours the same `disabled`
(`EconomyField.tsx:155`). A disabled input cannot be focused, typed, pasted or dropped
on. Judge-only buttons are gated too: remove-sector `EconomySectors.tsx:178`,
add-sector `EconomySectors.tsx:235`.

## 2. The step cap

Enforced in the UI, and it surfaces rather than clamps.

- `stepWindow(state.emissionPctLast, derived.emissionStepLimitPp, MIN, MAX)` becomes the
  field's `spec.min`/`spec.max` — `EconomyBudget.tsx:106-130`.
- `parseNumberInput` **rejects** out-of-range and never clamps —
  `economics-fields.ts:93-95`, with the reasoning stated at `:68-71`.
- A rejected commit writes nothing and the field snaps back —
  `EconomyField.tsx:110-116`.
- The anchor and limit match the engine exactly: `validate.ts:142-160` uses
  `Math.abs(emissionPct - emissionPctLast) > derived.emissionStepLimitPp`, the same two
  inputs the UI window uses. The UI window can therefore never be looser than V3/V4.
- The engine's error is surfaced, not swallowed: `errorFor(derived, "emissionPct")`
  feeds `props.error` (`EconomyBudget.tsx:140`), which covers the case no keystroke can
  catch — a judge narrowing the window under an already-committed value. It is also
  listed pre-flight in `EconomyTurn.tsx:65-79`.
- The current step and what it allows are always visible: `stepWindowText`
  (`economics-fields.ts:125-129`) as the field hint, plus the derived readouts at
  `EconomyStanding.tsx:147-158` and the eleven-band strip at `:163-181`.

## 3. End Turn and the history

- `EconomyTurn.tsx:114` calls `endEconomyTurn`, which calls `resolveTurn`
  (`economy-store.ts:310`). No pipeline logic in the UI.
- Failure writes nothing (`economy-store.ts:312-317`); success commits then
  `flushState()` immediately so a quota loss is reported now, not 400 ms later
  (`:319-331`).
- **No formula is reimplemented in the UI.** I grepped every component for arithmetic.
  Ledger totals use the engine's `sumLines` (`EconomyBudget.tsx:8,40`). The band strips
  call the engine's own `controlGrowthPpOf`, `controlFrMultiplierOf`, `stepLimitPpOf`,
  `ratingFactorOf` (`EconomyStanding.tsx:4-10`). The only expressions found are
  `Math.max(0, derived.newLoanAvailable)` as a spec bound (`EconomyDebt.tsx:44`), a
  cooldown countdown for prose (`EconomyFlags.tsx:71`), and
  `1 - PRIV_DRAG_PCT / 100` inside a hint string (`EconomyFlags.tsx:242`). None
  produces a displayed `[A]` value; the last one is a constant conversion the engine
  never exposes on `DerivedEconomy` (it is a local in `generation.ts:89`), so it cannot
  drift and there is nothing to read instead.
- The history renders what the record actually contains: `buildHistoryTurn` reads only
  `record.steps[].deltas`, `.notes`, `record.warnings` and the record's own closing
  scalars (`economics-history.ts:159-203`). A test pins that all fifteen `STEP_NAMES`
  have a title, so no step can render nameless.

## 4. Engine purity preserved

- `git status --porcelain -- src/economy src/state/migrations.ts ../civitas-map` is
  **empty**. Nothing touched.
- `purity.test.ts` passes: 5/5, including "the only import from outside src/economy is
  a type-only one".
- No UI concern was pushed into the engine to ease wiring. The bridge lives entirely in
  `src/state/economy-store.ts`.

## 5. Persistence

- Round trip verified by a real test with an injected memory storage and a fresh
  `initWorldStore` standing in for a reload — `economy-store.test.ts:176-207`.
- Writes are **not** per-keystroke: inputs buffer 200 ms in `useFieldCommit`, then
  `setCountryEconomics` → `markDirty` → the T05 writer's `DEBOUNCE_MS = 400`
  (`persistence.ts:25`). `flushState()` is called in exactly one place, `endEconomyTurn`
  (`economy-store.ts:320`); a keystroke never flushes.
- A quota failure is visible and non-fatal: `saveNoticeFor(warning, false)` returns the
  quota error text (`country-overview.ts:83-96`) and renders at the top of the panel
  body (`EconomicsPanel.tsx:59,69-73`). The in-memory state stands. End Turn reports
  `saved: false` in its own banner (`EconomyTurn.tsx:140-145`), tested at
  `economy-store.test.ts:404`.

## 6. Real bugs — none found

- **`useSignals()` coverage is exact.** I counted signal reads against calls per file:
  `EconomicsPanel` 5/1, `EconomyField` 4/4, `EconomySectors` 1/1, `EconomyTurn` 2/1.
  Every other section reads **zero** signals and correctly omits the hook.
- **No stale closures over signals.** Every handler goes through
  `updateEconomy(id, current => …)`, which reads state via `.peek()` at call time
  (`economy-store.ts:140-150,178-180`).
- **No unbounded re-render.** No signal is written during render; hydration is a pure
  function inside a `computed` (`economy-store.ts:98-110`). Once a draft exists the
  computed stops subscribing to `economics`, so another country's save cannot re-trigger
  this one.
- **No full re-derive per keystroke.** `deriveEconomy` runs once per *committed* change
  inside a memoising `computed` (`:117-125`), not per readout and not per keystroke.
- **No leaked listeners.** The End Turn arm timer is cleared on unmount and on a
  country change (`EconomyTurn.tsx:43-54`); `initEconomySync`'s disposer is returned and
  called in `App.tsx`'s cleanup.
- Two pending buffered commits cannot race: only the focused input can hold a draft, and
  moving focus blurs and commits it first.

## 7. No incompleteness from the dead agent

- All 20 design files exist; nothing beyond the design's list was created.
- No `TODO`, `FIXME`, `XXX`, `console.*`, `debugger` or `alert` anywhere in the T12 files.
- No handler wired to nothing. Every one of the 71 `styles.*` classes used resolves to a
  real rule in `economics.module.css` — no component renders unstyled. (`.empty` is
  defined and unused; harmless dead CSS.)
- The panel is genuinely reachable: `PanelHost.tsx:21-22` mounts it, `Shell.tsx:25`
  offers the tab, `panel-store.ts:10` carries the id.
- All 12 spec areas have UI. Of 87 `DerivedEconomy` fields, 82 are rendered; the 5 that
  are not — `concessionGranted`, `concessionSectorKey`, `createdLoan`,
  `micStockEndPreUpkeep`, `defaultLastTurnNext` — are engine intermediates and previews,
  none of them a field the spec's tag tables require on the sheet, and each has its
  committed counterpart shown (`concessions[]`, `newLoanProceeds`, `micStockEnd`,
  `debtStatusNext`).
- `App.tsx` wiring is present and disposed first (`git diff -- src/App.tsx`).

## 8. Style compliance with `javascript/CLAUDE.md`

- Semicolons: present. Typecheck clean.
- No single-line `if`/`else`/loop bodies.
- No single-quoted string literals. Every `'` found is inside prose or a comment.
- Exactly one grouped named export at the end of all 15 non-test files; zero inline
  `export` keywords, zero default exports.
- CSS: one declaration per line throughout `economics.module.css` (777 lines); zero
  hardcoded colours — no hex, `rgb()` or `hsl()` anywhere. The only bare lengths are
  structural (`1px` borders, `minmax()` track floors, `min-width`), not colour, gap,
  radius or font size.

## 9. No scope violation, no weakened test

- `civitas-map`: untouched (`git status --porcelain -- ../civitas-map` empty).
- `src/economy/`, `src/state/migrations.ts`: untouched.
- `git diff --stat -- '*.test.ts' '*.test.tsx'`: empty. No existing test edited,
  weakened or deleted. 796 → 861 is purely additive.

## Non-blocking observations, for the record

1. `OBOR_SPEC` uses `integer: false` (`EconomySectors.tsx:27`) while spec line 402 says
   "whole obor". The engine only requires non-negative (`validate.ts:42`), so a fractional
   volume creates no invalid state. Cosmetic.
2. `grounds` for an *existing* Other sector is displayed but not editable
   (`EconomySectors.tsx:260`), as is `concessions[].sectorKey`
   (`EconomyFlags.tsx:302`). Both are `[V]` in the spec. The design deliberately scoped
   editing to the creation control and to `active`; a non-editable `[V]` is not the
   failure mode the brief guards against.
3. `EconomyStanding.tsx:115` uses `.toFixed(2)` directly instead of the
   `economics-format` helpers for two tier-table figures. Harmless inconsistency.
4. `privatizationFrDrag` / `privatizationMicDrag` are `[A]` at spec line 1714 but are
   locals in `generation.ts:89-91` and never reach `DerivedEconomy`. T12 cannot render
   them without touching the frozen engine. This is a T11-B gap, not a T12 one.
