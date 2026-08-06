# T11-A — adversarial review of FORMULA-SPEC.md

Reviewer: independent agent. I did not write the spec.
Verdict: **NOT ACCEPTED.** 9 blocking problems. The spec is close, and most of it survives
scrutiny, but six of the nine blockers are places where two implementers would produce
different numbers from the same input.

Checked against `RULEBOOK-DIGEST.md`, `RULEBOOK-IMAGES.md` and `PLAN.md` section 3 decision 2.
Every number in §19 was recomputed independently at double precision.

---

## What passed

These are the checks the task ranked highest, and they pass.

**Every binding constant in PLAN section 3 decision 2 is present with the stated value, except
one** (the tier-B debt limit — B8 below).

| PLAN constraint | Where | Status |
| --- | --- | --- |
| 7 tiers A+ 95–100, A 85–94, B 70–84, C 50–69, D 30–49, E 10–29, F 0–9 | §2.3, §6.1 | exact, contiguous, exhaustive over 0..100, no gap, no overlap |
| 11 bands 0–5, 6–20, 21–30, 31–44, 45–49, 50, 51–55, 56–69, 70–79, 80–94, 95–100 | §2.4, §7.1 | exact, contiguous, exhaustive, band 50 neutral in all three effects |
| FR reserve cap = 2× annual income | §2.8, §9.1 | exact |
| Reserve penalty = 1,5× the auto-investment the same point would have bought | §9.1 | exact — one coefficient drives both directions |
| MIC: no cap, 2 FR/point/turn, lost if unpaid | §2.8, §9.2 | cap and rate exact; "lost" softened to partial, see N13 |
| Emission and military step = 10 pp at position 50, hard cap | §2.4, §7.1, §12 | exact, and enforced as a validation error not a clamp |
| Mobilization: step +10 pp, FR ×0,5, MIC ×2, growth −2 pp | §2.10, §15.1 | all four exact |
| Nationalization −0,75 pp / −4 rating / up to +26,25% income | §2.10, §15.2 | exact |
| Privatization up to +0,75 pp; fail −0,25 pp / −2 rating | §2.10, §15.2 | exact |
| Cooldown 2 turns, per action separately | §2.10, §15.2 | exact; counters traced, gap is 2 full turns |
| Tier B rate 12,00% | §2.9 | exact |
| Tier B limit 22 500 FR | §2.9, §14.1 | **replaced by 2,25 × income → 22 538,25. See B8** |
| 1 deposit = 50 units/turn | §2.11 | exact |
| Shortage caps growth at 0, never negative by itself | §5.3, G9 | multiplicative form with penalty ∈ [0,1], applied only when pre-shortage > 0. Satisfies both halves exactly |
| Dependency matrix reproduced verbatim | §13.2 | **verified cell by cell, all 8 rows × 5 columns** |
| Concessions +1,5% all sectors, four named regions | §2.10, §15.3 | exact |
| C2 and C3 both resolved and the resolution stated | §1.2, §15.3 | resolved, with reasoning |

**Dependency matrix, the specific trap.** The digest warns the source column order is
HEAVY before LIGHT, opposite to the prose. §13.2 keeps the source order
(`Сельское Хозяйство | Тяж. Пром. | Легк. Пром. | Коммерческий сектор | Добывающий сектор`)
and the ticks are not swapped. I checked all 40 cells, then the engine-key list, then the
inverted per-sector list, then the Σ-weight table. Every one is right:
coal 3, oil 1, fibre 2, ferrous 2, nonferrous 2, rubber 1, chemical 3, precious 1;
agriculture {fibre, chemical}, light {coal, ferrous, nonferrous, chemical},
heavy {coal, oil, ferrous, nonferrous, rubber, chemical}, commercial {fibre, precious},
extraction {coal}. Σ weights 0,833333 / 1,666667 / 3,666667 / 1,500000 / 0,333333 are correct.

**The worked example in §19 is arithmetically correct.** I recomputed it end to end. Every
intermediate matches, including the ones that only match at full precision: `frCore`
13 363,197826, `micGenerated` 307,933585, `modifierPp` −0,9028665113, all six `finalPct`
values, all six `gdpNextObor` values, the total 107 795 555 and the change +1 795 555. Heavy
industry's 30 417 668 is the sharpest check in the table — it only comes out right if
`finalPct` is carried unrounded (see N8), and it does come out right. §19 is a usable fixture.

