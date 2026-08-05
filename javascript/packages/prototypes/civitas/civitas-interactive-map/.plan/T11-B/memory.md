# T11-B — think agent handoff

Design: `.plan/T11-B/DESIGN.md`. Authority: `.plan/T11/FORMULA-SPEC.md`. No code was written.

## The spec is arithmetically correct — do not change it

I recomputed §19 end to end at double precision from the spec's formulas alone. Every published
number reproduces exactly: `frCore` 13 363,197826, the balance 14 983,197826 → 12 763,197826 →
12 663,197826, `modifierPp` −0,9028665114, all six `finalPct`, the total 107 795 555 against the
unrounded 107 795 555,0249, `ratingNext` 76. §21.1's standard start also reproduces:
10 017,00 / 233,20 / 22 538,25. **No spec fix was needed. Implement it literally.**

## Shape

`src/economy/`, 18 files, nothing outside it touched: `types`, `constants` (the one retuning
surface), `num`, nine stage modules (`resources`, `generation`, `actions`, `debt`, `savings`,
`growth`, `gdp`, `rating`, `control`), `validate`, `derive`, `pipeline`, `history`, `economy-state`,
`serialize`. No barrel — the package has none. Entry points `deriveEconomy(state, context?)` and
`resolveTurn(state, context?)`, both pure. `resolveTurn` calls `deriveEconomy` once as step 1, then
folds a draft over `TURN_STEPS`, an ordered array of 15 named step descriptors. **A test asserts the
15 names deep-equal the spec's order** — that is the defence of the load-bearing ordering.

## The six additions to the spec, each forced (DESIGN §12 has the reasons)

1. `context = { provinceCount }`, optional, default 0 — §15.3 needs the count, the engine may not
   read a store, and 0 is exactly guard G6.
2. Eleven extra [A] fields on `DerivedEconomy` (payouts, `loanService[]`, `createdLoan`,
   `frTaxBase`, the availability booleans): §16.2 forbids steps from recomputing.
3. A loan whose `principalNext` rounds to 0 leaves `loans[]`.
4. `economyToJson` / `economyFromJson`, the reader repairing and never throwing.
5. `createInitialEconomy()` starts with 0 deposits and `militaryPct` 10, so a fresh country sits in
   a full shortage until a judge sets its geology. Correct, not a bug.
6. Warning strings carry their V-code as a prefix (`"V17: …"`).

## Traps

- **`sanitizeRecord` DROPS a `NaN`/`Infinity`/`undefined` key** — the field vanishes from the saved
  document. `finiteOr` on every written number, `null` for absent, no `Map`, no `Set`. Write every
  range check negated (`!(x >= 0 && x <= MAX)`) so `NaN` fails it.
- **`privatizationFrDrag` reads the INCOMING counter.** A drag armed at step 4 does not apply this
  turn; step 14 takes 3 → 2 and it bites on the next three turns. §19.5 pins it.
- **A timed modifier created at step 4 IS decremented at step 14**, 2 → 1, so it covers this turn
  and the next. A loan with `createdTurn === state.turn` is skipped entirely at step 7.
- **The reserve addition is charged at step 6, before debt service.** §19.8 is
  `min(2 220, 14 983,20)`, not 15 483,20. Getting this wrong moves every later number. V7 tests the
  incoming `state.debtStatus`, so a country clears `default` this turn and borrows next.
- `gdpNextTotalObor` is the sum of the rounded sectors. Assert volumes within **1 obor**, never by equality. `roundTo` is symmetric half-up on the magnitude (`−0,125 → −0,13`).

## The clean-turn fixture (§6.2a positive branch) — computed, use these numbers

Standard start, turn 1, five sectors at 20 000 000 and 3,00 perm growth, rating 70, control 50,
emission 0, military 10, no loans, no reserve, no stock, no ledger lines, deposits 2 for coal and
chemical and 1 for the rest. Expect 10 017,00 / 233,20, `investedObor` 31 694 000,
`autoInvestGrowthPp` and `modifierPp` 0,63388, every `finalPct` 3,63388, every `gdpNextObor`
20 726 776, total 103 633 880, `cleanTurn` true, `ratingNext` 71.

## Verify

`yarn typecheck`; `yarn test` (593 pass today, all must still pass); `yarn tsx --test src/economy/fixture.test.ts`; and `purity.test.ts`, which scans the directory for react, signals, DOM, `Math.random` and `Date`.

---

## Implementation (attempt 1)

The engine is in `src/economy/`, 18 source files and 17 test files. **Nothing outside
`src/economy/` was created or modified.** The spec was implemented literally; **no spec fix was
needed** — §19 and the §21.1 standard start both reproduce to the last bit.

