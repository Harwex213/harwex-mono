# T11-A — spec brief for approval

Source documents: `FORMULA-SPEC.md` (2 560 lines), `SPEC-REVIEW.md` (adversarial review).
The review is superseded — the spec was revised after it. See the last section.

---

## What the economy does

- **The player sets:** the emission percentage, the military spending percentage, an FR and MIC
  ledger of orders bought and sales received, reserve deposits and withdrawals, stockpile
  deposits and withdrawals, a loan request, and resource imports and exports.
- **A judge sets:** the credit rating, the position on the state-control scale, sector volumes,
  resource deposits, blockades, mobilization, dice rolls, and concession grants.
- **A turn is one calendar year.** It generates two budgets — FR points for civilian orders, MIC
  points for military ones — charges the mandatory costs (debt service, then stockpile upkeep),
  spends the discretionary ledger, then grows GDP sector by sector.
- **Points do not carry over.** Whatever is unspent counts as investment and buys a little growth.
  Saving instead is opt-in and costs 1,5 times as much growth as investing would have bought.
- **Nothing wins.** There is no victory condition and the spec does not invent one. The loss
  states are a debt spiral through interest capitalisation, a credit rating bled to tier F where
  borrowing is impossible, and GDP shrinking toward zero.

---

## Headline numbers

All "at the standard start" figures use the sourced start: GDP 100 000 000 obor, five sectors of
20 000 000, rating 70, control 50, military spending 10%, emission 0%, growth 3,00%.

| Quantity | Rule | At the standard start |
| --- | --- | --- |
| FR income | 20% of GDP, times rating, control, growth, military drag and a light-industry bonus | **10 017,00 FR points** = 20,03% of GDP |
| MIC income | GDP × military% ÷ 50 000 obor, times growth and a heavy-industry bonus | **233,20 MIC points** |
| Currency rate | 1 FR point = 2 000 obor; 1 MIC point = 25 FR points = 50 000 obor | — |
| GDP growth | GDP-weighted mean of per-sector rates; one shared modifier sum; resource shortage multiplies each sector down, never below 0 | 3,00% before modifiers |
| Emission yield | +1% of GDP in FR per 1 pp; inflation 1,5% per pp; growth −0,15 pp per pp; rating −0,4 per pp | 10% emission = **+5 000 FR, 15% inflation, −1,50 pp growth, −4 rating a turn** |
| Military yield | ≈ +23 MIC per pp; FR falls by 1% of the tax take per pp; growth −0,10 pp per pp above 10% | 10% is the penalty-free baseline |
| Reserve | cap 2 annual incomes; growth penalty 3,00 pp per 1,0 of GDP banked | full reserve ≈ **−1,20 pp growth** |
| Stockpile | no cap; upkeep 2 FR per point per turn | 100 points cost 200 FR a turn |
| Auto-investment | +2,00 pp of growth per 1,0 of GDP left unspent | a whole tax take unspent = **+0,40 pp** |

**Control scale — the step limit and the two effects, per band.** The step is the most emission or
military spending may move in one turn. Mobilization adds +10,00 pp to the military step only.

| Position | Band | Growth | FR × | Step |
| --- | --- | --- | --- | --- |
| 0–5 | Total control | −2,50 pp | 1,50 | 17,50 pp |
| 6–20 | Command economy | −2,00 pp | 1,40 | 16,00 pp |
| 21–30 | Heavy dirigisme | −1,50 pp | 1,30 | 14,50 pp |
| 31–44 | Dirigisme | −1,00 pp | 1,20 | 13,00 pp |
| 45–49 | Guided market | −0,50 pp | 1,10 | 11,50 pp |
| **50** | **Policy of balance** | **0,00 pp** | **1,00** | **10,00 pp** |
| 51–55 | Regulated market | +0,50 pp | 0,90 | 8,50 pp |
| 56–69 | Social market | +1,00 pp | 0,80 | 7,00 pp |
| 70–79 | Free market | +1,50 pp | 0,70 | 5,50 pp |
| 80–94 | Laissez-faire | +2,00 pp | 0,60 | 4,00 pp |
| 95–100 | Minarchism | +2,50 pp | 0,50 | 2,50 pp |

Only the 50 row is sourced. The band boundaries are sourced. The ten other names, the ±0,50 pp
growth step, the ±0,10 FR step and the 1,50 pp step slope are invented.

**Debt terms per rating tier.** The limit is a multiple of annual FR income.

| Tier | Rating | Limit (× income) | Rate | Term |
| --- | --- | --- | --- | --- |
| A+ | 95–100 | 4,00 | 4,00% | 10 turns |
| A | 85–94 | 3,00 | 8,00% | 8 turns |
| **B** | **70–84** | **2,25** | **12,00%** | 6 turns |
| C | 50–69 | 1,50 | 17,00% | 4 turns |
| D | 30–49 | 1,00 | 23,00% | 3 turns |
| E | 10–29 | 0,50 | 30,00% | 2 turns |
| F | 0–9 | 0,00 | — | cannot borrow |

