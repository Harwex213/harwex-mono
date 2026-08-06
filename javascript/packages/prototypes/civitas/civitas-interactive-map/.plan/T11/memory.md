# T11-A — spec author handoff

Deliverable: `.plan/T11/FORMULA-SPEC.md`. It is a **gate**: T11-B implements it literally once the
user approves, and invents nothing the spec does not contain. The shape: a sector grows by
`permanent + temporary + oneGlobalModifierSum`, and a positive result is then multiplied by
`(1 − shortagePenalty)`. FR is the state's 20% tax take on GDP at 2 000 obor per point, times
rating, control band, growth, a defence drag and a light-industry bonus, plus an additive emission
term. MIC is the military share of GDP at 50 000 obor per point.

## Decisions, with reasons

- **1 obor = 500 arlings, so 1 FR point = 2 000 obor.** Resolves C3. A 1:1 rate is arithmetically
  impossible — it makes the standard start's budget 82 947× its own GDP, and the digest's "FR income
  is roughly 8,29% of GDP" line is a slip (the true ratio is 0,0083%). 2 000 makes the tax take a
  round 10 000 points at the standard start and the sourced 22 500 FR debt limit a clean 2,25
  annual incomes.
- **Concession cost = total GDP ÷ province count, booked to a chosen sector.** Resolves C2 for the
  worked example against the rule text. The other reading lets a player book the loss to their
  smallest sector and collapses the mechanic; this one makes the cost invariant.
- **`plannedGrowthPct` breaks the FR ↔ growth cycle.** Generation reads a pre-modifier weighted mean
  of `permanent + temporary`, which cannot depend on FR, MIC, reserves or shortage. No fixed point.
- **Shortage penalty = `Σ (shortage/depCount) / Σ (1/depCount)`** over the sector's resources. The
  normalisation bounds it at 1, which makes the multiplicative form satisfy both halves of the
  sourced rule. The weight is "more dependent sectors → smaller penalty" read literally, and it
  needs no coefficient table.
- **The debt limit is a multiple of income, not a flat 22 500** — a flat cap is the same for a
  village and an empire, and the multiple reproduces the sourced value anyway. **The step limit is a
  validation error, never a clamp** (a clamp resolves a turn nobody intended). **Unpaid MIC upkeep
  loses only the points you could not pay for.** **Inflation is derived per turn, not a stock.**
