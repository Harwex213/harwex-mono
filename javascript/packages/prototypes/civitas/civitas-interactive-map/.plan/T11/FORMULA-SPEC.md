# T11-A — Economics formula spec

Status: **APPROVED by the user**, with exactly one change — ruling 1 in §0-A, the credit rating's
automatic recovery. T11-B implements this file literally and must not invent anything it does not
contain.

Sources: `RULEBOOK-DIGEST.md`, `RULEBOOK-IMAGES.md`, `images/`.
Binding decisions: `.plan/PLAN.md` section 3 decision 2, and the user rulings in §0-A.

---

## 0-A. User rulings — final, do not reopen

The user reviewed this spec in full and approved it with exactly one change. The four rulings below
were **decided, not assumed**. Do not reopen any of them and do not "improve" an approved constant.

| # | Ruling | Where it lands |
| --- | --- | --- |
| 1 | **CHANGE.** The credit rating gets a slow automatic recovery: **+1 per turn** when the country ran no emission that turn, missed no debt payment, and had strictly positive GDP growth. Still clamped to 0..100. The judge's verdict lever stays authoritative and unchanged. Rationale the user accepted: without it the rating is a one-way ratchet, so a country that once ran emission can never recover and a well-run economy never earns an upgrade. | `RATING_RECOVERY_PER_TURN` in §2.3; the whole rule in §6.2a; the pipeline slot in §16.2 step 13; the fixture in §19.14 |
| 2 | **APPROVED AS SPECCED.** Tier B's debt limit stays **2,25 × annual FR income**, not the flat 22 500 FR. The whole per-tier table stays multiples of income. | §2.9, §14.1. **§21.1's question 0 is answered: the multiple ships.** |
| 3 | **APPROVED AS SPECCED.** A concession costs **total GDP ÷ province count**, resolving contradiction C2 in favour of the rulebook's worked example. The chosen sector only decides where the loss lands. | §15.3. **§21.2's question 4 is answered.** |
| 4 | **APPROVED AS SPECCED.** Every remaining invented balance constant stands: 1 FR point = 2 000 obor, `INVEST_GROWTH_COEFF` = 2,00 pp and therefore the 3,00 pp reserve penalty through the sourced 1,5× ratio, the control scale's ±2,50 pp growth spread against ×0,50..×1,50 on FR, privatization succeeding on a d10 roll of 6 or more with a linear payout, and unpaid MIC upkeep losing **only** the points the budget could not cover. | §1.2, §2.4, §2.8, §9.1, §9.2, §15.2. **§21.2's questions 1, 2, 3, 5 and 6 are answered: all ship as specced.** |

Ruling 1 is the only change to the spec's behaviour. It is **INVENTED**, it was added at the user's
direction, and §6.2a is the whole of it. Rulings 2, 3 and 4 change no text and no number; they close
open questions.

**The worked example in §19 does not move under ruling 1.** Aurelia runs 4,00% emission on turn 4,
so clause 1 of the recovery predicate fails and the recovery delta is 0. §19.14 records that
explicitly, so the fixture covers the predicate's negative branch.

---

## 0. How to read this file

**Fidelity to the original calculator is not a goal.** The user decided that. This spec keeps
every structural rule and every recovered constant from the rulebook, and designs everything
else for coherence and stability. No formula here is bent to reproduce a screenshot number.

Every rule carries one of two labels:

| Label | Meaning |
| --- | --- |
| **SOURCED** | The rulebook prose or a calculator screenshot states it, or it follows from those by arithmetic that closes with no residue. The image is named. |
| **INVENTED** | My design. The sources are silent or contradictory. The user can change any of these without breaking anything else, as long as the constants table stays consistent. |

Some INVENTED constants carry the qualifier **"anchored on Image N"**. That means one observed
cell is consistent with the value, but the observation is a single point and infinitely many
one-parameter families pass through a single point, so the value is a choice and not a recovery.
PLAN section 3 decision 2 forbids curve-fitting the one observed FR/MIC data point, and calling
such a value SOURCED would be exactly that. Three constants carry the qualifier:
`FR_LIGHT_BONUS_COEFF`, `MIC_HEAVY_BONUS_COEFF` and `MILITARY_FREE_PCT`.

Every field carries one of three classifications. T12 drives editability from them.

| Tag | Meaning | UI |
| --- | --- | --- |
| **[P]** | Player input. The player sets it freely inside its own range. | Editable |
| **[V]** | Verdict input. Only a judge, an event or a dice roll changes it. | Editable behind the judge affordance |
| **[A]** | Auto. The engine computes it. | Read-only |

The rulebook's own convention agrees: the calculator's yellow cells are "what the player can
change by themselves **or as the result of verdicts**" (SOURCED). This spec splits that yellow
into [P] and [V], because the rulebook is explicit that the credit rating, the control-scale
position and the resource situation "cannot be changed by anything except verdicts" (SOURCED).

---

## 1. Units, and the two currencies

### 1.1 The three quantities

| Quantity | Unit | Scale |
| --- | --- | --- |
| GDP and every sector volume | **obor** | Whole obor. The standard start is 100 000 000 obor. **SOURCED** (Image 1) |
| FR points (`оФС`) | **FR point** | 1 point ≡ 1 000 000 arlings, nominally. **SOURCED** (§5.1 of the digest) |
| MIC points (`оВПК`) | **MIC point** | No stated cash value. **SOURCED** that military prices are quoted in them |
| Resource stocks | **unit** | Whole units. 1 unit backs 1 000 000 obor. **SOURCED** (Image 11, confirmed by arithmetic) |

### 1.2 Contradiction C3 — obor against arling. RESOLVED.

The sources give two currencies, both scaled by "1 million", and no rate. The engine needs a
rate the moment an FR point moves GDP, which happens in exactly two places: the auto-investment
growth bonus and the FR reserve penalty.

The naive reading — 1 arling = 1 obor, so 1 FR point = 1 000 000 obor — is arithmetically
impossible. The calculator's standard start generates 8 294,76 FR points (Image 5) against a GDP
of 100 000 000 obor. At 1 point = 1 000 000 obor that budget is 8 294 760 000 obor, which is
**82,95 times** the whole economy — a state that can buy its own country eighty-three times over
every year.

The arithmetic of the two competing readings, spelled out so nothing is taken on trust:

| Premise | The 8 294,76 points are worth | As a share of a 100 000 000 obor GDP |
| --- | --- | --- |
| 1 point = 1 000 000 obor (the naive 1:1 arling:obor reading) | 8 294 760 000 obor | **8 294,76%** — 82,95× the economy |
| 1 point = 1 obor | 8 294,76 obor | **0,008295%** — a ten-thousandth of the economy |
| 1 point = 2 000 obor (this spec) | 16 589 520 obor | **16,59%** |

Both extremes are absurd, in opposite directions, so the rate is neither 1 000 000 nor 1. (The
digest's note that "FR income is roughly 8,29% of GDP if 1 point = 1 million obor" is an
arithmetic slip: under that premise the ratio is 8 294,76%, three orders of magnitude larger.
The 0,0083% figure is the ratio at 1 point = 1 obor, which is a different reading from the one
being refuted, and it is 0,008295% to four significant figures.)

**Decision: 1 obor = 500 arlings. Therefore 1 FR point = 1 000 000 arlings = 2 000 obor.**
**INVENTED.**

What the chosen rate produces at the standard start: the calculator's observed 8 294,76 points
are **16,59% of GDP**, and this spec's own generation formula (§8.1) produces 10 017,00 points
there, which is 20 034 000 obor or **20,03% of GDP**. So the state taxes and spends about a
fifth of its economy every year, which is the number `FR_TAX_RATE` was chosen to mean. That is
the comparison that justifies the rate.

Why this reading:

- It keeps both sourced nominals intact. GDP is still obor, an FR point is still a million
  arlings. Only the rate is new, and the rate is the one thing the sources never state.
- It makes the obor the large domestic accounting unit and the arling a small international
  settlement unit. That matches the prose, which calls the arling "the international reserve
  currency" and never uses it for output.
- It makes the whole budget legible in one line: the state's tax take is
  `FR_TAX_RATE` = 20% of GDP, and at the standard start that is 20 000 000 obor = **10 000 FR
  points**. Every other constant in the FR block is then a modifier on a round number.
- It makes the one sourced debt constant fall out of a clean design choice rather than a fit.
  Tier B's debt limit is 2,25 annual incomes, which at the standard start is 22 538,25 FR against
  the sourced 22 500 — a 0,17% difference that nothing was tuned to produce. **This is still a
  deviation from a PLAN-binding constant, because the multiple reproduces 22 500 only at the
  standard start. It was question 0 at the approval gate, and §0-A ruling 2 answered it: the
  multiple ships (§21.1).**

A MIC point needs an obor value too, for the same two places. **Decision: 1 MIC point =
25 FR points = 50 000 obor. INVENTED.** It makes the sourced upkeep of 2 FR per point per turn
an 8% annual maintenance charge on the point's own build cost, which is a sane number for
materiel, and it keeps MIC points chunky — a few hundred per turn, not tens of thousands.

Every conversion in this spec goes through exactly two constants, `OBOR_PER_FR_POINT` and
`OBOR_PER_MIC_POINT`. There is no floating exchange rate and no currency market.

---

## 2. Constants

One table. Retune the economy here and nowhere else. `pp` is percentage points.

### 2.1 Currency and conversion

| Constant | Value | Label | Note |
| --- | --- | --- | --- |
| `ARLINGS_PER_OBOR` | 500 | INVENTED | §1.2 |
| `ARLINGS_PER_FR_POINT` | 1 000 000 | SOURCED | Digest §5.1 |
| `OBOR_PER_FR_POINT` | 2 000 | INVENTED | = `ARLINGS_PER_FR_POINT / ARLINGS_PER_OBOR` |
| `OBOR_PER_MIC_POINT` | 50 000 | INVENTED | = 25 FR points |
| `OBOR_PER_RESOURCE_UNIT` | 1 000 000 | SOURCED | Digest §10.3, Image 11 |

### 2.2 GDP and sectors

| Constant | Value | Label |
| --- | --- | --- |
| `BASE_SECTORS` | agriculture, lightIndustry, heavyIndustry, commercial, extraction | SOURCED |
| `OTHER_SECTOR_MAX` | 2 | SOURCED (Image 1, prose) |
| `DEFAULT_PERMANENT_GROWTH_PCT` | 3,00 | SOURCED (Image 1) |
| `START_GDP_OBOR` | 100 000 000 | SOURCED (Image 1) |
| `START_SECTOR_GDP_OBOR` | 20 000 000 | SOURCED (Image 1) |
| `SECTOR_GROWTH_FLOOR_PCT` | −100,00 | INVENTED (guard: a sector may not go negative) |

### 2.3 Credit rating

| Constant | Value | Label |
| --- | --- | --- |
| `RATING_TIERS` | A+ 95–100, A 85–94, B 70–84, C 50–69, D 30–49, E 10–29, F 0–9 | SOURCED (Image 3) |
| `START_RATING` | 70 | SOURCED (Image 3) |
| `RATING_FR_PIVOT` | 70 | INVENTED |
| `RATING_FR_SLOPE` | 0,01 per rating point | INVENTED |
| `RATING_RECOVERY_PER_TURN` | +1 rating point per clean turn | INVENTED, added at the user's direction (§0-A ruling 1). The predicate for "clean" is §6.2a |
| `RATING_MIN` / `RATING_MAX` | 0 / 100 | SOURCED |

### 2.4 Control scale

| Constant | Value | Label |
| --- | --- | --- |
| `CONTROL_BANDS` | 0–5, 6–20, 21–30, 31–44, 45–49, 50, 51–55, 56–69, 70–79, 80–94, 95–100 | SOURCED (Image 4) |
| `CONTROL_NEUTRAL_BAND_INDEX` | 5 (the single-value band 50) | SOURCED |
| `START_CONTROL` | 50 | SOURCED (Image 4) |
| `CONTROL_GROWTH_STEP_PP` | 0,50 pp per band index toward the market | INVENTED |
| `CONTROL_FR_STEP` | 0,10 per band index toward planning | INVENTED |
| `STEP_LIMIT_NEUTRAL_PP` | 10,00 | SOURCED (Image 10, Image 15) |
| `CONTROL_STEP_SLOPE_PP` | 1,50 pp per band index toward planning | INVENTED |
| `NAT_LOCK_BAND_INDEX` | 0 — nationalization locked in band 0–5 | INVENTED |
| `PRIV_LOCK_BAND_INDEX` | 10 — privatization locked in band 95–100 | INVENTED |

### 2.5 FR generation

| Constant | Value | Label |
| --- | --- | --- |
| `FR_TAX_RATE` | 0,20 of GDP | INVENTED |
| `FR_GROWTH_COEFF` | 0,02 per pp of planned growth | INVENTED |
| `FR_GROWTH_FACTOR_MIN` / `MAX` | 0,50 / 1,50 | INVENTED (runaway guard) |
| `FR_LIGHT_BONUS_COEFF` | 0,25 × light-industry share | INVENTED, anchored on Image 5 (5,00% at a 20% share) |
| `MILITARY_FR_DRAG` | 1,00 × military share | INVENTED |
| `MILITARY_FR_DRAG_FLOOR` | 0,10 | INVENTED (guard) |
| `FR_REGIME_MULT_MOBILIZED` | 0,50 | SOURCED (Image 15) |
| `EMISSION_FR_RATE` | 1,00 of the emitted GDP share | INVENTED |

### 2.6 MIC generation

| Constant | Value | Label |
| --- | --- | --- |
| `MIC_HEAVY_BONUS_COEFF` | 0,50 × heavy-industry share | INVENTED, anchored on Image 5 (10,00% at a 20% share) |
| `MIC_REGIME_MULT_MOBILIZED` | 2,00 | SOURCED (Image 15) |

### 2.7 Emission and military spending

| Constant | Value | Label |
| --- | --- | --- |
| `EMISSION_PCT_MIN` / `MAX` | 0,00 / 50,00 | INVENTED (guard; sources give no ceiling) |
| `EMISSION_INFLATION_COEFF` | 1,50 inflation % per emission % | INVENTED |
| `INFLATION_GROWTH_COEFF` | 0,10 pp of growth per inflation % | INVENTED |
| `EMISSION_RATING_COEFF` | 0,40 rating points per emission % | INVENTED |
| `MILITARY_PCT_MIN` / `MAX` | 0,00 / 60,00 | INVENTED (guard) |
| `MILITARY_FREE_PCT` | 10,00 | INVENTED, anchored on Image 10 (a 0,0% penalty at 10% spending) |
| `DEFENCE_GROWTH_COEFF` | 0,10 pp per pp above `MILITARY_FREE_PCT` | INVENTED |

### 2.8 Savings

| Constant | Value | Label |
| --- | --- | --- |
| `RESERVE_CAP_MULTIPLE` | 2,00 × annual FR income | SOURCED (Image 8) |
| `INVEST_GROWTH_COEFF` | 2,00 pp per 1,00 of GDP invested | INVENTED |
| `RESERVE_PENALTY_MULTIPLE` | 1,50 | SOURCED (Image 8) |
| `MIC_STOCKPILE_CAP` | none | SOURCED (Image 9) |
| `MIC_UPKEEP_FR_PER_POINT` | 2,00 FR per point per turn | SOURCED (Image 9) |

### 2.9 Debt

| Tier | `DEBT_LIMIT_MULTIPLE` (× annual FR income) | `DEBT_RATE_PCT` | `DEBT_TERM_TURNS` |
| --- | --- | --- | --- |
| A+ | 4,00 | 4,00 | 10 |
| A | 3,00 | 8,00 | 8 |
| **B** | **2,25** | **12,00** | 6 |
| C | 1,50 | 17,00 | 4 |
| D | 1,00 | 23,00 | 3 |
| E | 0,50 | 30,00 | 2 |
| F | 0,00 | — | — |

Tier B's rate of 12,00% is **SOURCED** (Image 13). Tier B's limit of 2,25 incomes is
**INVENTED** and reproduces the sourced 22 500 FR at the standard start to within 0,2%
(22 538,25). The other six rows are **INVENTED**, monotone in both columns, with the rate step
widening as the tier falls (4, 4, 5, 6, 7 pp). Tier F cannot borrow at all — the tier is named
"default", and its two rate/term cells are `0` in the engine, not absent (§14.1).

**PLAN section 3 decision 2 lists "limit 22 500 FR at 12.00%" among the constants to honour
exactly, and this table honours only the rate.** The multiple reproduces 22 500 at the standard
start and nowhere else: it scales with income, so a country twice as rich borrows twice as much.
That is a deliberate deviation from a binding constant and it is the only one in this spec. It was
question 0 at the approval gate, and §0-A ruling 2 answered it: the multiple ships (§21.1).

| Constant | Value | Label |
| --- | --- | --- |
| `DEBT_SHORTFALL_RATING_MAX` | 10 rating points | INVENTED |
| `DEBT_AUTO_SERVICE` | default true | INVENTED |

### 2.10 States and flags