Tier B's 12,00% is sourced. Every other cell in this table is invented. Interest is paid before
principal and unpaid interest capitalises, which is what makes a debt spiral possible.

---

## The decisions most worth your attention

Invented first, because those are the ones only you can rule on.

1. **INVENTED — 1 FR point = 2 000 obor**, from an invented rate of 1 obor = 500 arlings. Every
   points-denominated quantity scales with it: the debt limit, the reserve cap, the auto-investment
   bonus.
2. **INVENTED — tier B's debt limit is 2,25 × annual income, not the flat 22 500 FR that PLAN
   binds.** It produces 22 538,25 at the standard start and diverges everywhere else. This is the
   only deviation from a PLAN-binding constant in the whole spec.
3. **INVENTED — one coefficient sets both thrift and hoarding.** `INVEST_GROWTH_COEFF` = 2,00 pp
   per 1,0 of GDP invested, and the sourced 1,5× ratio makes the reserve penalty 3,00 pp.
4. **INVENTED — the control scale spreads ±2,50 pp of growth against ×0,50…×1,50 on the budget.**
   The directions are sourced; the whole spread is chosen.
5. **INVENTED — privatization succeeds on a d10 roll of 6 or more, and payouts scale linearly with
   the roll.** The spec names a threshold model as the main alternative.
6. **INVENTED — unpaid stockpile upkeep loses only the points the budget could not cover.** PLAN's
   wording reads as a total wipe.
7. **SOURCED — a concession costs total GDP ÷ province count**, booked against one sector the
   grantor picks. This resolves contradiction C2 in favour of the article's worked example and
   against its rule text.
8. **SOURCED — the credit rating only falls inside the engine.** Every engine delta is negative and
   the only upward path is a verdict. A country at 4% emission bleeds 2 points a turn to 0 with no
   recovery, and a well-run economy never earns an upgrade on its own.

---

## The two source contradictions

- **C2, the concession cost.** The rule text says the grantor loses turnover from one sector,
  scaled by province count; the worked example says a 20-province country loses 5 000 000 GDP,
  which is 1/20 of total GDP and five times 1/20 of one sector. **Resolved for the example:** the
  cost is `gdpTotal / provinceCount`, and "one sector of your choice" decides only where the loss
  lands.
- **C3, obor against arling.** Both currencies are scaled by "one million" and no rate is given.
  At 1 point = 1 000 000 obor the observed start budget is 83 times the whole economy; at
  1 point = 1 obor it is a ten-thousandth of it. **Resolved by inventing the rate:** 1 obor =
  500 arlings, so 1 FR point = 2 000 obor and the state's annual take is about a fifth of GDP.

---

## What the reviewer flagged and the spec did not simply do

The review returned NOT ACCEPTED with 9 blocking and 16 non-blocking findings. The revision fixes
all 25 and rejects none. I checked that each fix is present in the file; I did not re-derive the
worked example. Four residues are worth naming.

- **The 22 500 FR debt limit is still not implemented.** The review asked for the deviation to be
  put in front of you rather than fixed, and it now is. Question 1 below.
- **One guard is dead by design.** `MILITARY_FR_DRAG_FLOOR` = 0,10 can never bind, because the
  constants bottom the drag out at 0,40. The spec keeps it and says so, instead of removing it.
- **The turn number became engine-owned.** The review asked for the field to be tagged and
  reconciled. The spec tags it `[A]`, so nothing can edit the year, while the calculator screenshot
  shows it as an editable cell. Small, but it is a source observation overruled without a question.
- **Three fixes depart from what the review asked**, each recorded with a reason: the worked example
  was changed rather than the ordering it disagreed with, two GDP ratios are quoted instead of one,
  and step 1 became a full read-only derive pass rather than a split validation gate.

---

## Open questions

1. Tier B's debt limit: keep 2,25 × annual income, or honour the sourced flat 22 500 FR with a
   per-tier flat table?
2. Approve 1 FR point = 2 000 obor, which makes the state's annual take about 20% of GDP?
3. Approve `INVEST_GROWTH_COEFF` = 2,00, which sets both the unspent-points bonus and the reserve
   penalty?
4. Concession cost: total GDP ÷ provinces (the example), or one sector's turnover ÷ provinces (the
   rule text, about a fifth as much)?
5. Privatization roll: linear payout with success on 6+, or nothing below 6 and the full range
   across 6–10?
6. Control scale: approve ±2,50 pp of growth against ×0,50…×1,50 on the budget, or widen or narrow
   it?
7. Unpaid stockpile upkeep: keep the points the budget covered, or wipe the whole stockpile on any
   shortfall?
8. Should the credit rating ever recover without a verdict — say +1 per clean turn — or stay a
   judge-only lever?
