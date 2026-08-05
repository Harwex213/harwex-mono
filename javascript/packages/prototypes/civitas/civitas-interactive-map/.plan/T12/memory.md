# T12 — economics panel and End Turn

## Implementation (attempt 1)

Baseline: HEAD 56a7888, clean tree, no prior T12 work on disk.
Following `.plan/T12/DESIGN.md`. Progress is appended below as each file lands.

### Progress

- [ ] `src/ui/economics-format.ts` + test
- [ ] `src/ui/economics-fields.ts` + test
- [ ] `src/ui/economics-history.ts` + test
- [ ] `src/state/economy-store.ts` + test
- [ ] components + CSS
- [ ] `App.tsx` wiring
- [ ] verification

## Implementation (attempt 2)

Baseline re-verified: `git status --short` carries no T12 file (only the pre-existing
`.yarn/cache` and skill noise from the branch). HEAD is 56a7888. Starting from the
committed baseline, following `.plan/T12/DESIGN.md` file list in order.

### Progress (attempt 2)

- [x] `src/ui/economics-format.ts` + test — 11 pass
- [x] `src/ui/economics-fields.ts` + test — 21 pass
- [x] `src/ui/economics-history.ts` + test — 11 pass
- [x] `src/state/economy-store.ts` + test — 20 pass
- [x] components + CSS — 11 components, `economics.module.css`
- [x] `App.tsx` wiring — `initEconomySync()` beside `initCountrySync()`
- [x] typecheck silent, `yarn test` 861 pass / 0 fail (796 baseline + 65 new)
- [x] browser pass over the DONE conditions — all six verified in the running app

### Files

New, pure logic with tests:

- `src/ui/economics-format.ts` (197) — every number → string. `.` decimal, `,` thousands,
  reusing `groupDigits`; a non-finite value prints `DASH`, never `NaN`.
- `src/ui/economics-format.test.ts` (164) — 13 tests.
- `src/ui/economics-fields.ts` (213) — `fieldAccess` (the tag table), `parseNumberInput`
  (rejects, never clamps), `stepWindow` / `stepWindowText`, the ledger array edits.
- `src/ui/economics-fields.test.ts` (208) — 21 tests.
- `src/ui/economics-history.ts` (224) — `TurnRecord[]` → a readable view, newest first.
- `src/ui/economics-history.test.ts` (198) — 11 tests.
- `src/state/economy-store.ts` (403) — the bridge: hydrate, hold, derive, write through,
  End Turn, judge mode, draft pruning.
- `src/state/economy-store.test.ts` (464) — 20 tests.

New components and CSS:

- `src/ui/EconomyReadout.tsx` (41) — the `[A]` cell. Contains no `<input>` at all.
- `src/ui/EconomyField.tsx` (299) — `NumberField`, `SelectField`, `ToggleField`, `TextField`,
  `errorFor`, `SectionProps`. A locked `[V]` is a `disabled` input.
- `src/ui/EconomySectors.tsx` (271) — areas 1 and 2.
- `src/ui/EconomyStanding.tsx` (194) — areas 3, 4 and 9.
- `src/ui/EconomyBudget.tsx` (286) — areas 5, 7, 8 and the step cap.
- `src/ui/EconomySavings.tsx` (160) — area 6.
- `src/ui/EconomyResources.tsx` (222) — area 10.
- `src/ui/EconomyDebt.tsx` (206) — area 11.
- `src/ui/EconomyFlags.tsx` (368) — area 12.
- `src/ui/EconomyTurn.tsx` (260) — End Turn, pre-flight errors, the turn history.
- `src/ui/economics.module.css` (777) — tokens only, no hardcoded colour/gap/radius/size.

Rewritten:

- `src/ui/EconomicsPanel.tsx` (124) — was the stub. Shell, legend, judge toggle, notices,
  eight sections.

Touched:

- `src/App.tsx` (+5) — `initEconomySync()` installed beside `initCountrySync()`, disposed first.

NOT touched, as the design requires: `src/economy/**`, `src/state/migrations.ts`,
`../civitas-map`. All three verified clean with `git status --porcelain`.

### Three display bugs found and fixed during the browser pass

These were caught by reading the real rendered sheet, not by the unit tests, and all three
would have shipped as numbers that lie:

1. **A drag rendered as a bonus.** `growth.ts`'s `modifierPpOf` SUBTRACTS `inflationGrowthPp`,
   `defenceGrowthPp` and `reservePenaltyPp`, all of which the engine stores as POSITIVE
   magnitudes. Rendering them through `formatSigned` printed `+0.60 pp` for what is a
   0.60 pp cut to growth. Fixed with `formatDrag`, which flips the sign for display only, and
   pinned by two tests — one on the formatter, one that greps `growth.ts` for the three
   subtractions so a later engine change breaks the test instead of the display.
2. **Step-record levels signed as if they were changes.** A step record mixes genuine deltas
   (`Emission -2` rating) with closing levels (`GDP 100,000,000`, `Debt limit 27,038.25 FR`,
   `Coal shortage 100.00%`) and carries no flag telling them apart. A blanket `+` claimed every
   level had just risen by its own value. Step rows and headline levels now print unsigned;
   only `overallGrowthPct`, which is unambiguously a rate, keeps its `+`. The `sign` field
   still drives the colour, so direction is not lost.
3. **`modifierPp` printed as a percentage** rather than percentage points.

### Browser verification, in the running app (`yarn dev`)

Created a country, painted 7 provinces into it, opened Economics.

| DONE condition | Result |
| --- | --- |
| every `[A]` updates as `[P]` changes | committing emission 0 → 4 moved FR generated 10,017.00 → 12,017.00 and the inflation drag 0.00 → -0.60 pp on the same commit |
| `[V]` cannot be edited as a player | 48 `[V]` fields, all `data-locked="true"` and `disabled`; 26 `[P]`, only the enterprise select disabled (correctly, no action pending) |
| `[A]` is never editable | `label[data-tag="A"] input, label[data-tag="A"] select` → **0 elements**, with judge mode both off and on |
| judge mode unlocks `[V]` only | toggling on unlocked 46 of 48; the 2 still disabled are the roll (no action pending) and the concession select (region `none`) — both `blocked` reasons, not tags |
| the step cap blocks an over-large change in the UI | emission committed at 4, window 0..10 (`min="0" max="10"`); typing 30 set `aria-invalid="true"`, showed "outside 0 to 10", and snapped back to 4 on blur. Nothing written |
| End Turn runs the full pipeline with a readable record | two-stage arm ("end turn 1" → "confirm turn 1"); resolved to turn 2, banner "turn 1 resolved. growth was 0.00%, and the rating moved from 70 to 68"; history shows **all 15 steps**, 4 correctly marked "no change", notes rendered ("not a clean turn, so no automatic recovery", "both remainders are now discarded") |
| the whole economy survives a reload | after F5: turn 2, emission 4, rating 68, control 50, all five sector volumes, the turn-1 record, and the step window correctly recentred to 0.00%–14.00% on the new `emissionPctLast` |
| judge mode is not persisted | after reload `data-judge="false"` and all 48 `[V]` locked again — a player cannot inherit a judge's unlocked sheet |

Console: no errors or exceptions at any point.

### Verification — actual output

```
$ yarn typecheck
                                        # silent, exit 0

$ yarn test
ℹ tests 861
ℹ suites 0
ℹ pass 861
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1045.178167

$ yarn tsx --test src/economy/*.test.ts
ℹ tests 203
ℹ pass 203
ℹ fail 0                                # unchanged: T12 changed no engine behaviour

$ yarn tsx --test src/ui/economics-format.test.ts src/ui/economics-fields.test.ts \
    src/ui/economics-history.test.ts src/state/economy-store.test.ts
ℹ tests 65
ℹ pass 65
ℹ fail 0

$ yarn build
WARNING in ⚠ asset size limit: The following asset(s) exceed the recommended size limit (300.000 KiB).
  │ Assets:
  │   assets/map.png (2.530 MiB)
  │   assets/provinces_map.png (552.626 KiB)
  │   assets/provinces_manifest.json (586.891 KiB)
  │   main.39cbfcf7a90d37ef.js (351.423 KiB)
Rspack compiled with 1 warning in 169 ms

$ git status --porcelain -- ../civitas-map src/economy src/state/migrations.ts
                                        # nothing — all three untouched
```

Baseline was 796 tests. 861 now, +65, none edited and none weakened.

**One expected difference from the design's §10.** The design predicted "exactly the
pre-existing asset-size warning on `map.png`, `provinces_map.png` and
`provinces_manifest.json`". `main.js` now joins that list at 351 KiB (minified), because
T12 adds ~3 500 lines of component and CSS code. It is the same single advisory warning,
not an error, and the three asset entries are unchanged. Worth a decision later if bundle
size matters; nothing in T12 can be trimmed to get back under 300 KiB.