### Files added — one line each

| File | What it is |
| --- | --- |
| `types.ts` | Every shape in spec §18, plus the ten stage-result types and `EconomyContext` / `TurnResolution` / `TurnStep`. No runtime code. |
| `constants.ts` | `ECONOMY_CONSTANTS` (every scalar in §2) plus the rating tiers, the 11 control bands, the per-tier debt table, the §13.2 matrix and its **computed** inversion, and the resource weights. |
| `num.ts` | `roundTo` (symmetric half-up on the magnitude), `clamp`, `finiteOr`, `safeDivide`, `isNonNegativeNumber`, `isIntegerInRange`, `sumOf`. |
| `control.ts` | Band index, name, and the three generated effects. All three return the neutral value at `i = 5` by construction. |
| `rating.ts` | Tier lookup, `ratingFactor`, `debtTermsOf`, `emissionRatingPenaltyOf`, `isCleanTurn` (§6.2a) and the step-13 stage. |
| `resources.ts` | Step 2: needs, extraction, blockaded imports, clipped exports, supply, coverage, shortage, free, next stock, the per-sector penalty. |
| `generation.ts` | Step 3: shares, `plannedGrowthPct`, control/rating factors, `frGenerated`, `micGenerated`, the emission and defence terms, both step limits. |
| `actions.ts` | Step 4: nationalization / privatization resolution, availability, and the concession grant. |
| `debt.ts` | Step 5 borrowing and step 7 servicing, the shortfall penalty and the three-state machine. |
| `savings.ts` | Step 6 reserve and stockpile, step 8 upkeep, step 10 auto-investment. |
| `growth.ts` | Step 11: the modifier sum, pre-shortage and final growth, the GDP-weighted overall rate. |
| `gdp.ts` | Step 12: next-turn volumes, the concession cost booking, the summed total and the change. |
| `validate.ts` | V1–V13 as errors. V14–V20 are raised by the stage that owns them. |
| `derive.ts` | `deriveEconomy` — the read-only form of steps 2–13, threading the §8.4a running balance. Total, never throws. |
| `pipeline.ts` | `resolveTurn` — `TURN_STEPS` as data, the draft fold, the next state. |
| `history.ts` | `TurnRecord` assembly, per-unit stored precision, the 12-turn trim. |
| `economy-state.ts` | `createInitialEconomy`, `createSector`, `createResourceState`. |
| `serialize.ts` | `economyToJson` / repairing `economyFromJson`. Its `import type { JsonRecord, JsonValue } from "../state/schema"` is the only import that leaves the directory, and it is type-only. |

Tests: `fixture.test.ts` (§19 table by table), `clean-turn.test.ts` (§6.2a positive branch),
`purity.test.ts`, plus one per source file except `types.ts` and `derive.ts`.

### Deviations from DESIGN, and why

- **Four more [A] fields on `DerivedEconomy` than DESIGN §3.3's eleven**: `frCore`,
  `debtAllocatedTotal`, `investedObor`, `micStockEndPreUpkeep`, `defaultLastTurnNext`. Same reason as
  ADDITION 2 — §16.2 forbids a step from recomputing, and the step records and the commit need them.
  No formula added.
- **V7 fires only when `borrowRequest > 0`.** §17 lists "tier ≠ F, and status ≠ default" without a
  guard; taken literally, every tier-F country could never end a turn. A non-finite `borrowRequest`
  still errors.
- **`micPointsPaidFor` is floored at 0** in `deriveUpkeepStage`. Only reachable when a manual
  over-allocation at step 7 left the balance negative; without the floor the loss would exceed the
  stock and drive it negative, against G12.
- **An unavailable action or a malformed roll resolves nothing** at step 4. V8/V9 abort the turn on
  exactly those inputs, so this only shapes T12's live preview.
- **`purity.test.ts` excludes itself from the token scan** — it necessarily contains the strings it
  forbids, so the banned tokens are assembled from pieces and test files are exempt from that one
  scan.

### Verification — real output, run from the package root