| Constant | Value | Label |
| --- | --- | --- |
| `MOB_STEP_BONUS_PP` | +10,00 on the military step only | SOURCED (Image 15) |
| `MOB_FR_MULT` | ×0,50 | SOURCED |
| `MOB_MIC_MULT` | ×2,00 | SOURCED |
| `MOB_GROWTH_PP` | −2,00 | SOURCED |
| `MOB_UNJUSTIFIED_RATING_PER_TURN` | −5 | INVENTED |
| `NAT_GROWTH_PP` | −0,75 | SOURCED (Image 14) |
| `NAT_RATING` | −4 | SOURCED |
| `NAT_INCOME_MAX_PCT` | 26,25 | SOURCED |
| `PRIV_GROWTH_MAX_PP` | +0,75 | SOURCED |
| `PRIV_FAIL_GROWTH_PP` | −0,25 | SOURCED |
| `PRIV_FAIL_RATING` | −2 | SOURCED |
| `ACTION_COOLDOWN_TURNS` | 2, tracked per action | SOURCED (Image 14) |
| `ROLL_MIN` / `ROLL_MAX` | 1 / 10 | SOURCED |
| `PRIV_SUCCESS_MIN_ROLL` | 6 | INVENTED |
| `ACTION_EFFECT_TURNS` | 2 | INVENTED |
| `NAT_CONTROL_SHIFT` | −3 | INVENTED |
| `PRIV_CONTROL_SHIFT` | +3 | INVENTED |
| `PRIV_DRAG_PCT` | 5,00 | INVENTED |
| `PRIV_DRAG_TURNS` | 3 | INVENTED |
| `CONCESSION_GROWTH_PP` | +1,50, once, not per grant | SOURCED value, INVENTED non-stacking |
| `CONCESSION_REGIONS` | Bengo, Aglan, Sudhara, Badiyat | SOURCED |

### 2.11 Resources

| Constant | Value | Label |
| --- | --- | --- |
| `RESOURCES` | coal, oil, fibre, ferrous, nonferrous, rubber, chemical, precious | SOURCED (Image 11) |
| `RESOURCE_CATEGORIES` | fuel: coal, oil / raw: fibre, ferrous, nonferrous, rubber, chemical / luxury: precious | SOURCED (Image 11) |
| `DEPOSIT_YIELD_UNITS` | 50 units per deposit per turn | SOURCED |
| `DEPENDENCY_MATRIX` | §13.2 | SOURCED |

### 2.12 Engine

| Constant | Value | Label |
| --- | --- | --- |
| `TURN_HISTORY_MAX` | 12 turns | INVENTED |
| `PCT_STORE_DECIMALS` | 4 | INVENTED |
| `PCT_DISPLAY_DECIMALS` | 2 | SOURCED (every screenshot shows 2) |
| `POINT_DECIMALS` | 2 | SOURCED (Image 5) |
| `ECONOMY_SCHEMA_VERSION` | 1 | — |

---

## 3. Rounding and numeric hygiene

**INVENTED, all of it.** The sources show 2-decimal display and nothing else.

- **Internal arithmetic runs at full IEEE-754 double precision with no intermediate rounding.**
  Rounding happens only where a value is *stored* in the turn record or *displayed*.
- The rounding helper is symmetric half-up on the magnitude:
  `round(x, d) = sign(x) * Math.round(Math.abs(x) * 10^d) / 10^d`.
  `Math.round` alone breaks ties upward, so `−0,125` would become `−0,12` and `+0,125`
  `+0,13`. Symmetry matters because growth and rating deltas are signed.
- Stored precision: percentages `PCT_STORE_DECIMALS` = 4; FR and MIC points
  `POINT_DECIMALS` = 2; obor amounts whole; resource units whole; rating and control-scale
  positions whole integers.
- Displayed precision: percentages 2 decimals, points 2 decimals, obor with thousands
  separators and no decimals.
- **A rounded value is never an input to further arithmetic.** Stored and displayed precision is
  a *view*. `finalPct` is stored at 4 decimals in `SectorDerived`, but `gdpNextObor` is computed
  from the unrounded `finalPct` that the same derive pass produced, never from the stored view.
  Reading the stored 4-decimal value back would give heavy industry
  30 000 000 × 1,013922 = 30 417 660 instead of the correct 30 417 668, and the §19 fixture
  would fail against its own numbers. There is exactly one exception, and it is deliberate:
  `gdpNextObor` is rounded to whole obor and the total is then the sum of the rounded parts
  (§5.5), because the parts must add up to the total a player reads.
- The screenshots confirm the "full precision inside, round for display" policy. Image 1 shows
  agriculture at 1,45% final growth and a GDP change of 290 594 on 20 000 000, which is
  1,45297%. The displayed 1,45% is a rounded view of a number the sheet kept in full.

**Non-finite numbers must never reach the store.** `sanitizeRecord` in
`src/state/schema.ts` **drops** a key whose value is `NaN` or `±Infinity` — the field does not
become `null`, it disappears, and the next load reads it as absent. Every value the engine
writes goes through a `finiteOr(x, fallback)` guard. Likewise `undefined` is dropped: absent
values in the economy document are `null`, never `undefined`, and no `Map` or `Set` may appear
in it.

---

## 4. GDP and the sectors

### 4.1 Sector set

Five base sectors with fixed keys. **The set of five and their meanings are SOURCED. The display
order below is INVENTED** — the only sourced order is Image 1's, which runs heavy industry, light
industry, agriculture, commercial, mining. This spec orders them agriculture, light, heavy,
commercial, extraction because that reads as a progression from primary to tertiary. Nothing in
the engine depends on the order; it is a display convention only.

| Key | Label | Covers |
| --- | --- | --- |
| `agriculture` | Agriculture | Farms, food production |
| `lightIndustry` | Light industry | Civilian and household manufacture |
| `heavyIndustry` | Heavy industry | Military and high-technology manufacture |
| `commercial` | Commercial | Finance, investment, services, tourism |
| `extraction` | Extraction | Mining enterprises |

Plus at most two custom sectors, `other1` and `other2`. **SOURCED.** Each carries a `name` and
a `grounds` string. `grounds` must be non-empty for the sector to exist at all — the rulebook
requires "weighty grounds" — so creating an Other sector is **[V]**, not [P]. An Other sector
has **no resource dependency** (**INVENTED**, corroborated by Image 1, where the two `Иное`
rows grew at full rate while four resource-dependent sectors were zeroed by shortage).

### 4.2 Totals

```
gdpTotal        = Σ over all present sectors of sector.gdpObor          [obor]
sectorShare(s)  = gdpTotal > 0 ? sector.gdpObor / gdpTotal : 0          [fraction]
```

**SOURCED** — Image 1's footer says total GDP is computed from the sector volumes, never
entered.

Guard: `gdpTotal === 0` gives every share 0 and every ratio that divides by GDP the value 0.
Nothing throws and nothing returns `NaN`.

### 4.2a Sector volumes are frozen for the whole turn

**Every derived quantity in a turn reads `sector.gdpObor` and `gdpTotal` as they stood at the
start of the turn.** No step of the pipeline mutates `sector.gdpObor`. Step 12 computes a
*separate* `gdpNextObor` per sector and step 15 commits it, so a within-turn read can never
observe a half-updated economy. **INVENTED, and it is the rule that makes the pipeline
order-independent for reads.**

This matters in exactly one place: a concession grant reduces a sector's volume. That reduction
is booked against the step-12 next-turn volumes, never against the start-of-turn volumes
(§15.3). So `gdpTotal` is one number for the whole turn, and the eight quantities that divide by
it — sector shares, `plannedGrowthPct`, `frTaxBase`, `micGenerated`, `reserveShare`, the
auto-investment share, `overallGrowthPct` and the resource `needUnits` — all see the same
number.

### 4.3 Fields

| Field | Tag | Range / unit | Note |
| --- | --- | --- | --- |
| `sector.gdpObor` | [V] | ≥ 0, whole obor | Only a verdict moves a sector's volume directly. The engine moves it every turn through growth. |
| `sector.growthPermanentPct` | [V] | −100..+100 | `Пост. рост` |
| `sector.growthTemporaryPct` | [V] | −100..+100 | `Врем. рост`. Cleared at turn end. |
| `sector.growthFinalPct` | [A] | — | §5 |
| `other.name` | [P] | ≤ 60 chars | |
| `other.grounds` | [V] | non-empty ≤ 400 chars | The sector does not exist without it |
| `gdpTotalObor` | [A] | — | |
| `gdpNextObor` | [A] | — | §5.5 |

---

## 5. GDP growth

### 5.1 The three columns

**SOURCED** that there are three: permanent, temporary, final, and that only final drives GDP
(Images 1, 2). **INVENTED**: how they combine, which the sources never state.

```
sectorBasePct(s) = s.growthPermanentPct + s.growthTemporaryPct        [pp]
```

Temporary growth is a one-off. The pipeline clears it at turn end (§16, step 14).

### 5.2 The global modifier sum

Every modifier except the resource shortage applies equally to every sector. One sum, computed
once per turn. **INVENTED structure**, every term individually sourced or marked below.

```
modifierPp =
    controlGrowthPp                  §7    INVENTED magnitude, SOURCED direction
  + mobilizationGrowthPp             §15.1 SOURCED  (−2,00 when mobilized, else 0)
  + concessionGrowthPp               §15.3 SOURCED  (+1,50 when a concession is in force)
  + timedModifierPp                  §15.2 sum of the active timed modifiers
  + autoInvestGrowthPp               §9.3  INVENTED
  − reservePenaltyPp                 §9.1  SOURCED ratio, INVENTED base
  − inflationGrowthPp                §10   INVENTED
  − defenceGrowthPp                  §11   INVENTED
```

### 5.3 Pre-shortage and final growth

```
preShortagePct(s) = sectorBasePct(s) + modifierPp                              [pp]

finalPct(s) = preShortagePct(s) > 0
            ? preShortagePct(s) * (1 − shortagePenalty(s))
            : preShortagePct(s)
```

with `shortagePenalty(s) ∈ [0, 1]` from §13.4.

**SOURCED**: "a shortage at worst zeroes growth in the affected sectors; a shortage on its own
can never drive growth negative." The multiplicative form satisfies both halves exactly. A
full shortage gives 0, never a negative, and a sector already shrinking is untouched by
shortage, so the shortage cannot deepen a contraction.

Then clamp: `finalPct(s) = max(SECTOR_GROWTH_FLOOR_PCT, finalPct(s))`, so a sector's volume
can reach 0 but never go below it. **INVENTED guard.**

### 5.4 The overall rate

```
overallGrowthPct = gdpTotal > 0 ? Σ (s.gdpObor * finalPct(s)) / gdpTotal : 0
```

A GDP-weighted mean. **SOURCED**, and confirmed by arithmetic: Image 1 shows one sector of
20 000 000 at 1,45% out of 100 000 000 total, and an overall rate of 0,29% —
`20 000 000 × 1,45% / 100 000 000 = 0,29%` exactly. A plain mean would give 0,207%.

The weighted mean has a property the engine relies on: the sum of the grown sectors equals the
total grown at the overall rate, up to rounding. That is a cheap self-check in the tests.

### 5.5 Applying growth

```
gdpNext(s)   = round(s.gdpObor * (1 + finalPct(s) / 100), 0)     clamped to ≥ 0
gdpNextTotal = Σ gdpNext(s)
gdpChange    = gdpNextTotal − gdpTotal
```

Rounding to whole obor happens per sector, and the total is the sum of the rounded sectors.
Rounding the total independently would let the total disagree with its own parts.

### 5.6 What makes growth negative

Only these, and never a resource shortage:

- a negative `growthPermanentPct` or `growthTemporaryPct` set by verdict;
- the control-scale penalty on the planning side (down to −2,50 pp);
- mobilization (−2,00 pp);
- the emission inflation penalty (down to −7,50 pp at 50% emission);
- the FR reserve penalty (down to about −1,20 pp at a full reserve);
- the defence penalty (down to −5,00 pp at 60% military spending);
- nationalization (−0,75 pp) or a failed privatization (−0,25 pp);
- any negative timed modifier a verdict created.

### 5.7 Planned growth — the anti-circularity device

FR and MIC generation take growth as an input (**SOURCED**), and growth takes unspent FR and MIC
as an input (**SOURCED**). That is a cycle. The engine breaks it with a pre-modifier quantity:

```
plannedGrowthPct = gdpTotal > 0 ? Σ (s.gdpObor * sectorBasePct(s)) / gdpTotal : 0
```

**INVENTED.** `plannedGrowthPct` depends only on the sector volumes and the two growth columns.
It cannot depend on FR, MIC, reserves, emission, the control band or the shortage, so generation
can read it with no fixed-point iteration and no previous-turn history. `overallGrowthPct` — the
realised rate — is never an input to generation.

---

## 6. Credit rating

### 6.1 Score and tier

`ratingScore` is an integer 0..100. **SOURCED** (Image 3). The tier is the band containing it:

| Tier | Points | Condition |
| --- | --- | --- |
| A+ | 95–100 | excellent |
| A | 85–94 | good |
| B | 70–84 | stable |
| C | 50–69 | doubtful |
| D | 30–49 | stagnation |
| E | 10–29 | crisis |
| F | 0–9 | default |

Contiguous, exhaustive, no gaps. **SOURCED.**

### 6.2 What moves it

`ratingScore` is **[V]** — a verdict sets it. On top of that the engine applies deltas each
turn, and their sum is clamped into 0..100:

```
ratingNext = clamp(ratingScore + Σ ratingDeltas, 0, 100)
```

| Delta | Value | Label |
| --- | --- | --- |
| Emission | `−round(EMISSION_RATING_COEFF × emissionPct, 0)` | INVENTED rate, SOURCED that the penalty exists (Image 10) |
| Nationalization | −4 | SOURCED |
| Failed privatization | −2 | SOURCED |
| Debt payment shortfall | §14.4 | INVENTED rate, SOURCED that it exists (Image 13) |
| Unjustified mobilization | −5 per turn | INVENTED |
| **Clean-turn recovery** | **`+RATING_RECOVERY_PER_TURN` = +1** | **INVENTED, added at the user's direction (§0-A ruling 1). §6.2a** |
| Verdict adjustment | any | SOURCED that verdicts are the main lever |

**Five engine-side deltas subtract and exactly one adds.** Emission, nationalization, a failed
privatization, a debt shortfall and an unjustified mobilization all subtract. The one that adds is
the clean-turn recovery in §6.2a, which the user added on review: without it the rating was a
one-way ratchet, so a country that once ran emission could never recover and a well-run economy
never earned an upgrade on its own.

The rulebook is explicit that the credit rating "cannot be changed by anything except verdicts"
(**SOURCED**). The engine already departed from that line five times over, in the downward
direction. The recovery is the same departure in the upward direction and to the same degree: it is
one small automatic delta, and it leaves the verdict lever untouched and authoritative. A judge can
still set `ratingScore` to any number at any time, and no engine delta can outrun that.

### 6.2a Automatic recovery on a clean turn

**INVENTED, added at the user's direction (§0-A ruling 1).**

```
cleanTurn      = emissionPct === 0
              && shortfallTotal === 0
              && overallGrowthPct > 0

ratingRecovery = cleanTurn ? RATING_RECOVERY_PER_TURN : 0            = +1 or 0
```

**The three clauses, named exactly.** All three must hold. Each is a quantity that already exists
elsewhere in this spec; the predicate introduces no new state.

- **No emission that turn** — `emissionPct === 0`. This turn's player input, not last turn's
  `emissionPctLast`. V1 guarantees `emissionPct ≥ 0`, so `=== 0` and `<= 0` agree and either may be
  implemented. Emission at any rate, however small, forfeits the recovery for that turn.
- **No missed debt payment** — `shortfallTotal === 0` from step 7 (§14.4). A country with no loans
  has `shortfallTotal` 0 and therefore qualifies: it has missed nothing. The test is on **this
  turn's** shortfall, never on the carried `debtStatus`, so a country sitting in `default` that pays
  in full earns its +1 on the same turn that clears its arrears — the same turn §14.4 lets it borrow
  again.
- **Strictly positive GDP growth after all modifiers** — `overallGrowthPct > 0`, the realised
  GDP-weighted rate from §5.4, computed after `modifierPp` and after the shortage factor. Exactly 0
  fails. Per §3 the test reads the **unrounded** value, because a rounded value is never an input to
  further arithmetic. It is **not** `plannedGrowthPct`, which ignores every modifier and would let a
  country recover through a year the modifiers wiped out. It is also **not** `gdpChangeObor > 0`: a
  concession can drive the obor change negative in a year the economy genuinely grew, and handing a
  province away is a booked transfer, not a growth failure.

**Where it runs: step 13, `rating`.** It depends on `shortfallTotal` from step 7 and on
`overallGrowthPct` from step 11, so it cannot be decided before growth is final and debt service is
resolved — and step 13 is the first step after both. No step moves and no new step is needed.

**How it interacts with the negative deltas.** The recovery is **one more term in the same sum**,
not a gate on the other deltas and not a separate pass:

```
ratingNext = clamp(ratingScore + Σ ratingDeltas, 0, 100)          §6.2, unchanged
```

with `+ratingRecovery` now among the `ratingDeltas`, carrying its own reason string. Two of the five
negative deltas cannot co-occur with it and four other lines can:

| Delta | Can it apply on a turn that also recovers? | Why |
| --- | --- | --- |
| Emission, `−0,40` per pp | **No** | clause 1 forces `emissionPct` to 0, and the penalty is then `round(0,40 × 0) = 0` |
| Debt shortfall, up to −10 | **No** | clause 2 forces `shortfallTotal` to 0, and §14.4 then yields 0 |
| Nationalization, −4 | **Yes** | nationalization is not in the predicate |
| Failed privatization, −2 | **Yes** | not in the predicate |
| Unjustified mobilization, −5 | **Yes** | not in the predicate. Mobilization's −2,00 pp makes clause 3 harder to satisfy, but it does not forbid it |
| Verdict adjustment | **Yes** | a judge's number is authoritative and untouched |

So recovery and a penalty **can** both apply in the same turn, and **the net is plain addition**. A
clean turn that also nationalises is `−4 + 1 = −3`. A clean turn under an unjustified mobilization
is `−5 + 1 = −4`. A clean turn with a judge's −10 verdict is −9. A clean turn with nothing else is
**+1**. The recovery never cancels a penalty and is never cancelled by one; every delta is summed
and the sum is clamped once.

