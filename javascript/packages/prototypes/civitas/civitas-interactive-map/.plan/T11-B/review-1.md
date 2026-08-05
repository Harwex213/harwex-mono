# T11-B review 1 — economics calculator engine

Verdict: **ACCEPTED. Zero blocking items.**

Reviewer did not write this code. Every command below was run from
`javascript/packages/prototypes/civitas/civitas-interactive-map`.

## Commands — real output

| Command | Result | Evidence |
| --- | --- | --- |
| `yarn typecheck` | PASS | `tsc --noEmit` printed nothing, exit 0 |
| `yarn test` | PASS | `tests 761 / pass 761 / fail 0`, duration 802 ms. Was 568 before T11-B, so 193 tests were added and none were removed |
| `yarn build` | PASS | `Rspack compiled with 1 warning` — the pre-existing asset-size warning on `map.png` / `provinces_map.png` / `provinces_manifest.json`, unrelated to this task |

## 1. Fidelity to the spec

**Constants.** `src/economy/constants.ts:20-127` holds every scalar of spec §2 in one
`ECONOMY_CONSTANTS` table, and `constants.test.ts:25-107` pins all 74 of them against literal spec
values, not against the code. Walked the whole of §2 by hand — every value matches, including the
five that carry the user's rulings: `OBOR_PER_FR_POINT` 2000, `INVEST_GROWTH_COEFF` 2.0,
`RESERVE_PENALTY_MULTIPLE` 1.5, `PRIV_SUCCESS_MIN_ROLL` 6, `RATING_RECOVERY_PER_TURN` 1. The
structured tables — rating tiers, 11 control bands, per-tier debt terms, the §13.2 dependency matrix
— sit beside it and the sector inversion is *computed* from the matrix
(`constants.ts:201-222`), so the two cannot drift.

**Ruling 2** — `constants.ts:275-283`: tier B is `limitMultiple: 2.25`, `ratePct: 12.0`,
`termTurns: 6`, and the whole table is multiples of income. No flat 22 500 anywhere.

**Ruling 3** — `gdp.ts:34`: `roundTo(safeDivide(gdpTotalObor, count), 0)`, i.e. total GDP ÷ province
count, booked against the chosen sector's step-12 volume (`gdp.ts:37-38`). `gdp.test.ts:51` and
`pipeline.test.ts:225` assert the rulebook's worked example: 20 provinces, 100 000 000 GDP →
5 000 000.

**Ruling 4** — `savings.ts:95-101` loses only the points the budget could not cover
(`floor(balance / 2)`, then `micUpkeepPaid` recomputed from the *surviving* stock, which is what
makes G28 hold).

**Ruling 1, the change.** `rating.ts:45-57` implements the §6.2a predicate with all three clauses
named exactly: `emissionPct === 0`, `shortfallTotal === 0`, `overallGrowthPct > 0` — this turn's
values, the unrounded realised growth, not `plannedGrowthPct` and not `gdpChangeObor`. It runs at
step 13 (`derive.ts:149-159`), after step 7's shortfall and step 11's growth, exactly where the spec
puts it. The recovery is one more term in the same summed-then-clamped list
(`rating.ts:90-107`), not a gate. Verified live: a clean turn that also nationalises produces
`[{Nationalization,-4},{Clean-turn recovery,+1}]` and `ratingNext` 67 from 70 — the spec's own
−4 + 1 = −3 example. At `ratingScore` 100 a clean turn yields 100 (`clean-turn.test.ts:129-137`).

**Pipeline order.** `pipeline.ts:97-599` is `TURN_STEPS`, an ordered array of 15 named descriptors,
and `pipeline.test.ts:22-53` deep-equals the names against the spec's list; `fixture.test.ts:445`
deep-equals the emitted step records too. Order checked line by line against §16.2: derive-and-
validate, resources, generation, actions, borrowing, savings, debt-service, upkeep, spending,
auto-invest, growth, gdp, rating, flags, commit. The load-bearing part — the §8.4a running balance —
is threaded in `derive.ts:55-109` in exactly the specced sequence, and the reserve addition is
charged at step 6 *before* debt service (`derive.ts:73`, `derive.ts:79`).

## 2. The worked example

`fixture.test.ts` reproduces §19 table by table. I recomputed §19 independently at double precision
from the spec's formulas before reading the test, and the test's expected numbers are the spec's,
not the code's:

- `frCore` 13 363,197826, `frEmission` 2 120,00, `frGenerated` 15 483,197826
- `frBalance₆` 14 983,197826 → `frBalance₇` 12 763,197826 → `frBalance₈` 12 663,197826
- `modifierPp` −0,9028665114, per-sector `finalPct` 2,0738 / 1,8046 / 1,3922 / 0,7986 / 1,8724 /
  4,0971, `overallGrowthPct` 1,6939
- six next volumes summing to 107 795 555, `ratingNext` 76, `controlNext` 47

All of them reproduce from my own arithmetic. The §19.13 tolerance rule is honoured: per-sector
volumes are asserted within 1 obor (`fixture.test.ts:351-357`), never by equality, and the total is
the sum of the rounded parts.