### Notes for the next agent

- **The store's `currentEconomy` reads `selectedEconomy.peek()` when the id matches**, rather
  than hydrating a second time. Hydrating again returns an equal but DIFFERENT object, and
  every untouched array inside it loses its identity on the first edit — which re-renders the
  whole 200-field sheet instead of the one row that changed. A test pins the identity.
- **`flushState()` is called in exactly one place**, `endEconomyTurn`. A keystroke never
  flushes. An End Turn that did not reach disk is real data loss, so the outcome banner
  reports `saved: false` immediately rather than 400 ms later.
- **Judge mode is deliberately not persisted.** `civitas.state.v1` gains no key from T12; a
  test asserts the stored document contains no `judge` string.
- **A range input bypasses the 200 ms commit buffer** and writes on every drag event. Only
  two fields use one (`ratingScore`, `controlPosition`), both `[V]`, so it is judge-only. If
  dragging ever feels heavy, that is the reason.
- **Left undone, deliberately:** no `.tsx` unit tests, because there is no jsdom in the
  monorepo (PLAN §4). The four pure modules carry the 65 tests; the components were verified
  by the browser pass above, which is stronger than a snapshot would have been.

## Tests

Regression tests for the panel's pure logic, appended to the three existing test files. No new
file, no `.tsx` test (there is no jsdom), no existing assertion weakened or deleted. Every
expectation is transcribed from `.plan/T11/FORMULA-SPEC.md` and named by section; none of it was
read off a run.

Baseline 861 → **882 pass / 0 fail**, +21. Engine suite still 203. `yarn typecheck` silent.

### 1. The [P]/[V]/[A] classification table — `src/ui/economics-fields.test.ts`, +7 tests

The most valuable test in T12. Spec §18 is transcribed into two tables in the test file:
`STATE_TAGS` (39 `EconomyState` fields) and `NESTED_TAGS` (eight nested shapes, 37 fields), giving
76 tagged paths. Four container fields carry no tag comment in §18 and are tagged by who may change
their MEMBERSHIP, with the clause named in a comment: `sectors` [V] (§4.1 — "creating an Other
sector is [V], not [P]"), `resources` [A] (exactly 8, fixed order), `loans` [A] (§14, the engine
creates and retires one), `concessions` [A] (§15.3, appended at grant).

The tables then drive:

- **every field of a fully populated `EconomyState` must appear in the table** — so a field added
  later WITHOUT a tag fails. The reverse also holds: a tag left behind by a removed field fails.
- **every field of every nested shape** — `deepEqual` on the key sets, both directions.
- **`fieldAccess` over all 76 paths** — [A] never editable in either mode, [V] locked then
  unlocked, [P] editable in both.
- **the tag the panel actually renders**, read out of the eleven `Econom*.tsx` sources. A scanner
  finds each `NumberField` / `SelectField` / `ToggleField` / `TextField` element by balancing `{}`,
  pulls its literal `tag="…"` and the state field its `onCommit` writes, and checks the tag against
  the table. 32 elements, 30 committed field names; the count is pinned so a scanner that silently
  stopped matching cannot pass. **Verified to bite**: flipping `ratingScore` from `tag="V"` to
  `tag="P"` fails with `EconomyStanding.tsx: ratingScore is rendered as [P] but spec 18 says [V]`.
- **no [A] field is rendered as an input** — no element claims `tag="A"`, no committed name maps to
  an [A] path, and `EconomyReadout.tsx`'s body contains no `<input>`, `<select>`, `<textarea>` or
  `contentEditable`.
- **coverage** — every [P]/[V] path is either rendered by the panel or on `PANEL_OMISSIONS`, whose
  nine keys are asserted exactly, each with its reason. A field dropped from the sheet fails unless
  someone adds it here deliberately.
- **the Other-sector creation form is [V]**, per §4.1, even though `sector.name` is [P] to edit
  afterwards. The two form fields are the only two of the 32 that write React state, not the
  document.

### 2. The step cap at the UI layer — same file, +4 tests

Both edges, at three windows and against the engine:

- band index 3 (step 13,00 pp per §7.1) with `emissionPctLast` 20 → window 7,00..33,00, where both
  edges are the step: 7 and 33 accepted, 6,99 and 33,01 refused;