```
$ yarn typecheck
typecheck exit: 0            # tsc --noEmit prints nothing on success

$ yarn test
ℹ tests 761
ℹ suites 0
ℹ pass 761
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 862.984917
                             # 593 existing + 168 new. Zero regressions.

$ yarn tsx --test src/economy/fixture.test.ts
✔ 19.2 — step 1 derives and validates with no errors
✔ 19.3 — step 2 resources: eight rows and six sector penalties
✔ 19.4 — step 3 generation
✔ 19.5 — step 4 actions: privatization succeeds on a roll of 7
✔ 19.6 — step 5 borrowing
✔ 19.7 — step 6 savings, and the reserve charged before debt service
✔ 19.8 — step 7 debt service against frBalance6, not gross income
✔ 19.9 — step 8 upkeep is paid in full
✔ 19.10 — step 9 spending, and the running-balance identity
✔ 19.11 — step 10 auto-investment
✔ 19.12 — step 11 growth
✔ 19.13 — step 12 GDP, per-sector within 1 obor and a summed total
✔ 19.14 — step 13 rating, and the clean-turn predicate's negative branch
✔ 19.15 and 19.16 — flags and commit
✔ the fifteen step records are produced in the spec's order
ℹ tests 15
ℹ pass 15
ℹ fail 0

$ yarn build
Rspack compiled with 1 warning in 82 ms
                             # the warning is the pre-existing asset-size one on
                             # map.png / provinces_map.png / provinces_manifest.json

$ grep -rnE "react|signals|document\.|window\.|localStorage|Math\.random|Date\.now|new Date" \
    src/economy --include="*.ts" | grep -v "\.test\.ts"
                             # prints nothing (exit 1)
```

### Numbers the fixtures pin

- §19 Aurelia: `frCore` 13 363,197826; `frGenerated` 15 483,197826; `micGenerated` 307,933585;
  balance 14 983,197826 → 12 763,197826 → 12 663,197826; `frRemainder` 10 163,197826;
  `autoInvestGrowthPp` 0,5702466962; `modifierPp` −0,9028665114; all six `finalPct`;
  `gdpNextTotalObor` 107 795 555; `ratingNext` 76; `controlPosition` 47.
- Clean turn / standard start: 10 017,00 / 233,20 / `reserveCap` 20 034,00 / `debtLimit` 22 538,25 /
  `investedObor` 31 694 000 / `autoInvestGrowthPp` 0,63388 / every `finalPct` 3,63388 / every
  `gdpNextObor` 20 726 776 / total 103 633 880 / `cleanTurn` true / `ratingNext` 71.

### Deliberately left undone

- **T12's panel**, all of it: rendering, the [P]/[V]/[A] editability split, the judge affordance, the
  End Turn control, the history view, and every bit of number formatting. The engine returns numbers.
- **Any store or signal wiring.** `setCountryEconomics` already exists; T12 calls it with
  `economyToJson(result.next)` and reads back with `economyFromJson`.
- **A migration.** `ECONOMY_SCHEMA_VERSION` is 1 and there is no earlier economy document, so
  `src/state/migrations.ts` is untouched.
- **`src/ui/EconomicsPanel.tsx`** is still the T11 stub. T12 replaces it.

---

## Tests

Four new files in `src/economy/`, **35 new tests, all passing**. Nothing existing was weakened,
deleted or edited — the 761 tests that were there still run unchanged. **No source file was
touched.** Every expectation below was computed by hand from `.plan/T11/FORMULA-SPEC.md` before the
run; **all 35 passed on the first execution, so the code and the spec agree and no code fix was
needed.**

| File | What it pins |
| --- | --- |
| `fixture-detail.test.ts` | The §19 intermediates `fixture.test.ts` leaves implicit: 10 tests |
| `boundaries.test.ts` | Both edges of all 7 rating tiers and all 11 control bands, swept through the whole engine: 6 tests |
| `guards.test.ts` | §20's guards reached through a real state, plus the §6.2a exclusions end to end: 12 tests |
| `determinism.test.ts` | Same input → same output, and the input is never written: 7 tests |

### What each file adds that was not already covered

**`fixture-detail.test.ts` — the working behind §19, not just its headline.** `fixture.test.ts`
walks the fifteen steps and pins one number per table. This file pins the columns behind them:
`extractionUnits` / `importUnits` / `onHandUnits` / `exportsAppliedUnits` for all eight resources
(50 per deposit, imports in full with no blockade, on-hand = supply with no exports); all six sector
shares and their sum of exactly 1; `plannedGrowthPct` as the exact fraction 320/106; the emission
block at 4,00% (`inflationPct` 6,00, penalty 2, and `frGenerated − frCore = 2 120` proving emission
is additive); tier B's own `newLoanRatePct` 12 and `newLoanTermTurns` 6; the interest/principal
split 720 + 1 500 inside the 2 220 allocated; `micPointsPaidFor` 6 381 from `deriveUpkeepStage(50,
12 763,197826)`; the `basePct` and `preShortagePct` columns of §19.12 against the hand-summed
`modifierPp` −0,9028665114, with `finalPct === preShortage × (1 − penalty)` asserted structurally;
§19.13's per-sector **change** column (+497 720 … +245 828) summing to `gdpChangeObor` 1 795 555; and
the closing `TurnRecord` — 1,6939 / 15 483,20 / 10 163,20 / 307,93 / 197,93 / 78 → 76 / 44 → 47.