- Three things were *recovered*, not invented, and the digest listed all three as unknown: the FR
  light-industry coefficient 0,25 and the MIC heavy-industry coefficient 0,50 (Image 5 reads 5,00%
  and 10,00% at a 20% share, and their 1:2 ratio corroborates the reading), and the GDP-weighted
  mean for overall growth (Image 1's 0,29% is exactly `20M × 1,45% / 100M`).

## Where I was least confident

1. **`INVEST_GROWTH_COEFF` = 2,00.** One constant sets both the unspent-points bonus and, through
   the sourced 1,5× ratio, the reserve penalty. No anchor exists. I picked the value that makes a
   fully unspent tax take worth +0,40 pp, matching "though not by much".
2. **The roll→payout mapping** — linear, privatization succeeding on 6+. The digest warns linear is
   inference. A threshold model is the alternative; I flagged it instead of picking it.
3. **The control-scale spread** (±2,50 pp growth, ×0,50…×1,50 FR, 2,50…17,50 pp step). One band of
   eleven is observed. All three generators are linear in the band index, so a retune is 3 numbers.
4. **`OBOR_PER_MIC_POINT` = 50 000**, justified only by making the sourced 2-FR upkeep an 8%/yr
   maintenance charge. And **debt service before MIC upkeep**: a missed payment costs 10 rating
   while a lost MIC point is local, but the sources are silent either way.
5. **Emission's three slopes.** Every screenshot reads 0 at 0% emission, so nothing pins them. I
   only verified they compose into a self-limiting mechanic rather than a runaway.

## Traps for T11-B

- `sanitizeRecord` in `src/state/schema.ts` **drops** a key whose value is `NaN`, `Infinity` or
  `undefined` — the field vanishes rather than nulling, and the next load reads it as absent. Guard
  every stored number with `finiteOr`, use `null` for absent, no `Map` and no `Set`. The slot allows
  8 container levels counting its own `data` as level 1; history reaches 6, so keep records flat.
- The engine is pure: no clock, no `Math.random`, no DOM, no signals. The dice roll is an input.
  `deriveEconomy` and `resolveTurn` must share one implementation of every formula, or T12's live
  [A] fields will drift from what End Turn books.
- §19 is a full fixture computed at double precision. Reproduce it as the first test. The sector sum
  and the weighted mean agree exactly at 107 795 555 — a cheap invariant to assert.

## Revision — after the adversarial review

`SPEC-REVIEW.md` returned NOT ACCEPTED with 9 blocking problems and 16 non-blocking findings. All 25
are fixed in `FORMULA-SPEC.md`. `§22` of the spec records the three fixes that depart in detail from
what the reviewer asked for. Nothing was left as it was.

**Two claims in the section above are wrong and are corrected in the spec.** Read the spec, not this
paragraph, for either:

- The 1:1 exchange rate makes the standard start's budget **82,95× its own GDP**, not "82 947×", and
  the ratio under that premise is **8 294,76%**, not "0,0083%". The 0,0083% figure belongs to a
  different premise, 1 point = 1 obor, and is 0,008295% to four figures. The conclusion — the rate
  can be neither 1 000 000 nor 1 — survives. §1.2 now carries a three-row table of the arithmetic.
- **Nothing was "recovered" from the FR/MIC light- and heavy-industry cells.** Both coefficients are
  single-point curve fits, which PLAN decision 2 forbids in terms, so `FR_LIGHT_BONUS_COEFF`,
  `MIC_HEAVY_BONUS_COEFF` and `MILITARY_FREE_PCT` are now labelled **INVENTED, anchored on Image N**.
  Only the GDP-weighted mean for overall growth was genuinely recovered.

### The six blockers where two implementers would have produced different numbers

1. **§8.4's ledgers charged unclipped inputs.** Every ledger term is now an `*Applied` quantity:
   `reserveAddApplied`, `reserveWithdrawApplied`, `micStockWithdrawApplied` (newly defined in §9.2),
   `exportsApplied` (newly defined in §13.3). The raw [P] inputs appear nowhere but their own clip.
2. **`frAvailableForUpkeep` and `frStillAvailable` were used and never defined.** §8.4a now defines
   one running balance `frBalance₀…₉` and a table of which charges are deducted at each step. The
   order is credits → reserve addition (step 6) → debt (7) → upkeep (8) → discretionary lines (9).
   `frStillAvailable(l) = frBalance₆ − Σ earlier allocations`; `frAvailableForUpkeep = frBalance₇`.
   `frRemainder = frBalance₉` is an identity with `frAvailable − frSpent`, asserted in a test.
   **This changed the fixture:** §19.8 is now `min(2 220, 14 983,20)` and §19.9's FR after debt
   service is **12 763,20**, not 13 263,20. Nothing else in §19 moved.
3. **Step 1 could not evaluate V5/V6/V7.** Step 1 is now the whole read-only derive pass (steps
   2–13); it is the only abort site and there is no second validation anywhere. The derive pass must
   be **total** — it computes through step 13 on invalid input and never throws. §17 gained a `Needs`
   column naming the stage each rule depends on.
4. **`deriveEconomy`'s step list was impossible.** It runs the read-only form of steps 2 through 13,
   all twelve. Step 11 needs step 10's `autoInvestGrowthPp`, so no shorter list can work.
5. **A concession mutated `gdpObor` mid-pipeline.** New §4.2a freezes sector volumes and `gdpTotal`
   for the whole turn; the concession cost is booked at **step 12** against the chosen sector's
   next-turn volume. The +1,50 pp **does** apply on the grant turn. A grant enters through a new
   `pendingConcession` **[V]** field, cleared at step 14.
6. **A loan created at step 5 is not serviced at step 7.** Loans carry `createdTurn`; step 7 services
   only `createdTurn < turn`. So a 6-turn loan makes 6 payments and its proceeds net in full.

### The other three blockers

7. §1.2's arithmetic — above.
8. **The tier-B 22 500 FR deviation is now question 0 at the approval gate (§21.1)**, with the flat
   per-tier alternative table spelled out so the user can choose. It is the only PLAN-binding
   constant the spec declines to reproduce, and it was previously buried in §2.9.
9. **`exports` had no income channel.** New §8.6: `frIncomeLines[]` and `micIncomeLines[]`, **[P]**,
   the exact mirror of the expense lists. Expense lines stay `≥ 0` — a sale is never a negative
   expense. §13.5's "one ledger" claim now means "one FR ledger with two sides".

### Non-blocking, all sixteen

Relabelled three coefficients; fixed G13's backwards rationale and G16's unreachable floor; restated
G19 over both channels (ceiling ≈ +6 pp, and the MIC channel returns at most 0,09 pp per pp of
military spending against the 0,10 pp defence penalty, so 10% stays a local optimum); added the
"stored rounding never feeds back" rule to §3 — without it the §19 fixture fails; softened §19.13's
cross-check to "to the nearest obor"; tagged every previously untagged field and made `turn` **[A]**;
gave tier F numeric rate/term; clipped `exports` with warning V19; named the rating's one-way ratchet
in §6.2; named the arrears/MIC-loss test scenarios in §17; dropped the false SOURCED on the sector
display order; and moved the MIC partial-loss rule, the shortage inversion, the rating ratchet and
emission's unvalidatable exchange rate into §21.2 and §21.3 so the user rules on them.

### Verified again, number by number

I recomputed §19 end to end at double precision with an independent script: `gdpTotal` 106 000 000,
all eight resource rows, all six sector penalties, `frCore` 13 363,197826, `frGenerated`
15 483,197826, `micGenerated` 307,933585, `debtLimit` 34 837,20, `reserveCap` 30 966,40, the running
balance 14 983,197826 → 12 763,197826 → 12 663,197826, `frRemainder` 10 163,197826, `micRemainder`
197,933585, `autoInvestGrowthPp` 0,5702, `modifierPp` −0,9028665114, all six `finalPct`, all six
`gdpNextObor`, the total 107 795 555 and the change +1 795 555. The unrounded weighted mean is
107 795 555,0249, so the sum of the rounded parts agrees **to the nearest obor** and not exactly —
assert a tolerance, never equality. Standard start: `frGenerated` 10 017,00, `debtLimit` 22 538,25,
`micGenerated` 233,20.