**The clamp is unchanged and it is the only bound.** `clamp(…, RATING_MIN, RATING_MAX)` = 0..100
applies to the sum, exactly as in §6.2. At `ratingScore` 100 a clean turn adds nothing, because
`clamp(101, 0, 100) = 100`. Recovery can never manufacture a score above 100 and never a tier above
A+, and it can never lift a score that the same turn's penalties drove below 0 — the clamp sees the
sum, not the terms.

**Pace.** +1 a turn against −2 for a 5% emission, −4 for a nationalization and up to −10 for a full
default. The road back exists and it is slow: climbing the 20 points from the bottom of tier C to
the bottom of tier B takes 20 consecutive clean turns, which is longer than most games run. The
judge's verdict remains the fast lever, and the rulebook's line about verdicts still describes who
owns the large moves.

### 6.3 The FR contribution

```
ratingFactor = 1 + RATING_FR_SLOPE × (ratingScore − RATING_FR_PIVOT)
             = 1 + 0,01 × (ratingScore − 70)
```

Range 0,30 at rating 0 to 1,30 at rating 100, and exactly 1,00 at the standard start's 70.
**INVENTED.** Linear, one multiplication, and no clamp is needed because the input is already
bounded. Anchoring the pivot at 70 makes the standard start read as "no rating adjustment",
which is what makes the rest of the FR block legible.

### 6.4 Fields

| Field | Tag | Range |
| --- | --- | --- |
| `ratingScore` | [V] | integer 0..100 |
| `ratingTier` | [A] | A+ … F |
| `ratingFactor` | [A] | 0,30..1,30 |
| `ratingNext` | [A] | integer 0..100 |
| `ratingDeltas[]` | [A] | signed integers with a reason string |
| `ratingCleanTurn` | [A] | boolean, the §6.2a predicate |
| `ratingRecovery` | [A] | 0 or +1, and it also appears as a line in `ratingDeltas[]` |

---

## 7. State control scale

### 7.1 Bands

`controlPosition` is an integer 0..100, **[V]**. **SOURCED**: below 50 leans to planning, above
50 to the market, 50 is neutral with neither bonus nor debuff, and the 11 bands are exactly
those below (Image 4).

Three effects are generated from the band index `i`, where `i = 5` is band 50:

```
controlGrowthPp     = CONTROL_GROWTH_STEP_PP × (i − 5)      = 0,50 × (i − 5)
controlFrMultiplier = 1 − CONTROL_FR_STEP × (i − 5)         = 1 − 0,10 × (i − 5)
stepLimitPp         = STEP_LIMIT_NEUTRAL_PP − CONTROL_STEP_SLOPE_PP × (i − 5)
                    = 10,00 − 1,50 × (i − 5)
```

**INVENTED magnitudes, SOURCED directions and SOURCED anchor.** The rulebook: the closer to
planning, the slower the economy grows on its own and the more free funds the player holds; the
closer to the market, the faster it grows and the fewer free funds. Band 50 is neutral, and its
step limit is 10,00 pp on both emission and military spending. All three formulas return the
neutral value at `i = 5` by construction.

| i | Band | Name (INVENTED) | Growth | FR × | Step |
| --- | --- | --- | --- | --- | --- |
| 0 | 0–5 | Total control | −2,50 pp | 1,50 | 17,50 pp |
| 1 | 6–20 | Command economy | −2,00 pp | 1,40 | 16,00 pp |
| 2 | 21–30 | Heavy dirigisme | −1,50 pp | 1,30 | 14,50 pp |
| 3 | 31–44 | Dirigisme | −1,00 pp | 1,20 | 13,00 pp |
| 4 | 45–49 | Guided market | −0,50 pp | 1,10 | 11,50 pp |
| **5** | **50** | **Policy of balance** | **0,00 pp** | **1,00** | **10,00 pp** |
| 6 | 51–55 | Regulated market | +0,50 pp | 0,90 | 8,50 pp |
| 7 | 56–69 | Social market | +1,00 pp | 0,80 | 7,00 pp |
| 8 | 70–79 | Free market | +1,50 pp | 0,70 | 5,50 pp |
| 9 | 80–94 | Laissez-faire | +2,00 pp | 0,60 | 4,00 pp |
| 10 | 95–100 | Minarchism | +2,50 pp | 0,50 | 2,50 pp |

"Policy of balance" is the sourced name for band 50 (Image 4). The other ten names are
**INVENTED** — the calculator renders only the occupied band, so the rest were never visible.

The FR multiplier is the "more free funds under planning" rule, and it is the *only* place the
control scale touches the budget. MIC generation carries no control multiplier: the rulebook ties
the scale to growth and to free funds, and MIC comes from the military share and heavy industry.
**INVENTED omission**, stated so nobody adds one by accident.

### 7.2 Lockouts

**SOURCED** that some level of regulation or deregulation closes nationalization and
privatization off. The thresholds are **INVENTED**:

- nationalization is unavailable while `i === NAT_LOCK_BAND_INDEX` (position 0..5) — everything
  worth seizing is already state-owned;
- privatization is unavailable while `i === PRIV_LOCK_BAND_INDEX` (position 95..100) — there is
  nothing left in state hands.

### 7.3 Fields

| Field | Tag | Range |
| --- | --- | --- |
| `controlPosition` | [V] | integer 0..100 |
| `controlBandIndex` / `controlBandName` | [A] | 0..10 / string |
| `controlGrowthPp`, `controlFrMultiplier`, `stepLimitPp` | [A] | per the table |
| `controlNext` | [A] | integer 0..100, after any nat/priv shift |

---

## 8. Spending points

### 8.1 FR generation

**SOURCED** inputs: the credit rating, the degree of state intervention, GDP, GDP growth, and
whether the player is running emission, plus a regime multiplier and a light-industry-share
bonus. **INVENTED** assembly:

```
frTaxBase      = (gdpTotal / OBOR_PER_FR_POINT) × FR_TAX_RATE                     [points]
frGrowthFactor = clamp(1 + FR_GROWTH_COEFF × plannedGrowthPct,
                       FR_GROWTH_FACTOR_MIN, FR_GROWTH_FACTOR_MAX)
frDefenceDrag  = max(MILITARY_FR_DRAG_FLOOR,
                     1 − MILITARY_FR_DRAG × militaryPct / 100)
frLightBonus   = FR_LIGHT_BONUS_COEFF × sectorShare(lightIndustry)

frCore     = frTaxBase
           × ratingFactor
           × controlFrMultiplier
           × frGrowthFactor
           × frDefenceDrag
           × (1 + frLightBonus)
           × privatizationFrDrag                        (§15.2, 0,95 while active, else 1)

frEmission = (gdpTotal / OBOR_PER_FR_POINT) × EMISSION_FR_RATE × (emissionPct / 100)

frGenerated = (frCore + frEmission) × frRegimeMultiplier
```

Reading it in words: the state taxes a fifth of the economy; a good rating, a planned economy
and a growing economy each raise the take; the military share of the economy does not generate
FR at all, which is the sourced "military spending lowers FR generation"; a large light-industry
sector adds a little; emission prints new money in proportion to GDP; mobilization halves the
lot.

`frLightBonus`'s coefficient is **INVENTED, anchored on Image 5**, which reads a light-industry
FR bonus of 5,00% at the standard start where light industry is 20% of GDP. 0,25 × 0,20 = 0,05
closes exactly — but so do "5,00% flat", "share ÷ 4" and "1,25 × share²", and every other
one-parameter family through a single point. The anchor makes 0,25 a defensible choice, not a
recovered fact, and PLAN section 3 decision 2 forbids curve-fitting this cell. What does support
the reading beyond the one cell: the MIC side falls out at 0,50 by the same rule, and the two
bonuses standing in a 1:2 ratio is the sort of round relationship a designer writes.

Emission enters **additively, not as a multiplier**, because printing money creates new money
proportional to the money base, not proportional to the tax take. It also means emission's FR
gain is unaffected by a bad rating, which is thematically right — a printing press does not
need a creditor.

### 8.2 MIC generation

**SOURCED** inputs: GDP, GDP growth, the military spending percentage, a heavy-industry-share
bonus and a regime multiplier. **INVENTED** assembly:

```
micHeavyBonus = MIC_HEAVY_BONUS_COEFF × sectorShare(heavyIndustry)

micGenerated  = (gdpTotal / OBOR_PER_MIC_POINT)
              × (militaryPct / 100)
              × frGrowthFactor                     (the same clamped growth factor)
              × (1 + micHeavyBonus)
              × privatizationMicDrag               (§15.2, 0,95 while active, else 1)
              × micRegimeMultiplier
```

`micHeavyBonus`'s coefficient is **INVENTED, anchored on Image 5** the same way and with the same
caveat: the image reads 10,00% at a 20% heavy share, and 0,50 × 0,20 = 0,10 closes on that one
point.

### 8.3 Points do not carry over

**SOURCED.** Neither FR nor MIC accumulates by itself. Every point left at turn end counts as
invested and raises growth a little (§9.3). The opt-in alternative is savings (§9).

### 8.4 The ledgers

**Every quantity in a ledger is an *applied* quantity — the amount that actually moved, never the
amount the player typed.** Three player inputs are clipped before they reach a ledger:
`reserveAdd` and `reserveWithdraw` by the cap policy (§9.1), and `micStockWithdraw` by the stock
(§9.2). The clipped forms carry the suffix `Applied` and they are the only forms that appear
below. Charging an unclipped `reserveAdd` would take FR for a deposit the cap policy refused;
crediting an unclipped `micStockWithdraw` would spend materiel that was never in the stockpile.

```
frOtherIncome = Σ frIncomeLines[].points                            §8.6
micOtherIncome = Σ micIncomeLines[].points                          §8.6

frAvailable = frGenerated                                           §8.1, step 3
            + nationalizationFrPayout                               §15.2, step 4
            + newLoanProceeds                                       §14.2, step 5
            + reserveWithdrawApplied                                §9.1,  step 6
            + frOtherIncome                                         §8.6,  step 9

frSpent     = reserveAddApplied                                     §9.1,  step 6
            + debtAllocatedTotal                                    §14.3, step 7
            + micUpkeepPaid                                         §9.2,  step 8
            + Σ frExpenseLines[].points                             §8.5,  step 9

frRemainder = frAvailable − frSpent

micAvailable = micGenerated                                         §8.2,  step 3
             + nationalizationMicPayout                             §15.2, step 4
             + micStockWithdrawApplied                              §9.2,  step 6
             + micOtherIncome                                       §8.6,  step 9

micSpent     = micStockAdd                                          §9.2,  step 6
             + Σ micExpenseLines[].points                           §8.5,  step 9

micRemainder = micAvailable − micSpent
```

Both remainders must be ≥ 0. A negative remainder is a **validation error**, not a silent
clamp: End Turn refuses to run and the panel says which ledger is over (§17).

### 8.4a The running FR balance

`frAvailable` and `frSpent` above are the closing *summary* of the turn. Two steps also need to know
how much FR is left **at the moment they run**, because they clip what they pay to what remains:
debt service (step 7) and MIC upkeep (step 8). No other step does. One named quantity serves both.
**INVENTED, and it is the definition the spec previously left as the undefined names
`frStillAvailable` and `frAvailableForUpkeep`.**

```
frBalance₀ = frGenerated                                            after step 3
frBalance₄ = frBalance₀ + nationalizationFrPayout                   after step 4
frBalance₅ = frBalance₄ + newLoanProceeds                           after step 5
frBalance₆ = frBalance₅ + reserveWithdrawApplied − reserveAddApplied   after step 6
frBalance₇ = frBalance₆ − debtAllocatedTotal                        after step 7
frBalance₈ = frBalance₇ − micUpkeepPaid                             after step 8
frBalance₉ = frBalance₈ + frOtherIncome − Σ frExpenseLines[].points  after step 9

frRemainder = frBalance₉
```

The last line is an identity, not a second definition: the credit and debit terms of `frBalance₉`
are exactly the terms of `frAvailable − frSpent`, in a different order. An implementation may
compute either and must get the same number. T11-B asserts the identity in a test.

The two previously undefined names resolve to:

```
frStillAvailable(l)  = frBalance₆ − Σ allocatedFr(k) for every loan k serviced before l
frAvailableForUpkeep = frBalance₇
```

Loans are serviced in `loans[]` order (§14.3), so `frStillAvailable` falls as the list is walked
and the first loans are paid in full before the last one is starved.

**Which charges are already deducted when a step runs.** This is the whole content of the
ordering decision, so it is a table and not a sentence:

| Running at | `reserveAddApplied` | `debtAllocatedTotal` | `micUpkeepPaid` | `frExpenseLines` |
| --- | --- | --- | --- | --- |
| step 6 `savings` | being computed | not yet | not yet | not yet |
| step 7 `debt-service` | **deducted** | being computed | not yet | not yet |
| step 8 `upkeep` | **deducted** | **deducted** | being computed | not yet |
| step 9 `spending` | **deducted** | **deducted** | **deducted** | being computed |

So a reserve addition is charged **before** debt service and MIC upkeep, and discretionary
expense lines are charged **after** both. Two consequences, both intended:

- **A large reserve addition can starve an auto-serviced loan** and produce a shortfall, with its
  rating penalty. That is the same choice `debtAutoService = false` already offers explicitly
  (§14.3), reached by a different route. Warning V17 fires, so the shortfall is never silent, and
  V14 fires as well if the addition was also clipped. It is the cheapest way to reach the arrears
  path in a test (§17, note on reachability).
- **Discretionary spending can never starve a mandatory charge.** Overspending the discretionary
  ledger drives `frRemainder` negative and aborts the turn at validation instead, so a player
  cannot lose MIC points or default by booking an order they cannot afford.

The alternative — charge reserve additions last, alongside the expense lines — was considered and
rejected: the reserve *stock* must be final before growth resolves (SOURCED, §9.1), so the
addition has to be decided at step 6, and deciding it there while charging it at step 9 means
step 6 commits to a deposit whose affordability is still unknown.

### 8.5 Expense lines

`frExpenseLines[]` and `micExpenseLines[]` are the year's discretionary ledger: at most 24 lines
each, every `points ≥ 0`. **Lines are never signed.** A negative line would be an income channel
smuggled into an expense list, and income has its own list (§8.6). They are **not** cleared at
turn end (§16.2, step 14) — they are the record of what the year bought, and the history shows
them. The panel offers "clear all lines" as a button.

### 8.6 Income lines

**INVENTED.** The mirror of §8.5, same shape and same cap: `frIncomeLines[]` and
`micIncomeLines[]`, at most 24 lines each, `points ≥ 0`, **[P]**.

They exist because the engine has to be able to represent money coming *in* from a deal it does
not model. The concrete case is the resource exchange (§13.5): `exports(r)` gives resources away,
and without an income channel the player receives nothing the engine can express, which makes
`exports` a lever no rational player ever touches. The same list also carries a sale of any other
kind, and a judge-granted cash grant that is not a nationalization payout.

An income line is [P] and unbounded above, exactly as `importsRequested(r)` is [P] and unbounded
above. The engine trusts the player to book both halves of a concluded deal, and the judge audits
the wall. That trust is already load-bearing on the purchase side, so the sale side adds no new
exposure.

### 8.7 Fields

| Field | Tag | Unit |
| --- | --- | --- |
| `emissionPct`, `militaryPct` | [P] | percent, §10, §11 |
| `frExpenseLines[]` (`label`, `points`) | [P] | ≤ 24 lines, points ≥ 0 |
| `micExpenseLines[]` (`label`, `points`) | [P] | ≤ 24 lines, points ≥ 0 |
| `frIncomeLines[]` (`label`, `points`) | [P] | ≤ 24 lines, points ≥ 0 |
| `micIncomeLines[]` (`label`, `points`) | [P] | ≤ 24 lines, points ≥ 0 |
| `frGenerated`, `frAvailable`, `frSpent`, `frRemainder`, `frOtherIncome` | [A] | FR points |
| `micGenerated`, `micAvailable`, `micSpent`, `micRemainder`, `micOtherIncome` | [A] | MIC points |
| `frRegimeMultiplier`, `micRegimeMultiplier` | [A] | ×0,5 / ×1 / ×2 |
| `frLightBonus`, `micHeavyBonus` | [A] | fraction |

---

## 9. Savings

### 9.1 FR reserves

```
reserveCap    = RESERVE_CAP_MULTIPLE × frGenerated                = 2 × frGenerated
reserveEnd    = reserveStart + reserveAddApplied − reserveWithdrawApplied
```

**SOURCED** (Image 8): the cap is two annual incomes; the stock survives a cap that falls below
it; new additions are blocked while the stock is over the cap; the penalty is assessed on the
end-of-turn stock.

```
reserveWithdrawApplied = min(reserveWithdraw, reserveStart)
reserveAddApplied      = reserveStart > reserveCap
                       ? 0
                       : min(reserveAdd, max(0, reserveCap − reserveStart))
```

So an addition is blocked entirely while over the cap, and otherwise clipped to the headroom.
Both clips raise a warning in the turn record rather than failing the turn. **INVENTED
clipping detail**, SOURCED policy. `reserveAddApplied` and `reserveWithdrawApplied` are the only
reserve quantities the ledgers and the running balance ever see (§8.4, §8.4a); the raw
`reserveAdd` and `reserveWithdraw` are player inputs and appear nowhere else.

The addition is charged against the running FR balance at step 6, before debt service and MIC
upkeep. §8.4a states the order and its consequences.

The penalty:

```
reserveShare      = gdpTotal > 0 ? reserveEnd × OBOR_PER_FR_POINT / gdpTotal : 0
reservePenaltyPp  = RESERVE_PENALTY_MULTIPLE × INVEST_GROWTH_COEFF × reserveShare
                  = 1,50 × 2,00 × reserveShare
                  = 3,00 × reserveShare
```

**SOURCED**: each saved FR point cuts growth 1,5 times as hard as the same point would have
raised growth through auto-investment. That fixes the penalty as `1,5 ×` the auto-investment
coefficient and nothing else — which is why `INVEST_GROWTH_COEFF` is the single tuning knob for
both directions. **INVENTED**: the base coefficient of 2,00.