**`boundaries.test.ts` — the contiguous scales, read through `deriveEconomy`.** `rating.test.ts` and
`control.test.ts` check the lookup functions; this checks the wiring, which is where an off-by-one
would actually bite. All 14 tier edges (0, 9, 10, 29, 30, 49, 50, 69, 70, 84, 85, 94, 95, 100) assert
tier, `ratingFactor` = 1 + 0,01 × (score − 70), `frGenerated` = 10 017,00 × factor, `debtLimit` =
multiple × that, plus the rate and term of §2.9's row and `reserveCap` = 2 × income. All 21 band
edges (0, 5, 6, 20, 21, 30, 31, 44, 45, 49, 50, 51, 55, 56, 69, 70, 79, 80, 94, 95, 100) assert the
band index, `controlGrowthPp`, `controlFrMultiplier`, both step limits, `frGenerated` = 10 017,00 ×
multiplier, and `micGenerated` = 233,20 **at every band**, which is what pins §7.1's INVENTED
omission — the control scale never touches MIC. Two "a boundary is a step" tests (69 vs 70, and 49 vs
50 vs 51) and both lockout bands at both their edges.

**Verified to bite:** temporarily moving tier B's floor from 70 to 71 in `constants.ts` fails
`boundaries.test.ts` with `actual: 'F', expected: 'B'` at score 70. The file was restored.

**`guards.test.ts` — §20 reached the way a player reaches it.** G9 twice: a fresh country's total
shortage zeroes all five sectors at exactly 0 (volumes stand still, `gdpChangeObor` 0, five V18
warnings, no error), and the same shortage against −2,00 permanent growth leaves `finalPct` **equal
to** `preShortagePct` at −1,42592 — the shortage cannot deepen a contraction by even a hundredth.
G10 at both ends: 5 − 20 (a 50% emission) clamps to 0, a clean turn at 99 reaches exactly 100, and at
100 the recovery is still earned and the clamp absorbs it. The divide-by-zero family in one state: a
country with every sector at 0 obor gives `plannedGrowthPct` / `overallGrowthPct` /
`autoInvestGrowthPp` / `reservePenaltyPp` / `debtLimit` / `reserveCap` all 0, `coverage` 1 and
`shortage` 0 on all eight resources (G2), `debtRatingPenalty` 0 with no loan (G5), every number
finite, and the turn still resolves. Plus G6 (`provinceCount` 0 → a free concession, bonus still
+1,50) and G4 (a matured loan divides by 1 and demands interest plus the whole principal). G27 gets
its own two tests: `emissionPct` 10,01 against a 10,00 band step yields **exactly** `["V3"]`,
`resolveTurn` returns `ok: false`, the state deep-equals its snapshot afterwards and still reads
10,01 — rejected, never clamped — while 10,00 resolves; and the limit follows the band (13,00 at
position 44) with mobilization widening the military step to 20,00 and the emission step not at all.

**The §6.2a exclusions, end to end.** `rating.test.ts` tests `isCleanTurn` and `clean-turn.test.ts`
tests the positive branch; the three exclusions are now each driven through `deriveEconomy` with the
other two clauses **asserted to hold**, so each test isolates one clause:

- emission 4,00% → `cleanTurn` false, recovery 0, `ratingNext` 68 (70 − 2, with no +1 to soften it);
- a starved loan (`reserveAdd` 9 000 charged at step 6 against a 10 017,00 income, a 22 400,00
  payment due) → shortfall 21 383, penalty the full 10, `ratingNext` 60, while `emissionPct` is 0 and
  growth is +2,6932%. Every number of that path is pinned: `frBalance6` 1 017, `frRemainder` 0,
  `reservePenaltyPp` 0,54, `modifierPp` −0,3068, `gdpNextTotalObor` 102 693 200;
- growth −0,41396% (every sector at −1,00 permanent) → no recovery **and no penalty**, `ratingNext`
  stays 70; and exactly 0 growth fails too, via the fresh country's zeroed sectors.

Plus the addition rule: a clean turn that also nationalises keeps **both** lines and lands on 67.

**`determinism.test.ts`.** `deriveEconomy` twice on one state and once on a separate equal state all
deep-equal; the input deep-equals its JSON snapshot afterwards (this was untested — only
`resolveTurn` had a no-mutation test); a **deep-frozen** state derives and resolves without a throw,
which is the strongest form of the claim since a module assignment to a frozen object throws;
`resolveTurn` twice is byte-identical; a five-turn trajectory run twice lands on the same state; the
next state shares no object with the old one, sector by sector and resource by resource, and editing
it cannot reach back; an aborted turn is deterministic too and reports `["V2", "V3", "V4"]` both
times.