Also verified: the standard start under the spec's own formulas gives `frGenerated` = 10 017,00
and `debtLimit` = 22 538,25, exactly as §1.2 and §2.9 claim. §5.4's weighted-mean derivation
from Image 1 (20M × 1,45% / 100M = 0,29%) is genuinely sourced and correct. All three control
tables are monotone with no reversal, and all 11 step limits are positive. Both debt columns
are monotone across the 7 tiers with the widening rate step the spec claims (4, 4, 5, 6, 7 pp).

---

## Blocking

### B1 — §8.4: the ledgers charge unclipped amounts, contradicting §9.1 and §9.2

§8.4 says:

```
frAvailable = frGenerated + reserveWithdraw + newLoanProceeds + nationalizationFrPayout
frSpent     = Σ frExpenseLines + debtAllocatedTotal + micUpkeepPaid + reserveAdd
micAvailable = micGenerated + nationalizationMicPayout + micStockWithdraw
```

§9.1 defines `reserveAddApplied` and `reserveWithdrawApplied` as the clipped quantities, and
§9.2 uses `min(micStockWithdraw, micStockStart)`. §8.4 uses the raw player inputs instead.

An implementer following §8.4 literally charges FR for a reserve addition that the cap policy
blocked, and credits MIC that was never in the stockpile. A player over the reserve cap who
enters `reserveAdd` = 5 000 loses 5 000 FR into nothing.

**Required fix.** Restate §8.4 in terms of `reserveAddApplied`, `reserveWithdrawApplied` and
`micStockWithdrawApplied`, and define the third one explicitly in §9.2.

### B2 — §9.2 and §14.3: `frAvailableForUpkeep` and `frStillAvailable` are never defined

Line 706 divides by `frAvailableForUpkeep`. Line 1048 takes `min(requiredFr(l), frStillAvailable)`.
Neither term appears anywhere else in the spec. §16.2 only says step 8 "needs the FR left after
debt service".

These two undefined terms decide the two most punishing outcomes in the game: how many MIC
points are destroyed, and how large the debt shortfall is — and a full shortfall is −10 rating,
a whole tier. Whether `reserveAddApplied` has already been charged when step 7 runs changes both
answers. §19.8 computes `min(2 220, 15 483,20)` against the *gross* `frGenerated`, ignoring the
500 reserve addition booked at step 6, which suggests one reading, but the pipeline order
suggests the other. The example has slack so it cannot discriminate.

**Required fix.** Define a single running balance — name it, initialise it at step 6 or earlier
from `frAvailable`, and state the exact order in which reserve additions, debt allocation, MIC
upkeep and discretionary lines are charged against it. State which of the four have already been
deducted at step 7 and at step 8.

### B3 — §16.2 step 1: `validate` cannot evaluate V5, V6 or V7

Step 1 is first, it is the only step permitted to abort, and it is charged with "overspend on
both ledgers, borrow ≤ available". But `frRemainder` (V5) needs steps 3, 5, 6, 7, 8 and 9;
`micRemainder` (V6) needs steps 3, 4 and 9; `newLoanAvailable` (V7) needs `frGenerated` from
step 3. Step 5 then says "validate against it" — a second validation site, which §16.2 has
already forbidden.

As written the pipeline is not implementable in the stated order.

**Required fix.** Define step 1 as a full read-only derive pass that computes everything through
step 13 and collects every error before any state is written, or split validation into an
input-range gate at step 1 and a named ledger gate after step 9. Either way, assign each of
V1–V13 to the step whose output it needs, and delete "only step 1 may abort" or make it true.

### B4 — §16.3: `deriveEconomy`'s step list contradicts `DerivedEconomy`'s fields

§16.3: "`deriveEconomy` runs steps 2, 3 and the read-only parts of 5, 6, 11, 12, 13."

But `DerivedEconomy` in §18 contains `frSpent`, `frRemainder`, `micSpent`, `micRemainder`,
`micUpkeepPaid`, `micStockLost`, `debtRequiredTotal`, `debtShortfallTotal`, `debtRatingPenalty`
and `autoInvestGrowthPp`. Those are the outputs of steps 7, 8, 9 and 10, all four of which are
missing from the list. Step 11 cannot run at all without step 10's `autoInvestGrowthPp`, so the
list is internally impossible, not merely incomplete.

This matters beyond tidiness: T12 drives every [A] field off `deriveEconomy`, and PLAN decision 6
requires those to recompute live.

**Required fix.** State that `deriveEconomy` runs the read-only form of steps 2 through 13.

### B5 — §15.3 with §16.2 step 4: a concession mutates `gdpObor` in the middle of the pipeline