At the cap the penalty is bounded. A full reserve is 2 annual incomes ≈ 40% of GDP in obor, so
the worst case is about −1,20 pp. Hoarding is a real cost and never a death sentence.

### 9.2 MIC stockpiles

**SOURCED** (Image 9): no cap, upkeep is 2 FR per stockpiled point per turn, and unmaintained
stockpiles are lost.

```
micStockWithdrawApplied = min(micStockWithdraw, micStockStart)
micStockEnd             = micStockStart + micStockAdd − micStockWithdrawApplied
micUpkeepDue            = MIC_UPKEEP_FR_PER_POINT × micStockEnd         [FR points]
```

`micStockWithdrawApplied` is the clipped form, and it is what §8.4's `micAvailable` credits. A
player cannot draw materiel out of a stockpile that does not hold it. The clip raises warning V15
rather than failing the turn. **INVENTED clipping detail**, SOURCED policy.

Upkeep is paid in FR at pipeline step 8, out of `frAvailableForUpkeep` = `frBalance₇`, the balance
left after debt service (§8.4a). If it cannot cover the whole stockpile:

```
micPointsPaidFor = floor(frAvailableForUpkeep / MIC_UPKEEP_FR_PER_POINT)
micStockLost     = max(0, micStockEnd − micPointsPaidFor)
micStockEnd     := micStockEnd − micStockLost
micUpkeepPaid    = MIC_UPKEEP_FR_PER_POINT × micStockEnd
```

`floor` is deliberate: a point is either maintained for its full 2 FR or it is lost. Because
`micUpkeepPaid` is recomputed from the surviving stock, `micUpkeepPaid ≤ frAvailableForUpkeep`
always holds, so upkeep can never push the balance negative.

**INVENTED**: you keep exactly the points you could pay for and lose the rest. The rulebook says
only "they will be lost", and PLAN reads as a total loss. Losing the entire stockpile over a 2-FR
gap would be the most punishing rule in the game and would make a stockpile unusable near the
budget edge. It was question 6 at the approval gate, and §0-A ruling 4 answered it: the partial loss
ships, so a country keeps exactly the points its budget covered (§21.2).

### 9.3 Auto-investment

**SOURCED** that unspent FR and MIC count as invested at year end and raise growth "though not
by much". **INVENTED** rate:

```
investedObor       = frRemainder × OBOR_PER_FR_POINT
                   + micRemainder × OBOR_PER_MIC_POINT
autoInvestGrowthPp = gdpTotal > 0
                   ? INVEST_GROWTH_COEFF × (investedObor / gdpTotal)
                   : 0
```

Leaving a whole tax take unspent — 20% of GDP — buys +0,40 pp. That is "not by much" and still
worth having. The remainders are then discarded (§8.3).

### 9.4 Fields

| Field | Tag | Unit |
| --- | --- | --- |
| `reserveStart`, `reserveCap`, `reserveEnd`, `reservePenaltyPp` | [A] | FR points / pp |
| `reserveAdd`, `reserveWithdraw` | [P] | FR points ≥ 0 |
| `reserveAddApplied`, `reserveWithdrawApplied` | [A] | FR points ≥ 0, the clipped forms |
| `micStockStart`, `micStockEnd`, `micUpkeepDue`, `micUpkeepPaid`, `micStockLost` | [A] | MIC / FR points |
| `micStockAdd`, `micStockWithdraw` | [P] | MIC points ≥ 0 |
| `micStockWithdrawApplied` | [A] | MIC points ≥ 0, the clipped form |
| `autoInvestGrowthPp` | [A] | pp |

---

## 10. Emission

`emissionPct` is **[P]**, range 0,00..`EMISSION_PCT_MAX` (50,00), and every turn's change is
capped by the step (§12).

Three effects, all **SOURCED in kind** and **INVENTED in rate**:

```
frEmission        = (gdpTotal / OBOR_PER_FR_POINT) × EMISSION_FR_RATE × emissionPct / 100
inflationPct      = EMISSION_INFLATION_COEFF × emissionPct
inflationGrowthPp = INFLATION_GROWTH_COEFF × inflationPct
emissionRatingPenalty = round(EMISSION_RATING_COEFF × emissionPct, 0)
```

At 0% all four are 0, which matches every screenshot. At 10% emission: +5 000 FR points on the
standard start, 15% inflation, −1,50 pp growth, −4 rating points per turn. At the 50% ceiling:
75% inflation, −7,50 pp growth, −20 rating per turn — two tier drops a year. Emission is
therefore self-limiting without any extra rule, which is the point of the ceiling being
generous.

**Inflation is a per-turn derived value, not a stock. INVENTED.** A decaying inflation stock was
considered and rejected: it doubles the state a player has to reason about, it makes a single
bad turn punish five, and nothing in the sources implies persistence. Dropping emission to 0
clears inflation the same turn.

| Field | Tag | Range |
| --- | --- | --- |
| `emissionPct` | [P] | 0,00..50,00, step-capped |
| `emissionPctLast` | [A] | last turn's value, kept for the step check |
| `inflationPct`, `inflationGrowthPp`, `emissionRatingPenalty`, `frEmission` | [A] | — |

---

## 11. Military spending

`militaryPct` is **[P]**, range 0,00..`MILITARY_PCT_MAX` (60,00), step-capped (§12).

```
micGenerated       ∝ militaryPct / 100                        §8.2   SOURCED in kind
frDefenceDrag       = max(0,10, 1 − militaryPct / 100)        §8.1   INVENTED
defenceGrowthPp     = DEFENCE_GROWTH_COEFF × max(0, militaryPct − MILITARY_FREE_PCT)
```

The FR drag reads as one sentence: **the military share of the economy is the share that does
not generate FR.** That is exactly the rulebook's reason ("FR is generated from the part of the
economy free of military-industrial work"), with no extra coefficient.

`MILITARY_FREE_PCT` = 10 is **INVENTED, anchored on Image 10**, which shows a defence growth
penalty of 0,0% at 10% military spending — and 10% is the standard start. That is consistent with
10% being the penalty-free baseline, but it is equally consistent with a baseline of 0% and a
coefficient the image cannot resolve, because the observed penalty is 0,0% and every model reads 0
at its own baseline. The digest files this as NOT SPECIFIED and it is right to. The label is
INVENTED in §2.7 and here, in the same words, so the two places cannot drift. Above the baseline
the penalty is 0,10 pp per pp, reaching −5,00 pp at the 60% ceiling.

| Field | Tag | Range |
| --- | --- | --- |
| `militaryPct` | [P] | 0,00..60,00, step-capped |
| `militaryPctLast` | [A] | last turn's value |
| `defenceGrowthPp`, `frDefenceDrag` | [A] | — |

---

## 12. The step limit

**SOURCED**: the step is the maximum by which emission or military spending may move in one
turn, up or down; it is set by the control-scale position; it cannot be exceeded by any means
other than moving along the control scale, with mobilization the one exception; and at position
50 both limits are 10,00 pp (Images 10, 15).

```
emissionStepLimitPp = stepLimitPp                                        §7.1
militaryStepLimitPp = stepLimitPp + (mobilized ? MOB_STEP_BONUS_PP : 0)

abs(emissionPct − emissionPctLast) <= emissionStepLimitPp        must hold
abs(militaryPct − militaryPctLast) <= militaryStepLimitPp        must hold
```

**This is a hard cap, enforced as a validation error, not a clamp.** A clamp would silently
change what the player typed and then resolve a turn they did not intend. The panel rejects the
edit at input time and End Turn refuses to run if the invariant is broken.

The emission step and the military step are equal at position 50 (the only observed band) and
this spec keeps them equal at every band, differing only by the mobilization bonus. **INVENTED**
— the sources cannot say.

---

## 13. Resources

### 13.1 The eight resources

Three categories, eight resources. **SOURCED** (Image 11); the categories appear nowhere in the
prose.

| Category | Key | Label |
| --- | --- | --- |
| Fuel | `coal` | Coal |
| Fuel | `oil` | Oil |
| Raw materials | `fibre` | Fibre crops |
| Raw materials | `ferrous` | Ferrous metal ores |
| Raw materials | `nonferrous` | Non-ferrous metal ores |
| Raw materials | `rubber` | Rubber |
| Raw materials | `chemical` | Chemical feedstock |
| Luxury | `precious` | Precious metals / stones |

### 13.2 The dependency matrix — reproduced verbatim

The rulebook's own table, exactly as it gives it, with its own column order and its own shorter
resource names. **SOURCED, exact, do not reorder.**

|  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| Ресурс | Сельское Хозяйство | Тяж. Пром. | Легк. Пром. | Коммерческий сектор | Добывающий сектор |
| Уголь |  | ✅ | ✅ |  | ✅ |
| Нефть |  | ✅ |  |  |  |
| Волокнистые культуры | ✅ |  |  | ✅ |  |
| Черн. Металлы |  | ✅ | ✅ |  |  |
| Цвет. Металлы |  | ✅ | ✅ |  |  |
| Каучук |  | ✅ |  |  |  |
| Хим. сырье | ✅ | ✅ | ✅ |  |  |
| Драг. металлы/камни |  |  |  | ✅ |  |

As engine keys:

| Resource | Dependent sectors | Count |
| --- | --- | --- |
| `coal` | heavyIndustry, lightIndustry, extraction | 3 |
| `oil` | heavyIndustry | 1 |
| `fibre` | agriculture, commercial | 2 |
| `ferrous` | heavyIndustry, lightIndustry | 2 |
| `nonferrous` | heavyIndustry, lightIndustry | 2 |
| `rubber` | heavyIndustry | 1 |
| `chemical` | agriculture, heavyIndustry, lightIndustry | 3 |
| `precious` | commercial | 1 |

Inverted, per sector — this is the form the shortage maths uses:

| Sector | Resources it depends on |
| --- | --- |
| `agriculture` | fibre, chemical |
| `lightIndustry` | coal, ferrous, nonferrous, chemical |
| `heavyIndustry` | coal, oil, ferrous, nonferrous, rubber, chemical |
| `commercial` | fibre, precious |
| `extraction` | coal |
| `other1`, `other2` | none |

### 13.3 Requirement, supply, coverage

```
needUnits(r)      = ceil( Σ over dependent sectors s of s.gdpObor / OBOR_PER_RESOURCE_UNIT )
extraction(r)     = round(DEPOSIT_YIELD_UNITS × deposits(r) × (1 + extractionBonusPct(r)/100), 0)
imports(r)        = round(importsRequested(r) × (1 − blockadePct(r)/100), 0)
onHand(r)         = stock(r) + extraction(r) + imports(r)
exportsApplied(r) = min(exports(r), onHand(r))
supply(r)         = onHand(r) − exportsApplied(r)
coverage(r)       = needUnits(r) === 0 ? 1 : min(1, supply(r) / needUnits(r))
shortage(r)       = 1 − coverage(r)
free(r)           = max(0, supply(r) − needUnits(r))
stockNext(r)      = free(r)
```

`exportsApplied` is the clipped form, the same pattern as the reserve and the MIC stockpile: a
country cannot ship units it does not have. The clip raises warning V19 and `supply` is then
non-negative by construction, with no `max(0, …)` needed. **INVENTED**, and it replaces an earlier
form that floored `supply` at 0 and so absorbed an over-export in silence.

**SOURCED**: 1 unit backs 1 000 000 obor in each dependent sector; a deposit yields 50 units per
turn; the balance is `stock + extraction + imports` against `needed`, leaving `free` and a carry
to next year (Image 11). The requirement formula is confirmed by arithmetic at the standard
start — every one of the eight `Нужно` values is exactly 20 × the dependent-sector count, and
20 = 20 000 000 / 1 000 000.

`ceil` is **INVENTED**: a part-used unit still has to exist. It matches every observed value,
which are all whole by construction.

`extractionBonusPct` is **[V]** — the rulebook says extraction rises through orders that develop
the mining industry. `exports` is **INVENTED** as the mirror of imports (see §13.5).

### 13.4 Shortage

**SOURCED**: a shortage at worst zeroes the growth of the affected sectors and can never on its
own drive growth negative; the penalty per resource shrinks as more sectors depend on that
resource. **The coefficients are nowhere in the sources and are not recoverable from the
screenshots.** The digest is explicit that no simple model fits the one observed instance.
Everything below is **INVENTED**, and it satisfies both sourced properties exactly.

```
weight(r)        = 1 / dependentCount(r)
sectorPenalty(s) = Σ_{r ∈ deps(s)} weight(r) × shortage(r)
                 / Σ_{r ∈ deps(s)} weight(r)                      ∈ [0, 1]
```

Guard: a sector with no dependencies (`other1`, `other2`) divides by zero, so its penalty is
defined as 0.

Why this shape:

- **The normalisation is what bounds the penalty at 1.** A total shortage of everything a sector
  needs gives exactly 1, so `finalPct = preShortage × 0 = 0` — the sourced "at worst zeroes
  growth". Nothing can exceed 1, so the multiplicative form can never flip a sign.
- **`weight(r) = 1 / dependentCount(r)` is the sourced rule read literally.** A resource that
  three sectors need carries a third of the weight of one that a single sector needs. Missing
  oil (1 sector) hurts heavy industry 27,3%; missing coal (3 sectors) hurts it 9,1%.
- **A sector with many dependencies is more robust to any single gap.** Heavy industry's weights
  sum to 3,67, so losing one resource costs it a small fraction. Extraction depends on coal
  alone, so a coal gap passes straight through at 100%. That is a real strategic texture that
  comes free from the formula.
- **The sourced rule holds inside a sector and inverts across sectors, and that is deliberate.**
  "The more sectors depend on a resource, the smaller the penalty for lacking it" is exactly what
  `weight(r)` does within one sector's sum. Across sectors the normalisation reverses it: a coal
  gap (3 dependents) hits extraction at 100% while an oil gap (1 dependent) hits heavy industry at
  27,3%, because extraction has nothing else in its basket. Both readings cannot hold at once
  under any normalised weighting. This is the one place a SOURCED rule is satisfied only in the
  relative sense, so it is named at the approval gate (§21.3).
- It is one line, it needs no per-resource coefficient table, and every retuning knob is
  already in the matrix.

Per-sector denominators, precomputed:

| Sector | Σ weight |
| --- | --- |
| agriculture | 1/2 + 1/3 = 0,833333 |
| lightIndustry | 1/3 + 1/2 + 1/2 + 1/3 = 1,666667 |
| heavyIndustry | 1/3 + 1 + 1/2 + 1/2 + 1 + 1/3 = 3,666667 |
| commercial | 1/2 + 1 = 1,500000 |
| extraction | 1/3 = 0,333333 |
| other1, other2 | 0 → penalty 0 |

### 13.5 The resource exchange and blockade

**SOURCED**: resources are traded only on a separate shared "Resource Exchange" spreadsheet,
never on the project wall. That spreadsheet is outside this app, and its link in the article is
a placeholder.

So the engine models the *result* of a deal, not the market. `importsRequested(r)` **[P]** is
where a concluded purchase is entered and `exports(r)` **[P]** is where a concluded sale is
entered. There is no in-app matching, no price, and no counterparty. **INVENTED**, and the
absence of a price is deliberate.

**Both halves of a deal are booked on the ordinary FR ledger, and both directions exist.** FR paid
for a resource is an ordinary line in `frExpenseLines[]` (§8.5); FR received for a resource is an
ordinary line in `frIncomeLines[]` (§8.6). "One ledger instead of two" means the FR ledger has an
income side and an expense side, and there is no separate resource-cash ledger — it does not mean
purchases are representable and sales are not. Without §8.6 `exports` would be strictly dominated:
a player would give up units and receive nothing the engine could express, so no player would ever
set it above 0 and half of a sourced mechanic would be dead. A sale paid in MIC points instead goes
to `micIncomeLines[]` by the same rule. Expense lines stay `≥ 0`; a sale is never a negative
expense.

**Blockade is per resource, not global. SOURCED** (Image 11). It is judge-adjudicated and full
or partial, so it is a percentage:

```
blockadePct(r) ∈ [0, 100]        [V]        0 = Отсутствует (absent)
```

It reduces imports only. Domestic extraction is unaffected by a blockade — a blockade cuts you
off from *importing*. **INVENTED** that the dial is a percentage; **SOURCED** that the effect is
full or partial and per resource.

### 13.6 Fields

| Field | Tag | Unit |
| --- | --- | --- |
| `deposits(r)` | [V] | integer ≥ 0 |
| `extractionBonusPct(r)` | [V] | ≥ 0 |
| `stock(r)` | [A] | integer ≥ 0, carried from last turn |
| `importsRequested(r)`, `exports(r)` | [P] | integer ≥ 0 |
| `blockadePct(r)` | [V] | 0..100 |
| `needUnits`, `extraction`, `imports`, `onHand`, `exportsApplied`, `supply`, `coverage`, `shortage`, `free`, `stockNext` | [A] | — |
| `sectorShortagePenalty(s)` | [A] | 0..1 |

---

## 14. Debt

### 14.1 Capacity

```
debtLimit        = DEBT_LIMIT_MULTIPLE(tier) × frGenerated              [FR points]
debtOutstanding  = Σ over the start-of-turn loans of loan.principal
newLoanAvailable = max(0, debtLimit − debtOutstanding)
newLoanRatePct   = DEBT_RATE_PCT(tier)
newLoanTermTurns = DEBT_TERM_TURNS(tier)
```

**SOURCED**: how much can be borrowed, for what term and at what interest is set by the credit
rating and computed automatically; `available = limit − current debt` (Image 13).

`debtOutstanding` is the sum over the loans that existed at the start of the turn, so
`newLoanAvailable` cannot be affected by the loan the same turn creates.