The positive branch of ruling 1 gets its own from-scratch fixture as §19.14 demands
(`clean-turn.test.ts`), and its numbers are the spec's own §21.1 figures — `frGenerated` 10 017,00,
`debtLimit` 22 538,25 — which I also recomputed by hand. That is the strongest possible evidence the
fixtures are not back-fitted: two independent spec sections agree with them.

## 3. Guards

Probed each one directly with a throwaway test file (since deleted; `git status` shows only
`src/economy/` and `.plan/` present, no probe left behind):

- **Divide by zero.** Every division goes through `safeDivide` (`num.ts:42-47`) or an explicit guard
  — `max(1, turnsRemaining)` at `debt.ts:114`, `needUnits === 0 → coverage 1` at `resources.ts:83`,
  `weightTotal === 0 → 0` at `resources.ts:126`, `requiredTotal <= 0 → 0` at `debt.ts:154`,
  `provinceCount === 0` at `gdp.ts:29`. A zero-GDP state derives with no errors and every numeric
  field of `DerivedEconomy` finite.
- **Shortage never drives growth negative.** `growth.ts:38-40` applies the factor only when
  `preShortagePct > 0`. Probed with zero deposits and zero imports: every sector lands on
  `finalPct` 0 with `shortagePenalty` 1, none negative.
- **Rating clamp.** `rating.ts:103-107`. Probed from score 1 with a −4 emission penalty → 0, and from
  100 with +1 → 100.
- **Step cap is an error, not a clamp.** `validate.ts:143-161`, `!(move <= limit)` so NaN also fails.
  Probed emission 0 → 20 at band 5: `resolveTurn` returned `ok: false` with `V3 emissionPct`, and the
  derived limit stayed 10,00 — nothing was silently rewritten.
- **Negative FR/MIC remainder.** `validate.ts:166-179`, V5/V6 as errors. Probed a manual
  over-allocation of 999 999 FR with `debtAutoService: false` → `frRemainder −989 982`, V5 raised,
  turn aborted. No silent clamp into `investedObor`.
- **Unbounded compounding.** `frGrowthFactor` clamped 0,50..1,50 (`generation.ts:72-76`). Ran 100
  consecutive turns from the standard start and 40 turns of an emitting, borrowing, militarised
  economy: every number stayed finite, no sector went negative, rating stayed in 0..100, history
  trimmed to 12.
- **Purity of the argument.** `pipeline.test.ts:55-75` asserts both an aborted and a successful turn
  leave the input byte-identical, and `pipeline.test.ts:266-274` that two runs from the same input
  are deep-equal.

## 4. Style

`javascript/CLAUDE.md` checks all pass. No single-quoted string literals (every `'` found is an
apostrophe inside a double-quoted string or a comment). No single-line `if`/`for`/`while` — the one
grep hit, `serialize.ts:353`, is a wrapped multi-line condition with a braced body. No inline
`export` keyword and no default export anywhere. `purity.test.ts:119-140` enforces the harder half
of the rule mechanically: exactly one `export {` per source file, and the file must *end* on it.

## 5. Purity

`src/economy/` imports nothing but its own siblings plus one `import type { JsonRecord, JsonValue }
from "../state/schema"` (`serialize.ts:31`), which erases at build time. Grepped the directory for
`react`, `signal`, `localStorage`, `document.`, `window.`, `canvas`, `navigator` — zero hits.
`purity.test.ts` additionally bans `Math.random`, `new Date`, `Date.now`, `performance.now`,
`structuredClone`, `fetch(`, `console.` and `require(` by scanning the directory on disk, so the
property is defended against future edits, not just asserted today.

## 6. Scope and existing tests

`git status` on `civitas-map` is empty — the read-only reference was not touched. Inside
`civitas-interactive-map` the only source change is the new untracked `src/economy/` directory; no
existing `*.test.ts` was modified, weakened or deleted, and the suite went 568 → 761 passing.

---

## Non-blocking observations

1. **The privatization drag runs 2 turns, not 3.** `PRIV_DRAG_TURNS` is 3 and step 4 sets the
   counter to 3 (`actions.ts:114`), but step 14 decrements it on the same turn
   (`pipeline.ts:480-487`), so the ×0,95 bites on the two turns after the grant and not three. The
   spec contradicts itself here: §15.2 says "for PRIV_DRAG_TURNS = 3 turns, starting NEXT turn",
   while §19.15 pins "privatizationFrDragTurns 3 → 2". The implementer followed §19.15, the binding
   worked example, which is the same principle §0-A ruling 3 used to settle contradiction C2. Correct
   choice, but `.plan/T11-B/memory.md` states it "bites on the next three turns", which is wrong by
   one and should be corrected before T12 reads it.
2. **V7's tier-F and default clauses fire only when `borrowRequest > 0`** (`validate.ts:190-213`).
   §17 lists them as an unguarded conjunction; taken literally a tier-F country could never end a
   turn. The deviation is documented in memory.md and is the only sane reading.
3. **`emissionPctLast` / `militaryPctLast` are written unrounded at step 14**
   (`pipeline.ts:512-513`) while `emissionPct` is rounded to 4 decimals at step 15
   (`pipeline.ts:580-581`). Unreachable today because both are already stored at 4 decimals, but a
   sub-`1e-4` input would leave a phantom non-zero step next turn.