- `militaryPctLast` 55 at the neutral band → 45,00..60,00, where the upper edge is §11's field
  maximum: 60 accepted, 60,01 and 65 refused, 45 accepted, 44,99 refused;
- mobilization (§12) widens the military window from 20..40 to 10..50 and leaves emission alone;
- **the window is exactly V3**, neither looser nor tighter: both edges pass `parseNumberInput` AND
  produce no V3 from `deriveEconomy`, and both edges ± 0,01 fail both. A looser field would accept a
  value End Turn refuses; a tighter one would make a legal move unreachable.

### 3. The turn history formatter — `src/ui/economics-history.test.ts`, +8 tests

Spec §19's Aurelia, turn 4, transcribed field for field, resolved through `resolveTurn`, and every
readable row asserted against §19's own tables: the headline (§19.2, §19.4, §19.10, §19.12–19.16),
resources (§19.3, including that the two fully supplied resources drop their 0,00% rows and leave
the "8 units" carried), income (§19.4, `x1.08` and `x1.20` as factors), borrowing / savings / debt
service / upkeep (§19.6–19.9), spending / auto-investment / growth (§19.10–19.12), GDP and the
rating (§19.13–19.14, `Emission -2` and `Rating next turn 76`), and §19.16's closing table.

**One expectation of mine was wrong and the code was right.** I assumed a resource shortage raises a
warning; spec §17 raises one only at V18, when a sector is starved all the way to 0 growth. Aurelia
is short on six resources and warns about none, which is exactly what §19.2 says ("No errors.
Warnings: V18 fires for no sector"). The test now asserts an empty warning list for Aurelia and
uses the opening sheet — 0 deposits, so sectors are starved to 0 — as the fixture that does raise
V18 and renders it as a code chip plus a sentence.

`["Turn", "5 turns"]` in the commit step is the engine's `turns` unit applied to a turn NUMBER. It
reads oddly. It is pinned rather than changed, because no spec clause dictates it and T12 must not
touch the engine; worth a later ruling.

### 4. Persistence round-trip through a fake storage — `src/state/economy-store.test.ts`, +2 tests

Two countries, an injected `StateStorage` and fake timers, out through `economyToJson` and the T05
writer and back through a fresh `initWorldStore`:

- **the rich one** has two custom Other sectors with grounds and volumes and every remaining field
  of §18 set away from its opening value — all four ledger lists, reserve and stockpile flows, a
  loan with a hand-set `allocatedFr` and auto-service OFF, `debtStatus` `arrears`,
  `defaultLastTurn`, mobilized and unjustified, region `bengo`, a granted concession, a pending
  concession, a pending privatization with a roll, both cooldowns, a timed modifier, both
  privatization drag counters, all eight resources, and a `TurnRecord` in `history` carrying a step
  with a delta and a note (seven container levels — the depth `sanitizeRecord` silently truncates
  at eight);
- **the bare one** has no Other sector and is otherwise the opening sheet.

Both come back `deepEqual` with **`repairs: []`** — a repair would mean the writer and the reader
disagree about the document's own shape. The bare one comes back with exactly five sectors: the
reader inserts a missing BASE sector and must never invent an Other one. The second test proves the
reloaded document still derives, still renders its history (V18 split into a chip and a sentence),
and still resolves a turn.

**Verified to bite**: `economyToJson` → `economyFromJson` is lossless on a populated state, and
deleting one key from the JSON changes the state a deep comparison sees — with `repairs` still
empty, which is why the equality check and not the repair list is the assertion that matters.

### Verification — actual output

```
$ yarn typecheck
                                        # silent, exit 0

$ yarn test
ℹ tests 882
ℹ suites 0
ℹ pass 882
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1045.201916

$ yarn tsx --test src/economy/*.test.ts
ℹ tests 203
ℹ pass 203
ℹ fail 0                                # unchanged: no engine behaviour was touched

$ yarn build
WARNING in ⚠ asset size limit: The following asset(s) exceed the recommended size limit (300.000 KiB).
  │   assets/map.png (2.530 MiB)
  │   assets/provinces_map.png (552.626 KiB)
  │   assets/provinces_manifest.json (586.891 KiB)
  │   main.39cbfcf7a90d37ef.js (351.423 KiB)
Rspack compiled with 1 warning in 99 ms

$ git status --porcelain -- ../civitas-map src/economy src/state/migrations.ts
                                        # nothing — all three untouched
```