**Tier F.** `DEBT_LIMIT_MULTIPLE(F)` is 0,00 and §2.9 shows "—" for its rate and term. In the
engine those are numbers, not absences: `newLoanRatePct = 0` and `newLoanTermTurns = 0` at tier F,
with `debtLimit = 0` and `newLoanAvailable = 0`. Borrowing is blocked by V7, not by an unsatisfiable
type. **INVENTED**, and it exists only so `DerivedEconomy` stays total.

**The limit is a multiple of annual FR income, not a flat number. INVENTED.** A flat 22 500 would
be the same cap for a village and an empire. Debt-to-revenue is the standard sovereign metric,
it self-corrects as the economy grows or collapses, and it makes the sourced tier-B value fall
out of a clean 2,25.

The rating enters twice — once through `ratingFactor` inside `frGenerated`, once through the tier
multiple. That is intended: a downgrade should bite through both the numerator and the ratio.

### 14.2 Taking a loan

`borrowRequest` **[P]**, in FR points ≥ 0. Validation: `borrowRequest ≤ newLoanAvailable`, and
tier F cannot borrow at all. Accepted, it becomes a new loan slot:

```
loan = {
  id, principal: borrowRequest,
  ratePct: newLoanRatePct,          // locked at borrowing time, never floats
  termTurns: newLoanTermTurns,
  turnsRemaining: newLoanTermTurns,
  createdTurn: turn                 // step 7 skips a loan created this turn
}
```

**SOURCED**: loans are individual numbered slots each carrying its own rate, so the rate is fixed
at the moment of borrowing (Image 13).

`newLoanProceeds` = `borrowRequest`, credited to `frAvailable` and to the running balance at step 5
(§8.4, §8.4a).

**A loan created this turn is not serviced this turn. INVENTED.** Step 7 services exactly the loans
that existed at the start of the turn; the loan step 5 created is not in that set. Its first payment
falls at the next turn's step 7, and its `turnsRemaining` is not decremented this turn either, so it
makes exactly `termTurns` payments over the `termTurns` turns that follow. §14.3 states the same
rule from the servicing side, because it is the one place two implementers would otherwise differ
by 29% on the net value of every loan.

Why this way round: the proceeds arrive mid-year and the annual close that books them is the same
close that would demand the first payment, so charging interest for a year the money was not yet
borrowed would be wrong. It also makes `termTurns` mean what it says — a 6-turn loan makes 6
payments, not 5.

### 14.3 Servicing

**Step 7 services the loans that existed at the start of the turn** — every loan whose
`createdTurn < turn`. A loan created at step 5 this turn is skipped: no `requiredFr`, no
`allocatedFr`, no `turnsRemaining` tick, and it contributes nothing to `requiredTotal` or
`shortfallTotal`. See §14.2 for why.

Per serviced loan, per turn:

```
interestDue(l)  = l.principal × l.ratePct / 100
principalDue(l) = l.principal / max(1, l.turnsRemaining)
requiredFr(l)   = interestDue(l) + principalDue(l)
```

Straight-line amortisation over the *remaining* term. **INVENTED.** It self-corrects — the last
turn's `principalDue` is the whole remaining principal, so a loan always closes at exactly 0 —
and it needs no schedule table. The `max(1, …)` is the divide-by-zero guard for a matured loan.

```
frStillAvailable(l) = frBalance₆ − Σ allocatedFr(k) over the loans k serviced before l    §8.4a

allocatedFr(l)   = DEBT_AUTO_SERVICE
                 ? min(requiredFr(l), max(0, frStillAvailable(l)))   // in loans[] order
                 : loan.allocatedFr                          [P]
shortfall(l)     = max(0, requiredFr(l) − allocatedFr(l))
interestPaid(l)  = min(allocatedFr(l), interestDue(l))
principalPaid(l) = max(0, allocatedFr(l) − interestDue(l))
principalNext(l) = max(0, l.principal − principalPaid(l) + (interestDue(l) − interestPaid(l)))
turnsRemainingNext(l) = max(0, l.turnsRemaining − 1)
```

Interest is paid before principal, and unpaid interest **capitalises** into the principal.
**INVENTED**, and it is the mechanism that makes a debt spiral possible without any extra rule.
A loan whose `turnsRemaining` hits 0 with principal left keeps demanding its full interest plus
the whole principal every turn until it is cleared.

`frStillAvailable(l)` is the running FR balance after step 6 minus what the earlier loans already
took (§8.4a). So loans are paid in `loans[]` order, the oldest first, and a balance too small to
service everything starves the newest loan rather than short-paying all of them. **INVENTED**, and
it needs to be stated because `shortfallTotal` — and through it a rating penalty of up to 10
points — depends on the order.

`frStillAvailable(l)` can be negative when `DEBT_AUTO_SERVICE` is off and the player over-allocated
by hand; the `max(0, …)` keeps the auto branch from paying a negative amount. The manual branch does
not clamp: an over-allocation drives `frRemainder` negative and V5 aborts the turn.

`DEBT_AUTO_SERVICE` defaults on. **INVENTED**, for playability: a player should not default
because they forgot to fill a cell. Turning it off exposes `allocatedFr` per loan as **[P]**,
which is what the calculator screenshot does, and it is the explicit way to choose a default.

### 14.4 Failure

```
requiredTotal   = Σ requiredFr(l)
shortfallTotal  = Σ shortfall(l)
debtRatingPenalty = requiredTotal <= 0
                  ? 0
                  : min(DEBT_SHORTFALL_RATING_MAX,
                        ceil(DEBT_SHORTFALL_RATING_MAX × shortfallTotal / requiredTotal))
```

Missing the whole payment costs 10 rating points — a full tier drop, which is the sourced "hits
the credit rating very hard". Missing a tenth costs 1. **INVENTED rate**, SOURCED that the
penalty exists and is severe (Image 13).

Status, a three-state machine (**SOURCED** labels `Норма` and an implied default state, Image 13;
**INVENTED** transitions):

| Status | Condition |
| --- | --- |
| `normal` | `shortfallTotal === 0` |
| `arrears` | `shortfallTotal > 0` and last turn was not in arrears |
| `default` | `shortfallTotal > 0` for two consecutive turns |

`defaultLastTurn` is the flag the screenshot carries. A country in `default` cannot borrow until
one full turn closes with no shortfall. **INVENTED.**

### 14.5 Fields

| Field | Tag | Unit |
| --- | --- | --- |
| `borrowRequest` | [P] | FR points ≥ 0 |
| `loans[].allocatedFr` | [P] | only when auto-service is off |
| `debtAutoService` | [P] | boolean |
| `loans[].principal`, `.ratePct`, `.termTurns`, `.turnsRemaining` | [A] | set at borrowing, then engine-owned |
| `debtLimit`, `debtOutstanding`, `newLoanAvailable`, `newLoanRatePct`, `newLoanTermTurns` | [A] | — |
| `requiredTotal`, `shortfallTotal`, `debtRatingPenalty`, `debtStatus`, `defaultLastTurn` | [A] | — |

---

## 15. States and flags

### 15.1 Mobilization

`mobilized` **[V]** — the rulebook makes it penalty-free only during a war or an
administration-announced international crisis, so a judge owns the switch.

All four effects are **SOURCED** (Image 15):

| Effect | Value |
| --- | --- |
| Military spending step limit | +10,00 pp |
| FR generation | ×0,50 |
| MIC generation | ×2,00 |
| GDP growth | −2,00 pp |

`mobilizationJustified` **[V]**, default true. When `mobilized && !mobilizationJustified` the
engine applies `MOB_UNJUSTIFIED_RATING_PER_TURN` = −5 rating per turn. **INVENTED** — the
rulebook says there are penalties and never says what they are.

No cooldown and no minimum duration. **SOURCED as unspecified**, and inventing one would take a
tool away from the judge for no gain.

### 15.2 Nationalization and privatization

One action per turn at most, and each action has its own 2-turn cooldown. **SOURCED** (Image 14).
The rulebook's "once a year" line is wrong and is not implemented.

```
pendingAction = null | {
  kind: "nationalization" | "privatization",
  enterprise: "civilian" | "military",
  roll: 1..10
}
```

`kind` and `enterprise` are **[P]**. `roll` is **[V]** — it comes from a dice chat, which is an
event, not a player choice.

Availability:

```
nationalizationAvailable = turnsSinceNationalization >= ACTION_COOLDOWN_TURNS
                        && controlBandIndex !== NAT_LOCK_BAND_INDEX
privatizationAvailable   = turnsSincePrivatization >= ACTION_COOLDOWN_TURNS
                        && controlBandIndex !== PRIV_LOCK_BAND_INDEX
```

**Nationalization.** Always structurally succeeds — the state takes the asset. The roll scales
only the money. **SOURCED** costs and cap, **INVENTED** linear scaling:

```
payoutFraction = NAT_INCOME_MAX_PCT / 100 × roll / ROLL_MAX      = 0,2625 × roll / 10
natFrPayout    = enterprise === "civilian"  ? payoutFraction × frGenerated  : 0
natMicPayout   = enterprise === "military"  ? payoutFraction × micGenerated : 0
rating delta   = NAT_RATING = −4                                (unconditional)
growth         = timed modifier NAT_GROWTH_PP = −0,75 pp for ACTION_EFFECT_TURNS turns
control        = controlPosition + NAT_CONTROL_SHIFT = −3
```

"Up to +26,25% of income" is read as a fraction of **this turn's generated income** in the
matching currency — FR for a civilian enterprise, MIC for a military one, which is exactly what
the prose says the two cases pay in.

**Privatization.** Can fail. `success = roll >= PRIV_SUCCESS_MIN_ROLL` (6), a 50% chance on a
fair d10. **INVENTED threshold.**

```
success:
  growth  = timed modifier +PRIV_GROWTH_MAX_PP × roll / ROLL_MAX for ACTION_EFFECT_TURNS turns
  control = controlPosition + PRIV_CONTROL_SHIFT = +3
  drag    = enterprise === "civilian" ? privatizationFrDrag  = 1 − PRIV_DRAG_PCT/100 = 0,95
                                      : privatizationMicDrag = 0,95
            for PRIV_DRAG_TURNS = 3 turns, starting NEXT turn
failure:
  growth  = timed modifier PRIV_FAIL_GROWTH_PP = −0,25 pp for ACTION_EFFECT_TURNS turns
  rating  = PRIV_FAIL_RATING = −2
  control unchanged, no drag
```

The drag is the sourced "privatization temporarily sacrifices future FR growth (civilian) or MIC
growth (military)". It starts next turn because this turn's income was already generated when
the action resolved. Its size and duration are **INVENTED**.

The linear roll scaling (2,625% of income per roll point, 0,075 pp per roll point) is the obvious
reading of "up to X against a 1–10 roll" and the digest flags it as inference. **INVENTED, and
the single most likely thing the user will want to change.** An alternative worth naming: pay
nothing below the success threshold and scale 6..10 across the full range. That is a sharper
gamble; this spec chose the smooth version because nationalization has no failure branch and a
threshold there would need inventing too.

**Timed modifiers.** One mechanism carries every temporary growth effect:

```
timedModifier = { id, reason, growthPp, turnsRemaining }
timedModifierPp = Σ over active modifiers of growthPp
```

**INVENTED.** The rulebook calls the nat/priv growth effects "temporary" and never says for how
long, so a generic list with an explicit duration is both the honest model and the one a verdict
can extend. Step 14 of the pipeline decrements and expires them.

Cooldown counters `turnsSinceNationalization` and `turnsSincePrivatization` are **[A]**, start at
`ACTION_COOLDOWN_TURNS` on a fresh country so nothing is locked at turn 1, reset to 0 when the
matching action resolves, and increment every turn otherwise.

### 15.3 Concessions

Available only to a country whose `region` **[V]** is `bengo`, `aglan`, `sudhara` or `badiyat`.
**SOURCED**, and the list is exactly those four.

#### How a grant enters the state

One input field, **[V]**:

```
pendingConcession = null | { sectorKey: SectorKey }
```

It is a verdict input, not a player input, for the same reason `region` is: a concession hands a
province and its turnover to *another country*, so it is a judge-mediated transaction and not
something a player books alone. `sectorKey` is the grantor's choice of where the loss lands.

Step 4 turns a non-null `pendingConcession` into a `concessions[]` entry with `active: true`,
`grantedTurn: turn` and `gdpTransferredObor: 0`. Step 12 computes the cost and writes
`gdpTransferredObor`. Step 14 clears `pendingConcession` back to `null`, with the other one-shot
inputs. V11 checks that the region is in `CONCESSION_REGIONS` and that `sectorKey` names a sector
that exists.

#### Contradiction C2 — the concession cost. RESOLVED.

The rule text says the grantor loses turnover from **one sector of the grantor's choice**,
proportional to the total province count. The worked example says: 20 provinces, GDP
100 000 000, "you will lose 5 000 000 GDP". 1/20 of one 20 000 000 sector is 1 000 000, not
5 000 000. 1/20 of **total GDP** is exactly 5 000 000.

**Decision: the deduction is `gdpTotal / provinceCount`, booked against one sector of the
grantor's choice.** The "one sector of your choice" clause decides *where* the loss lands, not
*what* it is computed from.

Why this reading:

- It is the only reading that satisfies the article's one numeric example, and the example is the
  only arithmetic anchor either side has.
- The example labels the loss "5 000 000 **ВВП**" — GDP — not 5 000 000 of a sector.
- It produces the better rule. Under the other reading the cost depends on which sector the
  grantor picks, so every player picks their smallest sector and the mechanic collapses into a
  rounding error. Under this reading the cost is the same wherever it is booked, so the choice is
  about which sector's future growth you want to shrink — a real decision with no dominant answer.

#### When the cost is booked, and against what

**The cost is booked once, on the turn the concession is granted, at step 12, against that turn's
*next-turn* sector volume.** It never touches the start-of-turn volumes, which §4.2a freezes for
the whole turn.

```
concessionCostObor = provinceCount > 0
                   ? min(round(gdpTotal / provinceCount, 0), gdpNext(chosen))
                   : 0

gdpNext(chosen) := gdpNext(chosen) − concessionCostObor
```

`gdpTotal` and `provinceCount` are the start-of-turn values. `gdpNext(chosen)` is the step-12
grown volume from §5.5, computed before the deduction. `gdpNextTotal` is then the sum of the
adjusted sectors, so `gdpChange` shows the concession, and next turn's `gdpTotal` opens at the
reduced figure.

**This is the answer to "which volume do the later steps see": all of them see the start-of-turn
volume, because the deduction lands after every consumer of `gdpTotal` has run.** The eight
quantities §4.2a lists — sector shares, `plannedGrowthPct`, `frTaxBase`, `micGenerated`,
`reserveShare`, the auto-investment share, `overallGrowthPct`, resource `needUnits` — are all
computed from the pre-concession economy on the grant turn. The grantor's budget for the year the
concession was signed is the budget the year actually produced.

`provinceCount` comes from the country's own `provinceIds.length` in the T05 store, so it is live
and needs no economy field. Guards: 0 provinces costs nothing (G6); the cost cannot exceed the
chosen sector's own grown volume, so a sector can never be pushed negative (G8). If the chosen
sector's grown volume is smaller than the full cost the remainder is *not* carried to another
sector or to a later turn — the clamp absorbs it, and a warning records the shortfall.

Effect while any concession is in force:

```
concessionGrowthPp = +CONCESSION_GROWTH_PP = +1,50 pp to every sector
```

**The +1,50 pp applies from the grant turn onward, including the grant turn.** The grant resolves
at step 4 and growth resolves at step 11, so the modifier is in force when the year's growth is
computed. That is the same rule privatization follows — its growth modifier is created at step 4
and read at step 11 — and it pairs with the cost landing on next turn's volumes: the benefit
starts where the turn's growth is computed, the cost lands where the turn's volumes are written.
**INVENTED**, and stated because "while in force" alone does not decide the grant turn.

**SOURCED** value. **INVENTED**: it is a flat addition in percentage points, not a multiplier
(everything else in the growth equation is pp, and "1,5%" next to "−2 p.p." reads as the same
kind of quantity); and it **does not stack** across multiple concessions. Non-stacking is a
runaway guard — three concessions granted from a 60-province country would otherwise buy +4,5 pp
for 5% of GDP.

Duration is **SOURCED as unspecified**: a concession runs until a verdict ends it or the
concessionaire seizes it. There is no auto-expiry.

The concessionaire side (gaining the province and the turnover, and *not* gaining the +1,5 pp) is
modelled as an ordinary `[V]` sector adjustment on that other country's sheet. The engine
resolves one country at a time and has no cross-country transaction.

```
concessions[] = { id, sectorKey, gdpTransferredObor, grantedTurn, active }
```

### 15.4 Blockade

Per resource, judge-adjudicated, full or partial. §13.5. **SOURCED.**

### 15.5 Fields

| Field | Tag | Range |
| --- | --- | --- |
| `mobilized`, `mobilizationJustified` | [V] | boolean |
| `region` | [V] | none / bengo / aglan / sudhara / badiyat |
| `pendingAction.kind`, `.enterprise` | [P] | enum, or null |
| `pendingAction.roll` | [V] | integer 1..10 |
| `pendingConcession.sectorKey` | [V] | a sector key, or the whole object null |
| `concessions[].sectorKey`, `.active` | [V] | — |
| `concessions[].id`, `.gdpTransferredObor`, `.grantedTurn` | [A] | — |
| `timedModifiers[]` | [A] (created by [V] events) | — |
| `turnsSinceNationalization`, `turnsSincePrivatization` | [A] | integer ≥ 0 |
| `nationalizationAvailable`, `privatizationAvailable` | [A] | boolean |
| `privatizationFrDrag`, `privatizationMicDrag` | [A] | 0,95 or 1,00 |

---

## 16. The turn pipeline

### 16.1 What a turn is