`concessionCostObor` is deducted from one sector, booked at step 4, "once, on the turn the
concession is granted". Steps 2 and 3 have already consumed sector volumes and `gdpTotal`
(resource needs, sector shares, `plannedGrowthPct`, `frTaxBase`, `micGenerated`). Steps 9, 10, 11
and 12 consume them again (`reserveShare`, auto-invest share, `overallGrowthPct`, `gdpNextObor`).
The spec never says which volume the later steps see.

`gdpTotal` appears in eight derived quantities. On a grant turn, two implementers will disagree
on all eight. On a 20-province country the deduction is 5% of GDP, so the disagreement is not
marginal.

Two further gaps in the same section. `concessionGrowthPp` is "+1,50 pp while a concession is in
force" — unstated whether it applies on the grant turn. And there is no [P] or [V] field that
*grants* a concession: `sectorKey` and `active` are [V], `gdpTransferredObor` and `grantedTurn`
are [A], so nothing describes how a grant enters the state or how step 4 recognises one made
this turn.

**Required fix.** Freeze sector volumes and `gdpTotal` at start-of-turn for every derived
quantity, and book the concession deduction against the step-12 next-turn volumes (or state the
opposite explicitly). State whether the +1,50 pp applies on the grant turn. Add the grant input
field and its tag.

### B6 — §16.2 steps 5 and 7: is a loan created this turn serviced this turn?

Step 5 creates the loan with `turnsRemaining = termTurns` and adds the proceeds to FR. Step 7
services every loan. Nothing says whether the loan born at step 5 is in that set.

At tier B a 1 000 FR loan either nets 1 000 or nets 1 000 − 120 − 166,67 = 713,33 in the turn it
is taken. That is a 29% difference in the value of every loan in the game, and it also decides
whether a 6-turn loan makes 6 payments or 5.

**Required fix.** One sentence in step 5 or step 7 saying which.

### B7 — §1.2: the arithmetic refuting the 1:1 exchange rate is wrong by three orders of magnitude

§1.2 says the standard start's 8 294,76 FR points at 1 point = 1 000 000 obor is "82 947 times
the whole economy", and that "the ratio is 0,0083%".

8 294,76 × 1 000 000 = 8 294 760 000 obor against a GDP of 100 000 000 obor. That is **82,95
times** the economy, not 82 947 times. And under the premise being refuted the ratio is
**8 295%**, not 0,0083% — 0,0083% is the ratio you get from 1 point = 1 obor, which is a
different reading from the one the paragraph is discussing. The digest's own "roughly 8,29% of
GDP" is also wrong, but the spec replaces one wrong number with two more.

The conclusion survives: at 1:1 the budget is 83× GDP, which is still absurd, and the chosen
rate gives 16,6% of GDP, which is sane. But `OBOR_PER_FR_POINT` is §21's second-ranked open
question, the user is being asked to approve it on the strength of this paragraph, and the
paragraph's numbers are wrong.

**Required fix.** Correct both figures. State the ratio the chosen rate produces (16,59% of GDP
at the standard start) so the user has the comparison that actually justifies the choice.

### B8 — §2.9 and §14.1: the sourced tier-B debt limit of 22 500 FR is not in the spec, and the deviation is not at the gate

PLAN section 3 decision 2 lists "Debt at tier B: limit 22 500 FR at 12.00%" among the binding
recovered constants, and says of that list: "Honour them exactly." The 12,00% is honoured
exactly. The 22 500 is not: it is replaced by `DEBT_LIMIT_MULTIPLE(B)` = 2,25 × annual FR
income, which produces 22 538,25 at the standard start — and only at the standard start, and only
because `frGenerated` there happens to be 10 017,00.

I am not arguing the design is wrong. A debt-to-revenue ratio is the better mechanic and §14.1
argues it well, and §2.9 is honest that the multiple is INVENTED. The problem is process: this is
the only PLAN-binding constant the spec declines to reproduce, and §21 — the list of things the
user is asked to rule on — does not mention it. §21 raises five questions and this is not one of
them, so the user can approve the spec without ever being asked.

**Required fix.** Add it to §21 as an explicit deviation from a PLAN-binding constant: state that
the flat 22 500 is not implemented, that tier B yields 22 538,25 at the standard start and scales
with income thereafter, and name the alternative (a flat per-tier table anchored on 22 500) so the
user chooses.

### B9 — §13.5: `exports` is a strictly dominated lever with no income channel