### Verification — real output, run from the package root

```
$ yarn typecheck
typecheck exit: 0

$ yarn tsx --test src/economy/fixture-detail.test.ts src/economy/boundaries.test.ts \
    src/economy/guards.test.ts src/economy/determinism.test.ts
ℹ tests 35
ℹ suites 0
ℹ pass 35
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 134.345875

$ yarn test
ℹ tests 796
ℹ suites 0
ℹ pass 796
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 933.909625
                             # 761 existing + 35 new. Zero regressions.
```

### Notes for whoever writes the next test file here

- **Test files may not export anything** — `purity.test.ts` asserts `^export\b` never matches in a
  `*.test.ts`. So a fixture builder cannot be shared between test files and each one rebuilds its
  own Aurelia. That duplication is deliberate, not an oversight.
- `purity.test.ts`'s "source and test files pair up" requires every **source** file to have a test
  file; it does not forbid extra test files with no source of their own, which is what these four
  are.
- Assert `frGenerated` and everything downstream of it with a tolerance, never by equality: 10 000 ×
  1,06 × 0,90 × 1,05 does not land on exactly 10 017 in IEEE-754. Whole-obor volumes and integer
  ratings are the only safe equality assertions.

---

## Docs & commit

Commit: `56a7888e92c96ae2b98727bda91c8c147d1de5e9` — "civitas interactive map — T11-B economics
calculator engine". 68 files, every one inside the package.

### Verification before committing

All three green on the first run. Nothing needed fixing.

```
$ yarn typecheck
exit=0            (no output)

$ yarn test
ℹ tests 796
ℹ pass 796
ℹ fail 0
ℹ duration_ms 955.248084

$ yarn tsx --test src/economy/*.test.ts
ℹ tests 203
ℹ pass 203
ℹ fail 0

$ yarn build
Rspack compiled with 1 warning in 85 ms
                  # the pre-existing asset-size warning on map.png,
                  # provinces_map.png and provinces_manifest.json
```

### What was committed

- `src/economy/` — 18 source files and 23 test files.
- `README.md` — the new "Economics calculator engine" section, appended. Earlier sections untouched.
- `.plan/PLAN.md` — the T11 scope edits that were sitting uncommitted.
- `.plan/T11/` — `FORMULA-SPEC.md`, `RULEBOOK-DIGEST.md`, `RULEBOOK-IMAGES.md`, `SPEC-REVIEW.md`,
  `SPEC-SUMMARY.md`, `memory.md`, and `images/`.
- `.plan/T11-B/` — `DESIGN.md`, `review-1.md`, `memory.md`.

### The images

`.plan/T11/images/` held 42 files. Only 16 are the record: `img01.jpg` … `img15.jpg` and
`urls.txt`, which lists exactly those 15 source URLs in that order. The other 26 were
intermediate crops and upscales an earlier agent made while reading the screenshots, and they
were deleted before the commit: `c04*.png`, `c08*.png`, `c11.png`, `c14*.png`, `crop*.png` and
the six `img*_big.png`. `c11.png` was byte-identical to `img11.jpg` — same MD5 — which is what
confirmed the `c*` family is copies rather than originals.

### The README section

It documents the two entry points, the fifteen-step order and why the order is load-bearing, the
running FR balance, the `plannedGrowthPct` anti-circularity device, the numeric rules, one
paragraph per stage, the error/warning split, the persistence seam, the test layout, and the
known limitations. The test-count claim was corrected from a first draft's 196/17 to the measured
203 tests in 23 files.

### Left uncommitted on purpose

`.plan/T08/memory.md`, `.plan/T09/memory.md`, `.plan/T10/memory.md` and
`.plan/T08-FIX/memory.md` each carry a "Docs & commit" section their own docs agent appended
*after* committing, so the section never landed. They are unrelated to T11-B. The repo also holds
a large unrelated staged change set — 119 deletions under `javascript/.yarn/cache`,
`javascript/.claude/skills/prototype-manager/SKILL.md`, `yarn.lock`, `install-state.gz` and a
Unity `.blend` — which was already in the index before this task started.

**Committing with a pathspec is what kept that separate.** `git commit -F msg -- <paths>` commits
the working-tree content of those paths through a temporary index and leaves everything else
staged exactly as it was. A plain `git add` plus `git commit` would have swept all 119 cache
deletions into this commit. Whoever commits next in this repo should do the same.