**A turn is one calendar year. SOURCED** — GDP is annual, growth is "per year on average", the
calculator is filled in annually, and its own field is `Год / ход`, "year / turn". The starting
turn is **turn 1** (Image 1).

**SOURCED**: spending is booked to the year it happened, and a verdict's results are booked to
the year the verdict arrived. Those can differ, which is why `growthTemporaryPct` and the timed
modifiers exist as separate mechanisms.

### 16.2 The ordered steps

Steps 2 through 13 are **the derive pass**: pure arithmetic over the input state that writes
nothing. Steps 14 and 15 are the only steps that produce the next state. Step 1 is not a step of
its own arithmetic at all — it *is* the derive pass, run for its errors.

**Step 1 runs the whole derive pass (steps 2 through 13) read-only, collects every error in V1–V13,
and aborts the turn if there is one.** It is therefore genuinely the only step that can abort, and
every later step is running on input already known to be valid. There is no second validation site
anywhere in the pipeline.

The derive pass must be **total**: it computes through step 13 even on invalid input, using the
guards in §20, and never throws. That is what lets T12 show live [A] values while a field is
momentarily out of range, and it is what lets step 1 collect *every* error instead of stopping at
the first.

Steps 2 through 13 do not recompute anything. Step 1 produced one `DerivedEconomy`, and each step
reads its part of it, writes its `TurnStepRecord` and hands the next-state fragments to step 15. So
every formula in this spec is evaluated exactly once per turn, in one place.

| # | Step | What it does | Why here |
| --- | --- | --- | --- |
| 1 | `derive-and-validate` | Runs the read-only derive pass (steps 2–13) in full, collects V1–V13, and **aborts the whole turn on any error, changing nothing.** The only step that can abort | Nothing may be written on invalid input, and half the rules cannot be checked without the derived numbers |
| 2 | `resources` | Needs, extraction, blockaded imports, clipped exports, supply, coverage, shortage, free, next-turn stock, per-sector shortage penalty | Growth needs the penalties; needs read start-of-turn sector volumes |
| 3 | `generation` | Sector shares, `plannedGrowthPct`, `ratingFactor`, control band values, `frGenerated`, `micGenerated` | Everything downstream is denominated in these. `plannedGrowthPct` keeps it acyclic (§5.7) |
| 4 | `actions` | Nationalization / privatization resolution: payouts, rating deltas, control shift, timed modifiers, drags. A `pendingConcession` becomes a `concessions[]` entry — its **cost** is booked at step 12, not here | Payouts are a fraction of the income computed in step 3 |
| 5 | `borrowing` | `debtLimit` and `newLoanAvailable` from the step-3 income; create the loan; credit the proceeds to the running FR balance. **The loan created here is not serviced at step 7 this turn** (§14.2) | The limit is a multiple of this turn's income |
| 6 | `savings` | MIC stockpile additions and clipped withdrawals first, then the reserve cap and the clipped reserve addition and withdrawal. Charges `reserveAddApplied` against the running FR balance | **SOURCED ordering**: the reserve penalty is assessed on the *end-of-turn* stock, so the stock must be final before growth resolves |
| 7 | `debt-service` | Required, allocated, shortfall, interest, principal roll-forward, term tick, status, rating penalty — over the start-of-turn loans only, in `loans[]` order, against `frBalance₆` | Before MIC upkeep: a missed payment costs 10 rating and poisons the whole economy, while a lost MIC point is a local loss. A state pays its creditors first |
| 8 | `upkeep` | MIC stockpile upkeep in FR out of `frBalance₇`; unpayable points lost | Needs the FR left after debt service |
| 9 | `spending` | Discretionary FR and MIC income and expense lines; both remainders | After every mandatory charge |
| 10 | `auto-invest` | Both remainders converted to a growth bonus, then discarded | Needs the final remainders |
| 11 | `growth` | The modifier sum, per-sector pre-shortage, the shortage factor, `finalPct`, `overallGrowthPct` | Needs steps 2, 6 and 10 |
| 12 | `gdp` | Per-sector next volumes, then any concession cost deducted from the chosen sector's next volume, then the next total and the change | Needs step 11. Booking the concession here is what keeps `gdpTotal` frozen for every consumer (§4.2a, §15.3) |
| 13 | `rating` | Evaluate the §6.2a clean-turn predicate, sum every rating delta including the recovery, clamp to 0..100, set the next tier | Needs steps 4, 7 and the emission penalty, **and step 11**: the recovery reads `shortfallTotal` from step 7 and `overallGrowthPct` from step 11, so it can only be decided once growth is final and debt service is resolved. Step 13 is already the first step after both, so ruling 1 moved nothing |
| 14 | `flags` | Decrement and expire timed modifiers and drags; tick both cooldowns; clear `growthTemporaryPct`; clear the one-shot inputs — `pendingAction`, `pendingConcession`, `borrowRequest`, reserve add/withdraw, stockpile add/withdraw, imports, exports | Last, so every earlier step saw the values |
| 15 | `commit` | Write the next-turn state, push the `TurnRecord`, `turn += 1`, trim history to `TURN_HISTORY_MAX` | — |

**INVENTED**, all of the ordering except step 6 before step 11, which the "penalty on the
end-of-turn stock" line forces.

The FR charges at steps 6, 7, 8 and 9 all draw on one running balance, and §8.4a states the order
and which charges are already deducted when each step runs. That is the only place in the pipeline
where a step's *result* depends on an earlier step's *arithmetic* rather than on its inputs, so it
is the one ordering a reader has to hold in mind.

Expense and income lines are **not** cleared at step 14. They are the year's ledger and the history
shows them. The panel offers "clear all lines" as a button, not as a turn effect. **INVENTED.**

### 16.3 The engine's signature

Pure, deterministic, side-effect free. Same input, same output, always.

```
resolveTurn(state: EconomyState): TurnResolution
```

`TurnResolution` is `{ ok: true, next: EconomyState, record: TurnRecord }` or
`{ ok: false, errors: ValidationError[] }`. The engine never mutates its argument and never
reads a clock, a random source or the DOM. **The dice roll is an input, never generated
here** — that is what keeps the whole thing testable and what matches the rulebook, where the
roll is thrown in a chat.

A second entry point recomputes the live derived block without advancing anything, so T12's [A]
fields update as [P] fields are typed:

```
deriveEconomy(state: EconomyState): DerivedEconomy
```

**`deriveEconomy` runs the read-only form of steps 2 through 13** — all twelve, not a subset — and
reports the same validation errors and warnings. Every field of `DerivedEconomy` (§18) is one of
its outputs, including `frRemainder`, `micRemainder`, `micUpkeepPaid`, `micStockLost`,
`debtRequiredTotal`, `debtShortfallTotal`, `debtRatingPenalty` and `autoInvestGrowthPp`, which come
from steps 7 through 10. A shorter list is not merely incomplete but impossible: step 11 cannot
compute `modifierPp` without step 10's `autoInvestGrowthPp`, and step 10 needs the remainders from
step 9.

`resolveTurn` calls `deriveEconomy` exactly once, as step 1, and then steps 2 through 15 consume
its output. So there is one implementation of every formula and T12's live [A] fields cannot drift
from what End Turn books.

Read-only means read-only: `deriveEconomy` never mutates its argument, and the "`:=`" assignments
in §9.2 and §15.3 are assignments to values inside the derived block, not to the input state.

### 16.4 Turn history

Each resolved turn appends one record. **INVENTED** shape, **SOURCED** requirement (the player
publishes the filled calculator each turn, and PLAN decision 6 requires a readable record of
what changed).

A record carries the closing headline numbers, the per-step deltas, and the warnings — not a
full state snapshot. Rationale: `STORAGE_BUDGET_BYTES` is 4 000 000 for the whole document
across every country, and the economics slot shares it with flags and province images.
`TURN_HISTORY_MAX` = 12 keeps a run of turns visible at a few kilobytes each.

Depth matters. `sanitizeRecord` allows 8 levels of containers counting the slot's own `data`
object as level 1, and it silently drops anything deeper. The history path is
`data → history[] → record → steps[] → step → deltas → scalar`, which is level 6. There is room,
but a record must stay flat: no nested records inside a delta.

---

## 17. Validation

**Every one of these is raised by the derive pass and reported at step 1.** An error aborts the
turn and nothing is written. A warning is recorded in the `TurnRecord` and the turn proceeds.

The `Needs` column names the last derive stage a rule depends on, which is why step 1 has to be the
whole derive pass and not an input-range gate: V5, V6 and V7 cannot be evaluated from the raw
inputs alone. Because the derive pass is total (§16.2), a rule that fails does not stop the ones
after it — step 1 always reports the complete error list.

| # | Rule | Needs | Kind |
| --- | --- | --- | --- |
| V1 | `emissionPct` within 0..`EMISSION_PCT_MAX` | raw input | error |
| V2 | `militaryPct` within 0..`MILITARY_PCT_MAX` | raw input | error |
| V3 | `abs(emissionPct − emissionPctLast) ≤ emissionStepLimitPp` | step 3 (control band) | error |
| V4 | `abs(militaryPct − militaryPctLast) ≤ militaryStepLimitPp` | step 3 (control band) | error |
| V5 | `frRemainder ≥ 0` | step 9 | error |
| V6 | `micRemainder ≥ 0` | step 9 | error |
| V7 | `borrowRequest ≤ newLoanAvailable`, and tier ≠ F, and status ≠ `default` | step 5 (`newLoanAvailable`, from step 3) | error |
| V8 | `pendingAction` respects its cooldown and its control-scale lockout | step 3 (control band) | error |
| V9 | `pendingAction.roll` an integer 1..10 | raw input | error |
| V10 | at most 2 Other sectors, each with non-empty `grounds` | raw input | error |
| V11 | `pendingConcession` requires a `region` in `CONCESSION_REGIONS` and a `sectorKey` that exists | raw input | error |
| V12 | every sector `gdpObor ≥ 0`; every point, unit, income-line and expense-line input ≥ 0 | raw input | error |
| V13 | `ratingScore` and `controlPosition` integers 0..100 | raw input | error |
| V14 | `reserveAdd` or `reserveWithdraw` clipped by the cap policy or the stock | step 6 | warning |
| V15 | `micStockWithdraw` clipped to the stock | step 6 | warning |
| V16 | MIC points lost to unpaid upkeep | step 8 | warning |
| V17 | a debt payment shortfall | step 7 | warning |
| V18 | any sector at 0 growth from a full shortage | step 11 | warning |
| V19 | `exports(r)` clipped to what the country holds | step 2 | warning |
| V20 | a concession cost clamped to the chosen sector's grown volume | step 12 | warning |

**Reachability of the punishing paths, for T11-B's tests.** V5 aborts any turn whose *discretionary*
spending overshoots, so a player can never choose to underpay debt or lose MIC points by booking a
big order — the obvious test aborts at step 1 instead of exercising steps 7 and 8. Those two paths
are reachable in three ways, and a test must use one of them:

- the mandatory charges alone exceed the credits — `frGenerated` plus withdrawals plus loan proceeds
  is less than debt service plus MIC upkeep. A collapsed economy with a large old loan does it;
- a reserve addition at step 6 eats the balance before step 7 runs (§8.4a), which starves the loan
  without any invalid input;
- and, for the debt path only, `debtAutoService = false` with a deliberately small `allocatedFr`,
  which is the explicit way to choose a default.

---

## 18. Data shapes

TypeScript, mirroring what the engine consumes and what the store persists. The real files carry
one grouped named export at the end per `javascript/CLAUDE.md`; the `export` keyword is omitted
here for brevity.

Every field is JSON-safe. Absent means `null`, never `undefined`. No `Map`, no `Set`, no `NaN`,
no `Infinity` — `sanitizeRecord` drops all four and the field vanishes from the document.

**Every field carries a tag.** Schema plumbing — `schemaVersion`, the three `next*Id` counters and
every `id` — is **[A]**: the engine owns it, no UI ever shows it, and no verdict touches it. Every
field of `DerivedEconomy`, `SectorDerived`, `ResourceDerived`, `TurnRecord` and `TurnStepRecord` is
[A] by construction, so those four types are not annotated field by field.

```ts
type SectorKey =
  | "agriculture"
  | "lightIndustry"
  | "heavyIndustry"
  | "commercial"
  | "extraction"
  | "other1"
  | "other2";

type ResourceKey =
  | "coal"
  | "oil"
  | "fibre"
  | "ferrous"
  | "nonferrous"
  | "rubber"
  | "chemical"
  | "precious";

type RatingTier = "A+" | "A" | "B" | "C" | "D" | "E" | "F";

type Region = "none" | "bengo" | "aglan" | "sudhara" | "badiyat";

type DebtStatus = "normal" | "arrears" | "default";

type ActionKind = "nationalization" | "privatization";

type EnterpriseKind = "civilian" | "military";

type Sector = {
  key: SectorKey;
  name: string;                    // [P] for other1/other2, fixed otherwise
  grounds: string | null;          // [V], non-empty required for other1/other2
  gdpObor: number;                 // [V]
  growthPermanentPct: number;      // [V]
  growthTemporaryPct: number;      // [V]
};

type ResourceState = {
  key: ResourceKey;
  stockUnits: number;              // [A], carried in
  deposits: number;                // [V]
  extractionBonusPct: number;      // [V]
  importsRequested: number;        // [P]
  exports: number;                 // [P]
  blockadePct: number;             // [V], 0..100
};

type Loan = {
  id: number;                      // [A]
  principal: number;               // [A] after creation
  ratePct: number;                 // [A], locked at borrowing
  termTurns: number;               // [A]
  turnsRemaining: number;          // [A]
  createdTurn: number;             // [A], step 7 skips a loan whose createdTurn is this turn
  allocatedFr: number;             // [P] only while debtAutoService is false
};

type LedgerLine = {
  label: string;                   // [P]
  points: number;                  // [P], >= 0 in both directions
};

type TimedModifier = {
  id: number;                      // [A]
  reason: string;                  // [A], written by the step that created it
  growthPp: number;                // [A]
  turnsRemaining: number;          // [A]
};

type PendingAction = {
  kind: ActionKind;                // [P]
  enterprise: EnterpriseKind;      // [P]
  roll: number;                    // [V], 1..10
};

type PendingConcession = {
  sectorKey: SectorKey;            // [V]
};

type Concession = {
  id: number;                      // [A]
  sectorKey: SectorKey;            // [V]
  gdpTransferredObor: number;      // [A], written at step 12 of the grant turn
  grantedTurn: number;             // [A]
  active: boolean;                 // [V]
};

type EconomyState = {
  schemaVersion: number;           // [A]
  turn: number;                    // [A], starts at 1, step 15 increments it

  sectors: Sector[];               // 5 base always present, other1/other2 optional

  ratingScore: number;             // [V], integer 0..100
  controlPosition: number;         // [V], integer 0..100

  emissionPct: number;             // [P]
  emissionPctLast: number;         // [A]
  militaryPct: number;             // [P]
  militaryPctLast: number;         // [A]

  frExpenseLines: LedgerLine[];    // [P]
  micExpenseLines: LedgerLine[];   // [P]
  frIncomeLines: LedgerLine[];     // [P], §8.6
  micIncomeLines: LedgerLine[];    // [P], §8.6

  reserveFr: number;               // [A], the stock carried in
  reserveAdd: number;              // [P]
  reserveWithdraw: number;         // [P]

  micStock: number;                // [A], the stock carried in
  micStockAdd: number;             // [P]
  micStockWithdraw: number;        // [P]

  resources: ResourceState[];      // exactly 8, fixed order

  loans: Loan[];
  nextLoanId: number;              // [A]
  borrowRequest: number;           // [P]
  debtAutoService: boolean;        // [P]
  debtStatus: DebtStatus;          // [A]
  defaultLastTurn: boolean;        // [A]

  mobilized: boolean;              // [V]
  mobilizationJustified: boolean;  // [V]
  region: Region;                  // [V]
  concessions: Concession[];
  nextConcessionId: number;        // [A]
  pendingConcession: PendingConcession | null;   // [V], §15.3

  pendingAction: PendingAction | null;           // [P] kind/enterprise, [V] roll
  turnsSinceNationalization: number;   // [A]
  turnsSincePrivatization: number;     // [A]
  timedModifiers: TimedModifier[];     // [A]
  nextModifierId: number;              // [A]
  privatizationFrDragTurns: number;    // [A]
  privatizationMicDragTurns: number;   // [A]

  history: TurnRecord[];               // [A], newest last, capped at 12
};

type SectorDerived = {
  key: SectorKey;
  gdpObor: number;
  share: number;
  basePct: number;
  shortagePenalty: number;
  preShortagePct: number;
  finalPct: number;
  gdpNextObor: number;
};

type ResourceDerived = {
  key: ResourceKey;
  needUnits: number;
  extractionUnits: number;
  importUnits: number;
  onHandUnits: number;
  exportsAppliedUnits: number;
  supplyUnits: number;
  coverage: number;
  shortage: number;
  freeUnits: number;
  stockNextUnits: number;
};

type DerivedEconomy = {
  gdpTotalObor: number;
  plannedGrowthPct: number;
  overallGrowthPct: number;
  gdpNextTotalObor: number;
  gdpChangeObor: number;

  ratingTier: RatingTier;
  ratingFactor: number;
  ratingNext: number;
  ratingCleanTurn: boolean;        // §6.2a predicate
  ratingRecovery: number;          // 0 or +1, also a line in ratingDeltas
  ratingDeltas: { reason: string; points: number }[];

  controlBandIndex: number;
  controlBandName: string;
  controlGrowthPp: number;
  controlFrMultiplier: number;
  emissionStepLimitPp: number;
  militaryStepLimitPp: number;
  controlNext: number;

  frGenerated: number;
  frEmission: number;
  frOtherIncome: number;
  frAvailable: number;
  frSpent: number;
  frRemainder: number;
  frBalanceAfterSavings: number;   // frBalance6, §8.4a
  frBalanceAfterDebt: number;      // frBalance7 = frAvailableForUpkeep
  frBalanceAfterUpkeep: number;    // frBalance8
  frLightBonus: number;
  frDefenceDrag: number;
  frGrowthFactor: number;
  frRegimeMultiplier: number;

  micGenerated: number;
  micOtherIncome: number;
  micAvailable: number;
  micSpent: number;
  micRemainder: number;
  micHeavyBonus: number;
  micRegimeMultiplier: number;

  reserveCap: number;
  reserveAddApplied: number;
  reserveWithdrawApplied: number;
  reserveEnd: number;
  reservePenaltyPp: number;
  micStockWithdrawApplied: number;
  micStockEnd: number;
  micUpkeepDue: number;
  micUpkeepPaid: number;
  micStockLost: number;

  inflationPct: number;
  inflationGrowthPp: number;
  emissionRatingPenalty: number;
  defenceGrowthPp: number;
  autoInvestGrowthPp: number;
  mobilizationGrowthPp: number;
  concessionGrowthPp: number;
  timedModifierPp: number;
  modifierPp: number;

  debtLimit: number;
  debtOutstanding: number;
  newLoanAvailable: number;
  newLoanRatePct: number;
  newLoanTermTurns: number;
  debtRequiredTotal: number;
  debtShortfallTotal: number;
  debtRatingPenalty: number;
  debtStatusNext: DebtStatus;

  concessionCostObor: number;      // 0 unless a grant resolves this turn

  sectors: SectorDerived[];
  resources: ResourceDerived[];
  errors: ValidationError[];
  warnings: string[];
};

type ValidationError = {
  code: string;                    // "V3", "V5", …
  field: string;
  message: string;
};

type TurnStepRecord = {
  step: string;                    // "resources", "generation", …
  deltas: { label: string; value: number; unit: string }[];
  notes: string[];
};

type TurnRecord = {
  turn: number;
  gdpTotalObor: number;
  gdpNextTotalObor: number;
  overallGrowthPct: number;
  frGenerated: number;
  frRemainder: number;
  micGenerated: number;
  micRemainder: number;
  ratingScore: number;
  ratingNext: number;
  controlPosition: number;
  controlNext: number;
  steps: TurnStepRecord[];
  warnings: string[];
};
```