`exports(r)` is [P] and reduces `supply(r)`. §13.5 says a purchase is paid for through "an
ordinary FR expense line, which keeps one ledger instead of two". There is no mirror for a sale:
`frAvailable` has no other-income term (§8.4), and `frExpenseLines[].points` is constrained ≥ 0
(§8.5), so a negative line is not available either.

A player who exports gives up resources and receives nothing the engine can represent. No player
will ever set `exports` above 0. A [P] field that is never rational to use is a dead lever, and
the resource exchange — an entire sourced mechanic — is half-modelled.

**Required fix.** Add an FR (and MIC) income line as [P] or [V], or allow signed expense lines,
or state that sale proceeds arrive as a [V] adjustment and say to which field. Then say which one
§13.5's "one ledger" claim refers to.

---

## Non-blocking, ordered by severity

**N1 — §2.5, §2.6: `FR_LIGHT_BONUS_COEFF` = 0,25 and `MIC_HEAVY_BONUS_COEFF` = 0,50 are labelled
SOURCED, and they are single-point fits.** Image 5 shows a light-industry FR bonus of 5,00% and a
heavy-industry MIC bonus of 10,00% at a 20% share. The spec's own SOURCED definition allows
"arithmetic that closes with no residue", and 0,25 × 0,20 = 0,05 does close — but so does
"5,00% flat", "share ÷ 4", "1,25 × share²", and every other one-parameter family through one
point. PLAN section 3 decision 2 says in terms: "Do NOT curve-fit the single observed FR/MIC data
point." Relabel both as INVENTED with the observed cell named as the anchor. The values can stay;
the label is what the user trusts, and it currently overstates.

**N2 — §2.7 contradicts §11 on `MILITARY_FREE_PCT`.** The constants table says SOURCED. §11 says
"SOURCED by inference". The digest says the field reads 0,0% at 10% spending "which suggests 10%
is the penalty-free baseline, but the article does not say so", and files it under NOT SPECIFIED.
Pick one label and make it the honest one in both places.

**N3 — G19's runaway bound is wrong, because it counts only FR.** "the bonus cannot exceed roughly
+1,2 pp from the tax take" is the FR-only figure (0,20 × 1,3 × 1,5 × 1,5 × 2 ≈ 1,17). Unspent MIC
also feeds auto-investment, at 50 000 obor per point. Mobilized at 60% military spending the MIC
channel alone is worth up to ~2,7× GDP of investment per turn, or about **+5,4 pp** — 4,5× the
stated ceiling. I checked and there is no dominant strategy here: the marginal defence penalty is
0,10 pp per pp of military spending against 0,032 pp per pp from the MIC auto-invest channel, so
military spending stays net-negative for growth above 10% and 10% is a local optimum. But the
guard states a bound the engine does not honour, and a guard that is wrong is worse than absent.
Restate it over both channels.

**N4 — §3 versus §19: state that stored rounding never feeds back.** §3 stores percentages at 4
decimals and says rounding happens only where a value is stored or displayed — but `finalPct` *is*
stored, in `SectorDerived`. If an implementer re-reads the stored 4-decimal value, heavy industry
becomes 30 000 000 × 1,013922 = 30 417 660 and the §19 fixture fails against its own 30 417 668. One
sentence fixes it: stored and displayed precision is a view, and no rounded value is ever an input
to further arithmetic.

**N5 — §19.13 overstates its own cross-check.** "The sector sum and the weighted mean agree
exactly." The unrounded weighted mean gives 107 795 555,0249; the sum of the rounded sectors is
107 795 555. They agree to the nearest obor here, and §5.4's "up to rounding" is the correct
claim. Say "to the nearest obor", otherwise T11-B will write an equality assertion that fails on
some other input.

**N6 — G16's guard cannot fire.** `MILITARY_FR_DRAG_FLOOR` = 0,10 with `MILITARY_FR_DRAG` = 1,00
and `MILITARY_PCT_MAX` = 60 means `frDefenceDrag` bottoms out at 0,40. The floor is unreachable.
Either drop it or drop the claim in G16 that it prevents the drag reaching 0.

**N7 — G13's rationale is backwards.** A negative remainder would produce a negative
`investedObor`, hence a negative `autoInvestGrowthPp` — a growth *penalty*, not "a growth bonus
from overspending". The guard is right; the reason given for it is wrong, and a wrong reason
invites someone to remove the guard later.

**N8 — §18 leaves fields untagged, and tags `turn` inconsistently.** PLAN T11-A requires a
[P]/[V]/[A] classification of every field. Untagged: `schemaVersion`, `nextLoanId`,
`nextConcessionId`, `nextModifierId`, `loans[].id`, `concessions[].id`, and all four fields of
`TimedModifier`. And `turn` is tagged [P] while step 15 writes `turn += 1`; Image 1 does show it
as a yellow input, so say which and reconcile it with the commit step.

**N9 — tier F has no `newLoanRatePct` or `newLoanTermTurns`.** §2.9 gives "—" for both;
`DerivedEconomy` types both as `number`. Give them defined values (0, or the tier-E values with
the limit at 0) so the type is satisfiable.

**N10 — §13.3 absorbs an over-export silently.** `supply = max(0, stock + extraction + imports −
exports)` floors at 0 and V12 only requires `exports ≥ 0`, so exporting 500 units of a stock of 5
succeeds and costs nothing. Add a warning, or clip `exports` to what exists and warn (as V15 does
for the MIC stockpile).

**N11 — the credit rating is a one-way ratchet inside the engine.** Every engine-side delta in
§6.2 is negative: emission, nationalization, failed privatization, debt shortfall, unjustified
mobilization. Nothing the player can do raises it; the only positive source is "verdict
adjustment: any". So a country running 4% emission bleeds 2 points a turn to 0 with no recovery
path, and a well-run economy never earns an upgrade. This may be exactly what the rulebook
intends — the digest is clear that the rating "cannot be changed by anything except verdicts" —
but the spec should say so out loud in §6.2 so the user sees the consequence before approving.

**N12 — reachability of the arrears and MIC-loss paths.** V5 makes an overspent FR ledger an abort,
so a player can never *choose* to underpay debt or lose MIC. Those paths are reachable only when
`frGenerated` plus withdrawals is less than debt service plus MIC upkeep — mandatory charges alone.
That is the scenario T11-B must construct to test steps 7 and 8, and the spec should name it,
because the obvious test (book a huge expense line) aborts at step 1 instead.

**N13 — §9.2 softens PLAN's "LOST if unpaid" into a partial loss.** PLAN says MIC stockpiles "are
LOST if unpaid"; the spec keeps exactly the points you could pay for. The digest confirms the size
of the loss is NOT SPECIFIED and the spec labels the choice INVENTED, so this is honest and the
reasoning in §9.2 is good. Flagging only because PLAN's wording reads as total loss and the user
should rule on it. It belongs in §21.

**N14 — §4.1 claims the sector display order is SOURCED.** The order given is agriculture, light,
heavy, commercial, extraction. The only sourced display order is Image 1's: heavy, light,
agriculture, commercial, mining. The *set* is sourced; the order is not. Drop the SOURCED from the
order clause or adopt Image 1's.

**N15 — §13.4: the sourced shortage rule inverts across sectors.** "The more sectors depend on a
resource, the smaller the penalty for lacking it" holds inside a sector, but across sectors the
normalisation reverses it: a coal gap (3 dependents) hits extraction at 100% while an oil gap
(1 dependent) hits heavy industry at 27,3%. §13.4 is transparent about this and argues it is good
texture, which I find persuasive. It should nonetheless be in §21, because it is the one place a
SOURCED rule is satisfied only in a relative sense.

**N16 — playability of emission, for the gate.** Each pp of emission converts about 0,13 pp of
growth into spendable FR worth 1% of GDP. At the 50% ceiling that is +25 000 FR points at the
standard start — 2,5× the entire tax take — against −7,50 pp of growth and −20 rating a turn.
Whether that trade is balanced depends entirely on what orders cost, and orders are priced outside
this model (the digest is explicit). The only brake is the rating bleed, which per N11 never
recovers. Worth naming in §21 as an unvalidatable exchange rate rather than leaving it implied by
G18.

---

## Playability check

Not bankrupt at the start and not immune to decisions. A standard-start country with no deposits
generates 10 017 FR and 233 MIC, and all five base sectors sit at exactly 0,00% final growth
because every shortage is total — which reproduces the screenshots' resource-starved state without
being tuned to. Give it deposits and it grows at roughly 3,6%. Nothing is a no-op except
`exports` (B9). No lever I could find dominates: emission buys budget with growth and rating,
military spending is net-negative for growth above 10% and 10% is a local optimum, reserves cost
about 1 pp a turn to bank a year's income, and the control scale trades ±2,50 pp of growth against
×0,50…×1,50 on the budget. The debt spiral is reachable and bounded, as G21 claims.