The persisted slot is `{ version: ECONOMY_SCHEMA_VERSION, data: EconomyState }` in the T05
`economics` map, keyed by country id. `EconomyState` is already a `JsonRecord` by construction.

---

## 19. Worked end-to-end example

**This is T11-B's primary test fixture.** Every number below was computed at full double
precision and is shown at its stored precision. A test that reproduces this table start to
finish proves the whole pipeline.

### 19.1 Opening state — the country of Aurelia, turn 4

| Field | Value |
| --- | --- |
| `turn` | 4 |
| `region` | `bengo` |
| `ratingScore` | 78 → tier **B** |
| `controlPosition` | 44 → band index 3, "Dirigisme" |
| `emissionPct` / `emissionPctLast` | 4,00 / 0,00 |
| `militaryPct` / `militaryPctLast` | 12,00 / 10,00 |
| `mobilized` | false |
| `reserveFr` | 3 000,00 |
| `micStock` | 40,00 |
| loan 1 | principal 6 000,00, rate 12,00%, term 6, turnsRemaining 4, `createdTurn` 2 |
| `debtAutoService` | true |
| `pendingAction` | privatization, civilian, roll **7** |
| FR expense lines | 2 500,00 total |
| MIC expense lines | 100,00 total |
| FR income lines / MIC income lines | none |
| `reserveAdd` / `reserveWithdraw` | 500,00 / 0,00 |
| `micStockAdd` / `micStockWithdraw` | 10,00 / 0,00 |
| `borrowRequest` | 0,00 |
| concessions | none active, `pendingConcession` null |
| `timedModifiers` | none |
| `turnsSinceNationalization` / `turnsSincePrivatization` | 5 / 4 |

Sectors:

| Sector | `gdpObor` | perm | temp |
| --- | --- | --- | --- |
| agriculture | 24 000 000 | 3,00 | 0,00 |
| lightIndustry | 18 000 000 | 3,00 | 0,00 |
| heavyIndustry | 30 000 000 | 4,00 | −1,00 |
| commercial | 20 000 000 | 2,50 | 0,00 |
| extraction | 8 000 000 | 3,00 | 0,00 |
| other1 "Aerospace" | 6 000 000 | 5,00 | 0,00 |

Resources — `stockUnits` 0 everywhere, no blockade, no extraction bonus, no exports:

| Resource | deposits | importsRequested |
| --- | --- | --- |
| coal | 1 | 0 |
| oil | 0 | 20 |
| fibre | 1 | 0 |
| ferrous | 1 | 0 |
| nonferrous | 0 | 30 |
| rubber | 0 | 10 |
| chemical | 1 | 20 |
| precious | 0 | 5 |

### 19.2 Step 1 — derive and validate

Step 1 runs the whole derive pass, so every number in §19.3 through §19.14 below is computed here
first, read-only. The checks it then makes:

`gdpTotal` = 106 000 000 obor, frozen for the turn (§4.2a).
Step limits at band index 3: `stepLimitPp` = 10 − 1,5 × (3 − 5) = **13,00**.
Emission move |4,00 − 0,00| = 4,00 ≤ 13,00 ✓ (V3). Military move |12,00 − 10,00| = 2,00 ≤ 13,00 ✓ (V4).
Privatization: `turnsSincePrivatization` 4 ≥ 2 ✓, band index 3 ≠ 10 ✓ (V8), roll 7 in 1..10 ✓ (V9).
`borrowRequest` 0 ≤ `newLoanAvailable` 28 837,20 ✓ (V7, needs §19.6).
`frRemainder` 10 163,20 ≥ 0 ✓ (V5, needs §19.10). `micRemainder` 197,93 ≥ 0 ✓ (V6, needs §19.10).
No errors. Warnings: V18 fires for no sector — every `finalPct` is above 0.

The steps below are the same computation reported step by step, not a second evaluation.

### 19.3 Step 2 — resources

`needUnits` = ceil(Σ dependent sector GDP / 1 000 000):

| Resource | Dependent volumes (obor) | need | supply | coverage | shortage | free |
| --- | --- | --- | --- | --- | --- | --- |
| coal | 30M + 18M + 8M = 56M | 56 | 50 | 0,892857 | 0,107143 | 0 |
| oil | 30M | 30 | 20 | 0,666667 | 0,333333 | 0 |
| fibre | 24M + 20M = 44M | 44 | 50 | 1,000000 | 0,000000 | **6** |
| ferrous | 30M + 18M = 48M | 48 | 50 | 1,000000 | 0,000000 | **2** |
| nonferrous | 48M | 48 | 30 | 0,625000 | 0,375000 | 0 |
| rubber | 30M | 30 | 10 | 0,333333 | 0,666667 | 0 |
| chemical | 24M + 30M + 18M = 72M | 72 | 70 | 0,972222 | 0,027778 | 0 |
| precious | 20M | 20 | 5 | 0,250000 | 0,750000 | 0 |

Per-sector penalty `= Σ w·shortage / Σ w`:

| Sector | Σ w | Σ w·shortage | penalty |
| --- | --- | --- | --- |
| agriculture | 0,833333 | 0,009259 | **0,011111** |
| lightIndustry | 1,666667 | 0,232474 | **0,139484** |
| heavyIndustry | 3,666667 | 1,232474 | **0,336129** |
| commercial | 1,500000 | 0,750000 | **0,500000** |
| extraction | 0,333333 | 0,035714 | **0,107143** |
| other1 | 0,000000 | 0,000000 | **0,000000** |

Next-turn stock: fibre 6, ferrous 2, everything else 0.

### 19.4 Step 3 — generation

| Quantity | Working | Value |
| --- | --- | --- |
| `lightIndustry` share | 18 000 000 / 106 000 000 | 0,169811 |
| `heavyIndustry` share | 30 000 000 / 106 000 000 | 0,283019 |
| `plannedGrowthPct` | (24·3 + 18·3 + 30·3 + 20·2,5 + 8·3 + 6·5) M / 106 M | **3,0189** |
| `frGrowthFactor` | 1 + 0,02 × 3,018868 | 1,060377 |
| `ratingFactor` | 1 + 0,01 × (78 − 70) | 1,08 |
| `controlFrMultiplier` | 1 − 0,10 × (3 − 5) | 1,20 |
| `controlGrowthPp` | 0,50 × (3 − 5) | −1,00 |
| `frTaxBase` | (106 000 000 / 2 000) × 0,20 | 10 600,00 |
| `frDefenceDrag` | 1 − 12,00 / 100 | 0,88 |
| `frLightBonus` | 0,25 × 0,169811 | 0,042453 |
| `frCore` | 10 600 × 1,08 × 1,20 × 1,060377 × 0,88 × 1,042453 | **13 363,20** |
| `frEmission` | 53 000 × 1,00 × 0,04 | **2 120,00** |
| `frGenerated` | (13 363,197826 + 2 120) × 1,00 | **15 483,20** |
| `micHeavyBonus` | 0,50 × 0,283019 | 0,141509 |
| `micGenerated` | (106 000 000 / 50 000) × 0,12 × 1,060377 × 1,141509 × 1,00 | **307,93** |

### 19.5 Step 4 — actions

Privatization, roll 7 ≥ 6 → **success**.

- timed modifier created: `+0,75 × 7 / 10` = **+0,5250 pp**, `turnsRemaining` 2.
- `controlNext` = 44 + 3 = **47** (band index 4 next turn).
- `privatizationFrDragTurns` = 3, so next turn's `frCore` carries ×0,95. Not this turn.
- No rating delta, no payout (privatization pays in growth, not in points).
- `turnsSincePrivatization` resets to 0 at step 14.

### 19.6 Step 5 — borrowing

`debtLimit` = 2,25 × 15 483,197826 = **34 837,20**.
`debtOutstanding` (start-of-turn loans) = 6 000,00. `newLoanAvailable` = **28 837,20**.
`borrowRequest` = 0, so no loan is created and `newLoanProceeds` = 0.
Running balance: `frBalance₅` = 15 483,197826.

### 19.7 Step 6 — savings

MIC stockpile first: `micStockWithdrawApplied` = min(0, 40) = 0.
`micStockEnd` = 40 + 10 − 0 = **50,00**. `micUpkeepDue` = 2 × 50 = **100,00 FR**.

Then the reserve: `reserveCap` = 2 × 15 483,197826 = **30 966,40**.
`reserveStart` 3 000 ≤ cap, headroom 27 966,40, so `reserveAddApplied` = 500,00 and
`reserveWithdrawApplied` = 0. No clip, so V14 does not fire.
`reserveEnd` = 3 000 + 500 = **3 500,00**.

Running balance: `frBalance₆` = 15 483,197826 + 0 − 500 = **14 983,197826**. The 500 is charged
here, before debt service (§8.4a).

### 19.8 Step 7 — debt service

Loan 1 has `createdTurn` 2 < 4, so it is serviced.

| Quantity | Working | Value |
| --- | --- | --- |
| `interestDue` | 6 000 × 0,12 | 720,00 |
| `principalDue` | 6 000 / 4 | 1 500,00 |
| `requiredFr` | 720 + 1 500 | **2 220,00** |
| `frStillAvailable` | `frBalance₆`, no earlier loan | 14 983,197826 |
| `allocatedFr` (auto) | min(2 220, 14 983,20) | 2 220,00 |
| `shortfall` | 2 220 − 2 220 | 0,00 |
| `principalNext` | 6 000 − 1 500 + 0 | **4 500,00** |
| `turnsRemainingNext` | 4 − 1 | 3 |
| `debtStatus` | no shortfall | `normal` |
| `debtRatingPenalty` | 0 | 0 |

Running balance: `frBalance₇` = 14 983,197826 − 2 220 = **12 763,197826**.

### 19.9 Step 8 — upkeep

`frAvailableForUpkeep` = `frBalance₇` = 12 763,197826.
`micPointsPaidFor` = floor(12 763,197826 / 2) = 6 381, which is ≥ the 50 points held, so
`micStockLost` = 0 and upkeep is paid in full. `micUpkeepPaid` = **100,00**. V16 does not fire.

Running balance: `frBalance₈` = 12 763,197826 − 100 = **12 663,197826**.

### 19.10 Step 9 — spending

| Ledger | Working | Value |
| --- | --- | --- |
| `frAvailable` | 15 483,197826 (generated) + 0 (payout) + 0 (loan) + 0 (withdrawal) + 0 (income lines) | 15 483,20 |
| `frSpent` | 500 (reserve) + 2 220 (debt) + 100 (upkeep) + 2 500 (orders) | 5 320,00 |
| `frRemainder` | 15 483,197826 − 5 320 | **10 163,20** |
| `micAvailable` | 307,933585 + 0 + 0 + 0 | 307,93 |
| `micSpent` | 10 (stockpile) + 100 (orders) | 110,00 |
| `micRemainder` | 307,933585 − 110 | **197,93** |

Running-balance cross-check (§8.4a): `frBalance₉` = 12 663,197826 + 0 − 2 500 = 10 163,197826,
which is `frRemainder` to the last bit. Both remainders ≥ 0 ✓.

### 19.11 Step 10 — auto-investment

```
investedObor = 10 163,197826 × 2 000 + 197,933585 × 50 000
             = 20 326 395,65 + 9 896 679,25
             = 30 223 074,90 obor
share        = 30 223 074,90 / 106 000 000 = 0,28512335
autoInvestGrowthPp = 2,00 × 0,28512335 = 0,5702 pp
```

### 19.12 Step 11 — growth

| Modifier | Value |
| --- | --- |
| `controlGrowthPp` | −1,0000 |
| `mobilizationGrowthPp` | 0,0000 |
| `concessionGrowthPp` | 0,0000 |
| `timedModifierPp` (privatization) | +0,5250 |
| `autoInvestGrowthPp` | +0,5702 |
| `reservePenaltyPp` = 3,00 × (3 500 × 2 000 / 106 000 000) = 3,00 × 0,0660377 | −0,1981 |
| `inflationGrowthPp` = 0,10 × (1,50 × 4,00) = 0,10 × 6,00 | −0,6000 |
| `defenceGrowthPp` = 0,10 × (12,00 − 10,00) | −0,2000 |
| **`modifierPp`** | **−0,9029** |

| Sector | base | pre-shortage | penalty | `finalPct` |
| --- | --- | --- | --- | --- |
| agriculture | 3,0000 | 2,0971 | 0,011111 | **2,0738** |
| lightIndustry | 3,0000 | 2,0971 | 0,139484 | **1,8046** |
| heavyIndustry | 3,0000 | 2,0971 | 0,336129 | **1,3922** |
| commercial | 2,5000 | 1,5971 | 0,500000 | **0,7986** |
| extraction | 3,0000 | 2,0971 | 0,107143 | **1,8724** |
| other1 | 5,0000 | 4,0971 | 0,000000 | **4,0971** |

`overallGrowthPct` = Σ gdp·final / 106 000 000 = **1,6939%**.

### 19.13 Step 12 — GDP

| Sector | `gdpObor` | `gdpNextObor` | change |
| --- | --- | --- | --- |
| agriculture | 24 000 000 | 24 497 720 | +497 720 |
| lightIndustry | 18 000 000 | 18 324 831 | +324 831 |
| heavyIndustry | 30 000 000 | 30 417 668 | +417 668 |
| commercial | 20 000 000 | 20 159 713 | +159 713 |
| extraction | 8 000 000 | 8 149 795 | +149 795 |
| other1 | 6 000 000 | 6 245 828 | +245 828 |
| **total** | **106 000 000** | **107 795 555** | **+1 795 555** |

No concession was granted this turn, so no next-turn volume is reduced (§15.3).

Cross-check: 106 000 000 × (1 + `overallGrowthPct` / 100) at full precision is 107 795 555,0249,
and the sum of the six rounded sectors is 107 795 555. **They agree to the nearest obor**, which is
what §5.4's "up to rounding" claims. T11-B must assert agreement within 1 obor per sector, never
exact equality: the sum of six independently rounded values can differ from the rounded whole by up
to half an obor per sector.

### 19.14 Step 13 — rating

| Delta | Value |
| --- | --- |
| Emission, `round(0,40 × 4,00)` | −2 |
| Nationalization | 0 |
| Privatization (succeeded) | 0 |
| Debt shortfall | 0 |
| Unjustified mobilization | 0 |
| Clean-turn recovery (§6.2a) | **0** — see below |
| **`ratingNext`** | 78 − 2 = **76** → tier **B** |

The recovery predicate, clause by clause, because this fixture pins its negative branch:

| Clause | Value here | Holds? |
| --- | --- | --- |
| `emissionPct === 0` | 4,00 | **no** |
| `shortfallTotal === 0` | 0,00 (§19.8) | yes |
| `overallGrowthPct > 0` | 1,6939% (§19.12) | yes |

Exactly one clause fails, so `cleanTurn` is false and `ratingRecovery` is 0. **Ruling 1 therefore
moves no number in this example**: `ratingNext` is 76 and every figure in §19.1 through §19.16
stands as written.

A test for the *positive* branch needs a **separate fixture and cannot be made by setting this one's
`emissionPct` to 0.** Dropping emission removes `frEmission` = 2 120,00 from `frGenerated`, which
moves `reserveCap`, `debtLimit`, `frRemainder`, `investedObor`, `autoInvestGrowthPp`, every
`finalPct`, `overallGrowthPct` and all six next-turn sector volumes. The cheapest clean-turn fixture
is a country with `emissionPct` 0, no loans and a positive `overallGrowthPct`; T11-B must compute it
from scratch rather than editing one field of this one.

### 19.15 Step 14 — flags

- privatization timed modifier: `turnsRemaining` 2 → 1;
- `privatizationFrDragTurns` 3 → 2, and next turn's `frCore` carries ×0,95;
- `turnsSincePrivatization` → 0, `turnsSinceNationalization` 5 → 6;
- every `growthTemporaryPct` cleared, so heavy industry's −1,00 is gone next turn;
- `pendingAction` → null, `pendingConcession` stays null; `borrowRequest`, `reserveAdd`,
  `reserveWithdraw`, `micStockAdd`, `micStockWithdraw`, every `importsRequested` and every
  `exports` → 0;
- the four ledger-line lists are **not** cleared (§8.5, §8.6);
- resource stocks set to fibre 6, ferrous 2, the rest 0;
- `emissionPctLast` = 4,00, `militaryPctLast` = 12,00.

### 19.16 Step 15 — commit

| Closing field | Value |
| --- | --- |
| `turn` | 5 |
| `gdpTotalObor` | 107 795 555 |
| `ratingScore` | 76 (tier B) |
| `controlPosition` | 47 (band index 4, "Guided market") |
| `reserveFr` | 3 500,00 |
| `micStock` | 50,00 |
| loan 1 | 4 500,00 at 12,00%, 3 turns left |
| `frRemainder` / `micRemainder` | discarded — points do not carry over |

---

## 20. Guards, degeneracies and runaways

| # | Hazard | Guard |
| --- | --- | --- |
| G1 | Divide by `gdpTotal` — shares, `plannedGrowthPct`, `overallGrowthPct`, `autoInvestGrowthPp`, `reservePenaltyPp` | `gdpTotal > 0 ? … : 0`. Every one of them. |
| G2 | Divide by `needUnits(r)` when a resource has no dependent sector volume | `needUnits === 0 → coverage = 1, shortage = 0` |
| G3 | Divide by `Σ weight` for a sector with no dependencies (`other1`, `other2`) | `Σ weight === 0 → penalty = 0` |
| G4 | Divide by `turnsRemaining` on a matured loan | `max(1, turnsRemaining)` |
| G5 | Divide by `requiredTotal` when no loan exists | `requiredTotal <= 0 → penalty 0` |
| G6 | Divide by `provinceCount` for a country with no provinces | `provinceCount === 0 → concession cost 0` |
| G7 | A sector pushed negative by growth | `finalPct` floored at −100,00; `gdpNextObor` floored at 0 |
| G8 | A sector pushed negative by a concession | cost clamped to that sector's step-12 `gdpNextObor`, against which it is booked (§15.3); warning V20 records the clamp |
| G9 | Shortage turning growth negative — **forbidden by the rulebook** | the multiplicative form with `penalty ∈ [0,1]`, applied only when pre-shortage growth is positive |
| G10 | `ratingScore` out of 0..100 | clamped after summing the deltas |
| G11 | `controlPosition` out of 0..100 | clamped after any nat/priv shift |
| G12 | Negative reserve, negative stockpile, negative resource stock | every withdrawal is clipped to what exists — `reserveWithdrawApplied`, `micStockWithdrawApplied`, `exportsApplied` — so `supply` needs no `max(0, …)` at all |
| G13 | Negative FR or MIC remainder | validation error V5/V6, the turn aborts. No silent clamp: a negative remainder would flow into `investedObor` as a negative and come out as a growth *penalty*, which quietly converts an overspent budget into a merely-bad turn instead of an invalid one. The player would never learn the budget did not balance |
| G14 | Emission or military spending unbounded | hard ceilings 50,00 and 60,00, plus the per-turn step |
| G15 | `frGrowthFactor` unbounded from a huge growth number | clamped to 0,50..1,50 |
| G16 | `frDefenceDrag` reaching 0 | floored at `MILITARY_FR_DRAG_FLOOR` = 0,10. **The floor is unreachable as the constants stand**: `MILITARY_FR_DRAG` = 1,00 and `MILITARY_PCT_MAX` = 60 bottom the drag out at 0,40. It is kept as a structural guard so that raising either constant cannot zero FR generation, and it is listed here so nobody reads it as an active bound |
| G17 | **The FR → growth → FR loop** | generation reads `plannedGrowthPct`, which is a pre-modifier quantity and cannot depend on FR, MIC, reserves, the shortage or any modifier (§5.7). There is no fixed-point iteration anywhere in the engine |
| G18 | Emission runaway — print more, grow more, print more | at 50% emission the printed FR is `gdpTotal × 0,50` in obor, so even entirely unspent it buys at most **+1,00 pp** of auto-investment, against −7,50 pp of inflation and −20 rating per turn. The penalty outruns the gain by 7,5:1 at every emission level, because both are linear in `emissionPct` |
| G19 | Auto-investment runaway | bounded, but over **both** channels — see the note below the table. The FR channel alone caps at about +1,46 pp from the tax take plus +1,00 pp from a 50% emission; the MIC channel reaches **+5,40 pp**, and the honest overall ceiling is about **+6 pp**, not +1,2 pp. Military spending is still never a net growth positive: see the marginal argument below |
| G20 | Concession bonus stacking | the +1,50 pp applies once regardless of how many concessions are in force |
| G21 | Debt spiral | intended and reachable through interest capitalisation, but bounded: the limit falls as income falls, tier F cannot borrow, and `default` status blocks new loans until a clean turn |
| G22 | Resource stock growing without bound | harmless — `coverage` is capped at 1, so a surplus buys nothing. No cap needed, no runaway possible |
| G23 | `NaN` or `Infinity` reaching the store | every stored number passes `finiteOr`. `sanitizeRecord` **drops** such a key rather than nulling it, so the field would silently vanish from the document |
| G24 | `undefined`, `Map` or `Set` in the persisted state | forbidden by the shapes in §18. Absent is `null` |
| G25 | History growing past the storage budget | capped at `TURN_HISTORY_MAX` = 12, records are flat and hold no state snapshot |
| G26 | A rounded total disagreeing with its rounded parts | the total is always the sum of the rounded sectors, never rounded independently |
| G27 | Step-limit clamping silently changing player intent | the step limit is a validation error, never a clamp (§12) |
| G28 | Upkeep pushing the FR balance negative | `micUpkeepPaid` is recomputed from the stock that survived, so it can never exceed `frAvailableForUpkeep` (§9.2) |
| G29 | A dead [P] lever — one a rational player would never touch | `exports` was one until §8.6 gave it an income channel. The test to apply to any new [P] field: name a state in which setting it above 0 is the better move. If none exists, the field is decoration |

### G19 in full — the auto-investment ceiling over both channels

The bound has to be computed over FR *and* MIC, because `investedObor` sums both and a MIC point is
worth 25 FR points.

**FR channel.** `frRemainder ≤ frGenerated`, and `frCore` in obor terms is at most
`gdpTotal × FR_TAX_RATE × ratingFactor × controlFrMultiplier × frGrowthFactor × (1 + frLightBonus)`
= `gdpTotal × 0,20 × 1,30 × 1,50 × 1,50 × 1,25` = 0,7313 × `gdpTotal`, which buys
`2,00 × 0,7313` = **+1,46 pp**. A 50% emission adds `gdpTotal × 0,50` of obor, another **+1,00 pp**.

**MIC channel.** `micRemainder × OBOR_PER_MIC_POINT` =
`gdpTotal × (militaryPct / 100) × frGrowthFactor × (1 + micHeavyBonus) × micRegimeMultiplier`.
At 60% military spending, mobilized, with heavy industry the whole economy, that is
`gdpTotal × 0,60 × 1,50 × 1,50 × 2,00` = 2,70 × `gdpTotal`, which buys **+5,40 pp**.

The two maxima are not simultaneously reachable — mobilization halves FR while doubling MIC, and a
60% military share drives `frDefenceDrag` to 0,40 — so the honest overall ceiling is about **+6 pp**.
It is a bound, not a runaway: it is proportional to GDP, so it cannot compound into itself.

**And it is still dominated.** Differentiating the MIC channel in `militaryPct`:
`d(autoInvestGrowthPp) / d(militaryPct)` = `0,02 × frGrowthFactor × (1 + micHeavyBonus) ×
micRegimeMultiplier` ≤ `0,02 × 1,50 × 1,50 × 2,00` = **0,09 pp per pp**, against the defence penalty
of `DEFENCE_GROWTH_COEFF` = **0,10 pp per pp**. So raising military spending above
`MILITARY_FREE_PCT` is net-negative for growth at every reachable combination of the multipliers,
and 10% remains a local optimum. That the two numbers are 0,09 and 0,10 is a coincidence of the
chosen constants, not a structural fact — anyone retuning `DEFENCE_GROWTH_COEFF` downward or
`INVEST_GROWTH_COEFF` upward must recheck it.

---

## 21. The approval gate

**The gate is closed. §0-A records the user's four rulings.** This section is kept as written
because it is the record of what was asked and why, and because a later reader retuning the economy
needs the arguments. Each question below now carries the answer it received.

### 21.1 Question 0 — the one deviation from a PLAN-binding constant

> **ANSWERED — §0-A ruling 2. The multiple ships.** `DEBT_LIMIT_MULTIPLE(B)` stays 2,25 × annual FR
> income and the whole per-tier table stays multiples of income. The flat table below is not
> implemented and is kept only as the record of the alternative.


PLAN section 3 decision 2 lists the recovered constants and says "Honour them exactly." This spec
honours fifteen of the sixteen exactly. **One it does not: "Debt at tier B: limit 22 500 FR at
12.00%."** The 12,00% rate is exact. The 22 500 appears nowhere in this spec as a value.

| | What the spec does | What it produces |
| --- | --- | --- |
| Implemented | `DEBT_LIMIT_MULTIPLE(B)` = 2,25 × annual FR income | 22 538,25 FR at the standard start, and only there — it scales with income |
| Not implemented | a flat 22 500 FR at tier B | — |

At the standard start `frGenerated` is 10 017,00, so 2,25 × 10 017,00 = 22 538,25, a 0,17% miss.
Away from the standard start the two rules diverge without limit: a country with twice the income
borrows 45 076,50 under the multiple and 22 500 under the flat cap.

**The case for the multiple** is in §14.1: a flat cap is the same ceiling for a village and an
empire, debt-to-revenue is the standard sovereign metric, and the cap self-corrects as an economy
grows or collapses, which is what makes the debt spiral in G21 bounded rather than arbitrary.

**The alternative, if the user wants the sourced number honoured literally:** a flat per-tier FR
table anchored on 22 500, scaling by the same ratios as the current multiples —

| Tier | flat limit (FR) |
| --- | --- |
| A+ | 40 000 |
| A | 30 000 |
| **B** | **22 500** |
| C | 15 000 |
| D | 10 000 |
| E | 5 000 |
| F | 0 |

That reproduces the binding constant exactly and costs the self-correction. It is a one-line change
in §14.1 (`debtLimit = DEBT_LIMIT_FLAT(tier)`) and nothing else in the spec depends on which form is
used. **The user picks.** This spec ships the multiple because the deviation is small and the
mechanic is better, but the choice is not mine to make silently, and it was previously buried in
§2.9 instead of being asked here.

### 21.2 Design questions, ranked by how much a different answer changes the game

> **ALL ANSWERED — §0-A rulings 3 and 4. Every one of the seven ships as specced, unchanged.** The
> ranking below still tells a later retuner which knob moves the most.

1. **`INVEST_GROWTH_COEFF` = 2,00 pp per 1,00 of GDP invested.** This one constant sets both the
   unspent-points bonus and, through the sourced 1,5× ratio, the reserve penalty. Raising it
   makes hoarding painful and thrift powerful; lowering it makes both effects cosmetic.
2. **`OBOR_PER_FR_POINT` = 2 000, from 1 obor = 500 arlings.** Everything denominated in points
   scales with it — the debt limit, the reserve cap, the auto-investment bonus. The rate is pure
   invention; the sources cannot constrain it. §1.2 has the arithmetic that rules out 1 000 000
   and 1, and the ratios all three rates produce.
3. **The roll-to-payout mapping is linear, and privatization succeeds on 6+.** A threshold model
   (nothing below 6, then the full range across 6..10) is the main alternative and makes the
   action a sharper gamble.
4. **Concession cost = total GDP ÷ province count**, resolving C2 in favour of the worked
   example against the rule text. The other reading makes a concession cost about a fifth as
   much.
5. **The control scale's magnitudes** — ±2,50 pp of growth and ×0,50…×1,50 on FR across the
   eleven bands. The directions are sourced; the spread is mine, and it is the biggest single
   lever on how much the scale matters.
6. **Unpaid MIC upkeep loses only the points you could not pay for.** PLAN's wording — stockpiles
   "are LOST if unpaid" — reads as a total loss, and the digest confirms the size is not specified.
   §9.2 keeps exactly the points the budget covered, because losing a 500-point stockpile over a
   2-FR gap would be the harshest rule in the game. The alternative is a total wipe on any
   shortfall, which makes a stockpile unusable near the budget edge and is a one-line change.
7. **Three coefficients are anchored on a single observed cell, not recovered.**
   `FR_LIGHT_BONUS_COEFF` = 0,25, `MIC_HEAVY_BONUS_COEFF` = 0,50 and `MILITARY_FREE_PCT` = 10 each
   fit one screenshot value, and infinitely many other curves fit it too. They are labelled
   INVENTED for that reason (§0). Nothing breaks if the user changes them.

### 21.3 Consequences the user should see before approving

These are not open questions — the spec has decided them — but each is a large behaviour that
follows from a small rule, and the user should not meet it for the first time in play.

- **The credit rating recovers, slowly, and only on a clean turn.** ~~Every engine-side delta is
  negative and the only upward path is a verdict.~~ **Superseded by §0-A ruling 1.** The user read
  the one-way ratchet and rejected it, so §6.2a adds `RATING_RECOVERY_PER_TURN` = +1 on a turn with
  no emission, no missed debt payment and strictly positive growth. Five deltas still subtract and
  one adds. The consequence the user should now see is the *pace*: 20 consecutive clean turns to
  climb from the bottom of tier C to the bottom of tier B, and a country running any emission at all
  never earns the +1, because clause 1 and the emission penalty are mutually exclusive. The verdict
  is still the fast lever and the judge still owns the large moves.
- **The shortage rule inverts across sectors.** "The more sectors depend on a resource, the smaller
  the penalty" holds inside a sector's basket and reverses between sectors: extraction depends on
  coal alone, so a coal gap hits it at 100%, while heavy industry with six dependencies takes 27,3%
  from a total oil gap. No normalised weighting can satisfy both readings at once (§13.4).
- **Emission's exchange rate cannot be validated from the sources.** Each pp of emission converts
  about 0,13 pp of growth into FR worth 1% of GDP, so at the 50% ceiling that is +25 000 FR points
  at the standard start — 2,5× the entire tax take — against −7,50 pp of growth and −20 rating a
  turn. Whether that trade is fair depends on what orders *cost*, and orders are priced outside this
  model by judges; the digest is explicit that no price list exists. The only brake the engine owns
  is the rating bleed, and §6.2a sharpens it rather than softening it: an emitting country not only
  loses 0,4 points per pp, it also forfeits the +1 every non-emitting country collects, so the gap
  against a clean neighbour is the penalty plus one. If emission turns out to be the dominant
  strategy in play, `EMISSION_FR_RATE` is the knob.
- **A reserve addition is charged before debt service.** So banking money can starve an
  auto-serviced loan and cost up to 10 rating points, with warnings V14 and V17 but no abort
  (§8.4a). It is the same choice `debtAutoService = false` already offers, reached by a different
  route.

---

## 22. Response to the adversarial review

`SPEC-REVIEW.md` raised 9 blocking problems and 16 non-blocking findings. **All 25 are fixed in
this revision.** No finding was rejected as wrong.

Three fixes depart in detail from what the review asked for, and the reasoning is recorded here so
the next reader does not think the departure is an oversight.

**1. B2 — I chose the reading the worked example did *not* suggest, and changed the example.**

The review noted that §19.8's `min(2 220, 15 483,20)` used gross `frGenerated` and so ignored the
500 reserve addition booked at step 6, "which suggests one reading, but the pipeline order suggests
the other". I took the pipeline order as authoritative: the reserve addition is charged at step 6,
so `frStillAvailable` at step 7 is 14 983,20, not 15 483,20. §19.8 and §19.9 are updated
accordingly, and §19.9's "FR left after debt service" changes from 13 263,20 to **12 763,20**. Every
other number in §19 is unchanged, because the reserve addition was always inside `frSpent`.

Reason: the pipeline is what an implementer follows, and a spec whose example disagrees with its own
step order is worse than one whose example needed a correction. The choice also makes the arrears
path in §17 reachable without invalid input, which the review's own N12 asked for.

**2. B7 — I gave two ratios for the chosen rate, not one.**

The review asked for "16,59% of GDP at the standard start". That figure is the ratio for the
*calculator's observed* 8 294,76 points at 2 000 obor per point. This spec's own formulas generate
10 017,00 points at the same standard start, which is 20,03% of GDP. Quoting only 16,59% would
describe the source material's economy rather than this one, so §1.2 states both and labels which is
which. The comparison the user needs — 82,95× at 1:1, 0,008% at 1 obor per point, about a fifth of
GDP at 2 000 — is intact either way.

**3. B3 — I took the first of the review's two options, not the second.**

The review offered either a full read-only derive pass at step 1 or a split into an input-range gate
plus a later ledger gate. I took the derive pass: §16.2's step 1 now runs the read-only form of steps
2 through 13, collects every error, and is genuinely the only step that can abort. The split option
would have left two abort sites and would have made `deriveEconomy` and `resolveTurn` diverge in
structure, and PLAN decision 6 requires the two to agree field for field.

One consequence is worth stating plainly: **the derive pass must be total.** It computes through step
13 even on invalid input, using the guards in §20, and never throws. That is what lets step 1 report
the complete error list instead of the first error, and what lets T12 show live [A] values while a
field is momentarily out of range.
