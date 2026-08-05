# T11-B — Economics calculator engine. Design.

The authority is `.plan/T11/FORMULA-SPEC.md`. This file says how that spec becomes code: the file
list, the real signatures, the algorithms that are not one-liners, the integration points, the edge
cases, the verification commands, and what T11-B does not do.

**Where this design and the spec disagree, the spec wins.** Every place this design adds something
the spec does not state is marked **ADDITION** with a reason. There are six of them and they are
listed together in section 12.

## 0. The spec was re-verified before this design was written

I recomputed §19 end to end at double precision from the spec's formulas alone. Every published
number reproduces exactly: `gdpTotal` 106 000 000; all eight resource rows; all six sector
penalties; `plannedGrowthPct` 3,018868; `frCore` 13 363,197826; `frGenerated` 15 483,197826;
`micGenerated` 307,933585; `debtLimit` 34 837,20; `newLoanAvailable` 28 837,20; `reserveCap`
30 966,40; the running balance 14 983,197826 → 12 763,197826 → 12 663,197826; `frRemainder`
10 163,197826; `micRemainder` 197,933585; `autoInvestGrowthPp` 0,5702466962; `modifierPp`
−0,9028665114; all six `finalPct`; all six `gdpNextObor`; the total 107 795 555 against the
unrounded 107 795 555,0249; `ratingNext` 76.

The standard-start figures in §21.1 also reproduce: `frGenerated` 10 017,00, `micGenerated` 233,20,
`debtLimit` 22 538,25.

**The spec is arithmetically sound. Nothing in it needs fixing and nothing in it may be changed.**

## 1. Scope and the purity rule

Everything lands in a new directory `src/economy/`. **No file outside `src/economy/` is created or
modified by T11-B.** `src/state/world-store.ts` already exposes `economicsOf`,
`setCountryEconomics` and `patchCountryEconomics`; `src/ui/EconomicsPanel.tsx` stays the stub that
T12 replaces.

`src/economy/` must contain, at runtime, no React, no `@preact/signals-react`, no DOM, no canvas, no
`localStorage`, no `Math.random`, no `Date`, no `performance`. The one import it takes from outside
the directory is **type-only**: `import type { JsonRecord } from "../state/schema";` in
`serialize.ts`. A type-only import erases at build time, so it adds no runtime coupling, and reusing
the store's own JSON type is what keeps the persisted slot honest. `purity.test.ts` scans the
directory and enforces all of this (section 10).

Style is `javascript/CLAUDE.md`: semicolons everywhere; braces and a body on its own line for every
`if`/`else`/loop; double quotes only; **exactly one grouped named export at the end of each file**,
types included, no inline `export`, no default export. There is no barrel `index.ts` — the package
has no barrels anywhere and T12 imports from the specific module.

## 2. Files

Eighteen source files. Every stage function is exported so it can be tested in isolation;
`deriveEconomy` and `resolveTurn` are the only two entry points T12 uses.

| File | Responsibility |
| --- | --- |
| `types.ts` | Every type in spec §18, plus the derived stage types this design adds. No runtime code at all. |
| `constants.ts` | **The single retuning surface.** `ECONOMY_CONSTANTS` holds every scalar from spec §2. The structured tables — rating tiers, the 11 control bands, the per-tier debt table, the resource→sector matrix and its inversion, sector and resource key order and labels — sit beside it in the same file. |
| `num.ts` | `roundTo`, `clamp`, `finiteOr`, `safeDivide`, `isNonNegativeNumber`, `isIntegerInRange`. |
| `rating.ts` | Tier lookup, `ratingFactor`, the per-tier debt terms, and the step-13 rating stage including the §6.2a clean-turn predicate. |
| `control.ts` | Band index, band name, `controlGrowthPp`, `controlFrMultiplier`, `stepLimitPp`. |
| `resources.ts` | Step 2: needs, extraction, blockaded imports, clipped exports, supply, coverage, shortage, free, next stock, per-sector shortage penalty. |
| `generation.ts` | Step 3: shares, `plannedGrowthPct`, rating and control factors, `frGenerated`, `micGenerated`, and the emission/defence derived terms. |
| `actions.ts` | Step 4: nationalization / privatization resolution and the concession grant. |
| `debt.ts` | Step 5 borrowing and step 7 servicing, the shortfall penalty and the status machine. |
| `savings.ts` | Step 6 reserve and stockpile, step 8 upkeep, step 10 auto-investment. |
| `growth.ts` | Step 11: the modifier sum, per-sector pre-shortage and final growth, the overall rate. |
| `gdp.ts` | Step 12: next-turn sector volumes, the concession cost booking, the next total and the change. |
| `validate.ts` | V1–V13 as errors. Warnings V14–V20 are produced by the stage that owns them. |
| `derive.ts` | `deriveEconomy` — runs the stages in spec order and assembles one `DerivedEconomy`. |
| `pipeline.ts` | `resolveTurn` — the 15 ordered steps as data, the draft fold, and the next state. |
| `history.ts` | `TurnRecord` assembly and the `TURN_HISTORY_MAX` trim. |
| `economy-state.ts` | `createInitialEconomy` and the per-sector / per-resource factories. |
| `serialize.ts` | `economyToJson` and the repairing `economyFromJson`. |

Test files mirror the source files, minus `types.ts` (no runtime) and `derive.ts` (covered by the
fixtures), plus `fixture.test.ts`, `clean-turn.test.ts` and `purity.test.ts` — seventeen in all.

## 3. Public API — real signatures

### 3.1 The two entry points (`derive.ts`, `pipeline.ts`)

```ts
type EconomyContext = {
  provinceCount: number;
};

function deriveEconomy(state: EconomyState, context?: EconomyContext): DerivedEconomy;

function resolveTurn(state: EconomyState, context?: EconomyContext): TurnResolution;

type TurnResolution =
  | { ok: true; next: EconomyState; record: TurnRecord }
  | { ok: false; errors: ValidationError[] };
```

`context` defaults to `{ provinceCount: 0 }`. **ADDITION 1**, and it is forced: spec §15.3 says
`provinceCount` "comes from the country's own `provinceIds.length` in the T05 store, so it is live
and needs no economy field", and the engine may not read a store. The default is the G6 case — zero
provinces cost zero — so the spec's own one-argument signature `resolveTurn(state)` stays valid and
total.

`resolveTurn` never mutates `state`. On `ok: false` nothing at all is produced beyond the error
list; a test deep-equals the input state before and after.

### 3.2 Stage functions

Each takes plain values, returns a fresh object, and never touches `state` outside reads.

```ts
// resources.ts
type ResourceStage = {
  resources: ResourceDerived[];
  penaltyByKey: Record<SectorKey, number>;
  warnings: string[];
};
function deriveResourceStage(
  sectors: readonly Sector[],
  resources: readonly ResourceState[],
): ResourceStage;

// generation.ts
function deriveGenerationStage(state: EconomyState, gdpTotalObor: number): GenerationStage;

// actions.ts
function deriveActionStage(
  state: EconomyState,
  controlBandIndex: number,
  frGenerated: number,
  micGenerated: number,
): ActionStage;
function deriveConcessionStage(state: EconomyState): ConcessionStage;

// debt.ts
function deriveBorrowStage(
  state: EconomyState,
  tier: RatingTier,
  frGenerated: number,
): BorrowStage;
function deriveDebtServiceStage(state: EconomyState, frBalanceAfterSavings: number): DebtStage;

// savings.ts
function deriveSavingsStage(
  state: EconomyState,
  frGenerated: number,
  gdpTotalObor: number,
): SavingsStage;
function deriveUpkeepStage(micStockEnd: number, frBalanceAfterDebt: number): UpkeepStage;
function autoInvestGrowthPp(
  frRemainder: number,
  micRemainder: number,
  gdpTotalObor: number,
): number;

// growth.ts
function deriveGrowthStage(input: GrowthInput): GrowthStage;

// gdp.ts
function deriveGdpStage(
  sectors: readonly SectorDerived[],
  concession: ConcessionStage,
  gdpTotalObor: number,
  provinceCount: number,
): GdpStage;

// rating.ts
function ratingTierOf(score: number): RatingTier;
function ratingFactorOf(score: number): number;
function debtTermsOf(tier: RatingTier): DebtTerms;
function deriveRatingStage(input: RatingInput): RatingStage;

// control.ts
function controlBandIndexOf(position: number): number;
function controlBandNameOf(bandIndex: number): string;
function controlGrowthPpOf(bandIndex: number): number;
function controlFrMultiplierOf(bandIndex: number): number;
function stepLimitPpOf(bandIndex: number): number;

// validate.ts
type DerivedCore = Omit<DerivedEconomy, "errors" | "warnings">;
function collectValidationErrors(state: EconomyState, derived: DerivedCore): ValidationError[];

// history.ts
function buildTurnRecord(
  state: EconomyState,
  derived: DerivedEconomy,
  steps: readonly TurnStepRecord[],
): TurnRecord;
function pushTurnRecord(
  history: readonly TurnRecord[],
  record: TurnRecord,
): TurnRecord[];

// economy-state.ts
function createInitialEconomy(): EconomyState;
function createSector(key: SectorKey): Sector;
function createResourceState(key: ResourceKey): ResourceState;

// serialize.ts
function economyToJson(state: EconomyState): JsonRecord;
function economyFromJson(raw: unknown): EconomyFromJsonResult;   // { state, repairs: string[] }

// num.ts
function roundTo(value: number, decimals: number): number;
function clamp(value: number, min: number, max: number): number;
function finiteOr(value: number, fallback: number): number;
function safeDivide(numerator: number, denominator: number): number;
function isNonNegativeNumber(value: unknown): boolean;
function isIntegerInRange(value: unknown, min: number, max: number): boolean;
```

### 3.3 `DerivedEconomy` — spec §18 plus the fields the pipeline needs

Spec §16.2 says steps 2–13 "do not recompute anything … each step reads its part of" the single
`DerivedEconomy`. Seven quantities the later steps and the next state require are not in §18's
listing, so `DerivedEconomy` carries them too. **ADDITION 2.** It adds no formula and changes no
number; every added field is [A] by construction and §18's own fields keep their exact names, types
and meanings.

```ts
  natFrPayout: number;
  natMicPayout: number;
  action: ActionStage;                 // resolved kind, roll, success, control shift, modifier
  concessionGranted: boolean;
  concessionSectorKey: SectorKey | null;
  newLoanProceeds: number;
  createdLoan: Loan | null;
  loanService: LoanServiceDerived[];
  frTaxBase: number;
  nationalizationAvailable: boolean;   // spec §15.5 tags these [A]; §18 omitted them
  privatizationAvailable: boolean;
```

`LoanServiceDerived` is `{ loanId, serviced, requiredFr, allocatedFr, shortfall, interestDue,
interestPaid, principalPaid, principalNext, turnsRemainingNext }`.

## 4. The derive pass — algorithm

`deriveEconomy` is one function that calls the stages in the order of spec §16.2 steps 2 through
13, threading the running FR balance of §8.4a. It is **total**: it never throws, it computes through
step 13 on invalid input using the §20 guards, and it collects the full error list at the end.

```
gdpTotalObor = Σ sector.gdpObor                                        frozen here, §4.2a
step 2   resourceStage      -> resources[], penaltyByKey, V19 warnings
step 3   generationStage    -> shares, plannedGrowthPct, ratingFactor, control block,
                               frGenerated, micGenerated, inflation/defence terms
         frBalance0 = frGenerated
step 4   actionStage        -> payouts, rating delta, control shift, timed modifier, drag turns
         concessionStage    -> granted?, concessionGrowthPp (non-stacking, includes grant turn)
         frBalance4 = frBalance0 + natFrPayout
step 5   borrowStage        -> debtLimit, newLoanAvailable, createdLoan, newLoanProceeds
         frBalance5 = frBalance4 + newLoanProceeds
step 6   savingsStage       -> micStockWithdrawApplied, micStockEnd(pre-upkeep), micUpkeepDue,
                               reserveCap, reserveAddApplied, reserveWithdrawApplied,
                               reserveEnd, reservePenaltyPp, V14/V15 warnings
         frBalance6 = frBalance5 + reserveWithdrawApplied - reserveAddApplied
step 7   debtStage          -> per-loan service against frBalance6, totals, penalty, status,
                               V17 warning
         frBalance7 = frBalance6 - allocatedTotal
step 8   upkeepStage        -> micPointsPaidFor, micStockLost, micStockEnd, micUpkeepPaid,
                               V16 warning
         frBalance8 = frBalance7 - micUpkeepPaid
step 9   frOtherIncome / micOtherIncome / ledgers
         frBalance9 = frBalance8 + frOtherIncome - Σ frExpenseLines.points
         frAvailable / frSpent / frRemainder, micAvailable / micSpent / micRemainder
step 10  autoInvestGrowthPp(frRemainder, micRemainder, gdpTotalObor)
step 11  growthStage        -> modifierPp, per-sector pre-shortage and final, overallGrowthPct,
                               V18 warnings
step 12  gdpStage           -> per-sector gdpNextObor, concession cost, totals, V20 warning
step 13  ratingStage        -> cleanTurn, recovery, deltas, ratingNext
errors   = collectValidationErrors(state, core)
warnings = the stage warnings, concatenated in derive order (V19, V14, V15, V17, V16, V18, V20)
```

`frRemainder` is computed as `frAvailable − frSpent`; the running balance `frBalance9` is computed
separately and **a test asserts the two agree to 1e-9** (spec §8.4a: "T11-B asserts the identity in
a test"). Both are exposed — §18 already names `frBalanceAfterSavings`, `frBalanceAfterDebt` and
`frBalanceAfterUpkeep`.

### 4.1 Stage details that are not transcription

**Resources (§13.3, §13.4).** `needUnits(r) = ceil(Σ dependent sector gdpObor / 1 000 000)` — the
ceiling of the summed quotient, not the sum of ceilings. The dependency matrix is stored once in
`constants.ts` as `RESOURCE_DEPENDENTS: Record<ResourceKey, SectorKey[]>` exactly in §13.2's order,
and `SECTOR_DEPENDENCIES: Record<SectorKey, ResourceKey[]>` is derived from it at module load by
inversion, so the two can never drift. `other1`/`other2` map to `[]`. The per-sector denominator
`Σ weight` is computed, never table-typed. `Σ weight === 0 → penalty 0` (G3).

**Generation (§8.1, §8.2).** `privatizationFrDrag` reads the **incoming**
`state.privatizationFrDragTurns > 0 ? 0,95 : 1,00`. A drag created at step 4 this turn does not
apply this turn — §15.2 says it starts next turn, and §19.5 pins it. Same for `privatizationMicDrag`.
`frRegimeMultiplier` is `mobilized ? 0,50 : 1,00`, `micRegimeMultiplier` is `mobilized ? 2,00 : 1,00`.

**Actions (§15.2).** Resolution is a pure function of `state.pendingAction`. Nationalization always
succeeds structurally; the roll only scales `payoutFraction = 0,2625 × roll / 10` against
`frGenerated` (civilian) or `micGenerated` (military). Privatization succeeds on `roll >= 6`.
Success creates a timed modifier `+0,75 × roll / 10` for 2 turns, shifts control `+3` and arms the
3-turn drag; failure creates `−0,25` for 2 turns and a `−2` rating delta. Availability is checked
here and consumed by V8 — when the action is unavailable the stage still resolves nothing and step 1
aborts, so the unavailable branch can never write.

**Concessions (§15.3).** `concessionGrowthPp` is `+1,50` when **any** `concessions[].active` is true
**or** a grant resolves this turn, and `0` otherwise. Non-stacking is the `any`, not a sum (G20).
The cost is computed at step 12 only, `min(round(gdpTotal / provinceCount, 0), gdpNext(chosen))`,
deducted from that sector's `gdpNextObor` before the total is summed, with V20 when the clamp bites.

**Debt (§14).** A loan is serviced only when `loan.createdTurn < state.turn`; the loan created at
step 5 has `createdTurn === state.turn` and is skipped entirely — no `requiredFr`, no tick, no
contribution to either total. `frStillAvailable(l)` is `frBalance6 − Σ allocations already made`,
walking `loans[]` in array order, so the oldest loan is paid in full and the newest is starved.
`principalDue = principal / max(1, turnsRemaining)`. Unpaid interest capitalises:
`principalNext = max(0, principal − principalPaid + (interestDue − interestPaid))`. The status
machine reads `state.defaultLastTurn` as "the previous turn closed with a shortfall":

```
shortfallTotal === 0                        -> next status "normal",  defaultLastTurnNext false
shortfallTotal > 0 && !defaultLastTurn      -> next status "arrears", defaultLastTurnNext true
shortfallTotal > 0 &&  defaultLastTurn      -> next status "default", defaultLastTurnNext true
```

V7 tests the **incoming** `state.debtStatus`, because that is what §17 says and because step 5 runs
before step 7. So a country in `default` cannot borrow on the turn it clears its arrears; it can on
the next one, once the status it carries in reads `normal`.

**Savings (§9).** Order inside step 6 is stockpile first, then reserve — §16.2 says so.
`reserveAddApplied = reserveStart > reserveCap ? 0 : min(reserveAdd, max(0, reserveCap −
reserveStart))`. Upkeep at step 8 uses `floor(frBalance7 / 2)` points paid for and recomputes
`micUpkeepPaid` from the surviving stock, so it can never exceed the balance (G28).

**Growth (§5).** One `modifierPp` for every sector. `preShortagePct = perm + temp + modifierPp`.
`finalPct = preShortagePct > 0 ? preShortagePct × (1 − penalty) : preShortagePct`, then floored at
−100. `overallGrowthPct` is the GDP-weighted mean of `finalPct`, guarded by `safeDivide`.

**GDP (§5.5).** `gdpNextObor = max(0, round(gdpObor × (1 + finalPct / 100), 0))` per sector, then
the concession deduction, then `gdpNextTotalObor` as the **sum of the rounded parts** (G26).

**Rating (§6.2, §6.2a).** `cleanTurn = emissionPct === 0 && shortfallTotal === 0 &&
overallGrowthPct > 0`, all three read unrounded and read from this turn. The deltas are a list of
`{ reason, points }`: emission `−round(0,40 × emissionPct, 0)`, nationalization `−4`, failed
privatization `−2`, debt shortfall `−debtRatingPenalty`, unjustified mobilization `−5`, clean-turn
recovery `+1`. Zero-valued lines are omitted from the list except the recovery, which §6.4 says
always appears as `ratingRecovery` and, when non-zero, as a line. `ratingNext = clamp(ratingScore +
Σ points, 0, 100)`; the clamp sees the sum, never the terms.

## 5. The turn pipeline

`resolveTurn` calls `deriveEconomy` once as step 1. If `derived.errors.length > 0` it returns
`{ ok: false, errors }` and nothing else happens.

Otherwise it folds a draft over an ordered array of step descriptors:

```ts
type StepInput = {
  state: EconomyState;        // the immutable input, for reference reads
  derived: DerivedEconomy;    // the single evaluation of every formula
  draft: EconomyState;        // what the next state looks like so far
  context: EconomyContext;
};
type StepOutput = {
  draft: EconomyState;        // a NEW object; the input draft is never mutated
  record: TurnStepRecord;
};
type TurnStep = {
  name: string;
  run: (input: StepInput) => StepOutput;
};
const TURN_STEPS: readonly TurnStep[] = [ /* 15 entries, spec order */ ];
```

The draft starts as a structural copy of `state` (arrays and objects rebuilt, never shared). Each
step returns `{ ...draft, …its fragments }`. **The order is data, and `pipeline.test.ts` asserts
`TURN_STEPS.map((step) => step.name)` deep-equals the spec's fifteen names in the spec's order.**
That is the cheapest possible defence of the load-bearing ordering.

Step names, verbatim from §16.2: `derive-and-validate`, `resources`, `generation`, `actions`,
`borrowing`, `savings`, `debt-service`, `upkeep`, `spending`, `auto-invest`, `growth`, `gdp`,
`rating`, `flags`, `commit`.

Which steps write which draft fields — nothing else writes anything:

| Step | Writes to the draft |
| --- | --- |
| 1–3, 9–13 | nothing (pure reporting; step 13's `ratingScore` lands at `commit`) |
| 4 `actions` | `timedModifiers` (append the created one), `nextModifierId`, `privatizationFrDragTurns`, `privatizationMicDragTurns`, `concessions` (append the grant), `nextConcessionId` |
| 5 `borrowing` | `loans` (append `createdLoan`), `nextLoanId` |
| 6 `savings` | `reserveFr = reserveEnd`, `micStock = micStockEnd` (pre-upkeep) |
| 7 `debt-service` | `loans` rolled forward (principal, turnsRemaining), `debtStatus`, `defaultLastTurn` |
| 8 `upkeep` | `micStock = micStockEnd` (post-loss) |
| 14 `flags` | timed modifiers decremented and expired; both drag counters decremented; both cooldowns; `growthTemporaryPct` cleared on every sector; `pendingAction`, `pendingConcession` → null; `borrowRequest`, `reserveAdd`, `reserveWithdraw`, `micStockAdd`, `micStockWithdraw`, every `importsRequested`, every `exports` → 0; `resources[].stockUnits = stockNextUnits`; `emissionPctLast`, `militaryPctLast` |
| 15 `commit` | `sectors[].gdpObor = gdpNextObor`, `ratingScore = ratingNext`, `controlPosition = controlNext`, `turn += 1`, `history` push and trim, and the storage-precision rounding pass |

Two ordering details that the fixture pins:

- **The drag counter and the cooldown are decremented after step 4 set them.** A privatization that
  resolves this turn sets `privatizationFrDragTurns` to 3 at step 4 and step 14 takes it to 2, so
  the drag is live on the next three turns. `turnsSincePrivatization` is set to 0 at step 14 for the
  kind that resolved and incremented by 1 for the kind that did not (§19.15: 5 → 6 for the other).
- **A timed modifier created this turn is decremented this turn**, 2 → 1, so `ACTION_EFFECT_TURNS`
  = 2 means "this turn and the next". Modifiers reaching 0 are dropped.

A loan whose `principalNext` rounds to 0 at `POINT_DECIMALS` is removed from `loans` and the step-7
record carries a note. **ADDITION 3**: §14.3 says a loan "always closes at exactly 0" but never says
to remove it, and a kept zero loan would demand `requiredFr` 0 forever and grow the array without
bound across a long game.

### 5.1 What each step record carries

`TurnStepRecord` is `{ step, deltas: { label, value, unit }[], notes: string[] }`. Units are the
strings `"obor"`, `"fr"`, `"mic"`, `"pp"`, `"pct"`, `"units"`, `"rating"`, `"turns"`, `"count"`.
Values are rounded to the stored precision of their unit. Records stay flat — no nested record
inside a delta — because `sanitizeRecord` allows 8 container levels and
`data → history → record → steps → step → deltas → delta` already uses 7.

Budget: about 4–8 deltas per step, ~60 per turn, a few kB per `TurnRecord`, 12 records per country.

| Step | Deltas |
| --- | --- |
| `derive-and-validate` | `gdpTotalObor`, `plannedGrowthPct`, warning count |
| `resources` | one delta per resource with a non-zero shortage (`shortage`, unit `pct`), `freeUnits` total |
| `generation` | `frGenerated`, `micGenerated`, `frCore`, `frEmission`, `ratingFactor`, `controlFrMultiplier` |
| `actions` | `natFrPayout`, `natMicPayout`, `controlShift`, `timedModifierPp`; notes name the kind, the roll and success |
| `borrowing` | `debtLimit`, `newLoanAvailable`, `newLoanProceeds` |
| `savings` | `reserveAddApplied`, `reserveWithdrawApplied`, `reserveEnd`, `micStockEnd`, `micUpkeepDue` |
| `debt-service` | `debtRequiredTotal`, `allocatedTotal`, `debtShortfallTotal`, `debtRatingPenalty`; a note per loan |
| `upkeep` | `micUpkeepPaid`, `micStockLost` |
| `spending` | `frAvailable`, `frSpent`, `frRemainder`, `micAvailable`, `micSpent`, `micRemainder` |
| `auto-invest` | `investedObor`, `autoInvestGrowthPp` |
| `growth` | `modifierPp`, `overallGrowthPct`, and one delta per sector's `finalPct` |
| `gdp` | `gdpNextTotalObor`, `gdpChangeObor`, `concessionCostObor` |
| `rating` | one delta per rating line, then `ratingNext`; a note with the clean-turn verdict |
| `flags` | expired-modifier count, cleared-input count; notes for the cooldown resets |
| `commit` | `turn`, `gdpTotalObor`, `ratingScore`, `controlPosition` |

## 6. Rounding, and where it happens

`roundTo(x, d) = Math.sign(x) * Math.round(Math.abs(x) * 10 ** d) / 10 ** d`, implemented literally
per §3 so ties break away from zero symmetrically for signed growth and rating deltas.

**Nothing inside a derive pass ever reads a rounded value.** Rounding happens at exactly two
boundaries:

1. **The turn record**, by unit: percentages 4 dp, points 2 dp, obor whole, units whole, rating and
   control integers.
2. **The commit step**, applying the same table to the committed state: `reserveFr` and `micStock`
   and `loans[].principal` to 2 dp, `gdpObor` whole (already whole from §5.5), `stockUnits` whole,
   `ratingScore` / `controlPosition` / `turn` integers, `timedModifiers[].growthPp` 4 dp.

`gdpNextObor` is the deliberate exception §3 names: it is rounded per sector inside step 12 and the
total is the sum of those rounded parts.

Every number written to the draft or to a record passes `finiteOr(x, 0)` first, because
`sanitizeRecord` **drops** a `NaN`/`Infinity` key rather than nulling it and the field would vanish
from the saved document (G23).

## 7. Integration

### 7.1 With T05's store — the functions T12 will call

The engine itself calls nothing. `serialize.ts` is the seam:

- `economyToJson(state)` returns a `JsonRecord` suitable for
  `setCountryEconomics(countryId, json)` in `src/state/world-store.ts`. That function already runs
  `sanitizeRecord(data, MAX_JSON_DEPTH)` from `src/state/schema.ts`, so the output must be plain
  JSON, finite, `null` for absent, with no `Map`, no `Set` and no `undefined`.
- `economyFromJson(raw)` reads back what `economicsOf(countryId)?.data` returns — a `JsonRecord`
  whose fields a browser, an older build or a truncated write may have damaged. It **repairs and
  never throws**, mirroring `normalizeState`'s contract, and returns `{ state, repairs }`. The
  repairs it performs: insert any missing base sector at 0 obor with the default permanent growth;
  drop a duplicate or unknown sector key; keep at most `other1`/`other2`; insert any missing
  resource in `RESOURCE_KEYS` order and drop unknown ones; truncate each ledger list to 24 lines;
  coerce a non-finite or wrong-typed number to its default; clamp `ratingScore` and
  `controlPosition` into 0..100; drop malformed loans, concessions and timed modifiers; trim
  `history` to the newest 12.
- The persisted slot is `{ version: ECONOMY_SCHEMA_VERSION, data }`. `CountryEconomics.version` is
  already handled by the store; `economyFromJson` reads `schemaVersion` from the data itself and, at
  version 1, has nothing to migrate. `src/state/migrations.ts` is untouched — there is no earlier
  economy schema to migrate from.

### 7.2 With T12

T12 calls `deriveEconomy(state, { provinceCount })` on every keystroke for the live [A] fields, and
`resolveTurn(state, { provinceCount })` behind End Turn. `provinceCount` is
`countryById(id)?.provinceIds.length ?? 0` from `world-store.ts`. On `ok: true` T12 writes
`economyToJson(result.next)` through `setCountryEconomics`. On `ok: false` it renders
`result.errors` and writes nothing.

Display formatting — thousands separators, two-decimal percentages, comma decimals — is **not** the
engine's job. The engine returns numbers; T12 formats them.

## 8. Edge cases and failure modes

Every guard in spec §20 has a named home:

| Guard | Where |
| --- | --- |
| G1 divide by `gdpTotal` | `safeDivide` at all eight sites listed in §4.2a |
| G2 `needUnits === 0` | `resources.ts`, coverage 1 / shortage 0 |
| G3 no-dependency sector | `resources.ts`, `Σ weight === 0 → penalty 0` |
| G4 matured loan | `debt.ts`, `max(1, turnsRemaining)` |
| G5 `requiredTotal <= 0` | `debt.ts`, penalty 0 |
| G6 `provinceCount === 0` | `gdp.ts`, cost 0 |
| G7 sector pushed negative | `growth.ts` floor −100, `gdp.ts` floor 0 |
| G8 concession overshoot | `gdp.ts` `min(cost, gdpNext(chosen))` + V20 |
| G9 shortage sign flip | `growth.ts` multiplicative form, applied only when pre-shortage > 0 |
| G10, G11 clamps | `rating.ts`, `actions.ts` + commit |
| G12 negative stocks | the three `*Applied` clips |
| G13 negative remainder | V5/V6 abort, never a clamp |
| G14 emission/military bounds | V1/V2 plus V3/V4 |
| G15 `frGrowthFactor` | `clamp(…, 0,50, 1,50)` |
| G16 `frDefenceDrag` floor | `max(0,10, …)`, structural and currently unreachable |
| G17 the FR↔growth loop | `plannedGrowthPct` only; no iteration exists anywhere |
| G23 non-finite | `finiteOr` on every written number |
| G25 history growth | `pushTurnRecord` trims to 12 |

Beyond the spec's list, the implementation has to survive:

- **`NaN` inputs.** Every range check is written as a **negated** comparison —
  `!(value >= 0 && value <= EMISSION_PCT_MAX)` — so a `NaN` fails it. A positive check would pass
  `NaN` through into every downstream product. This is the single most likely way a half-typed T12
  field poisons the sheet, so `validate.test.ts` covers `NaN` for each of V1, V2, V9, V12 and V13.
- **A country with zero GDP.** Every share is 0, `frGenerated` is 0, `reserveCap` is 0 so a positive
  reserve blocks additions (correctly), `debtLimit` is 0 so V7 blocks borrowing, and `plannedGrowthPct`
  and `overallGrowthPct` are 0. No division and no `NaN`. Covered by a test.
- **More than 24 ledger lines, or a missing base sector.** Not a validation rule in §17, so
  `economyFromJson` repairs both at the boundary rather than the engine rejecting them at step 1.
- **An abort must write nothing.** `pipeline.test.ts` deep-equals the input state before and after a
  failed `resolveTurn`, and separately deep-equals it after a *successful* one, proving no mutation
  either way.
- **A loan array that outlives its term.** `turnsRemaining` 0 with principal left keeps demanding
  interest plus the whole principal — intended (G21), and a test pins it.
- **Reserve addition starving debt service** — the §8.4a consequence and §17's cheapest route to the
  arrears path. A test drives it and asserts V14/V17 and the rating penalty.

## 9. Test plan

`fixture.test.ts` is the primary artefact: spec §19, asserted table by table, at the precision the
spec prints. Sector volumes are asserted **within 1 obor** per §19.13, never by equality; every
other number is asserted with a 1e-6 tolerance on the unrounded value.

`clean-turn.test.ts` is the second fixture, and §19.14 requires it to be computed from scratch rather
than derived by editing §19. Its inputs, fixed here so the implementer does not drift:

> turn 1, standard start — five base sectors at 20 000 000 obor each with `growthPermanentPct` 3,00
> and `growthTemporaryPct` 0; `ratingScore` 70; `controlPosition` 50; `emissionPct` 0;
> `militaryPct` 10; not mobilized; no loans; `reserveFr` 0; `micStock` 0; no ledger lines; deposits
> 2 for coal and chemical and 1 for the other six, so every requirement is covered and no shortage
> fires.

Its expected values, computed at double precision for this design: `frGenerated` **10 017,00**,
`micGenerated` **233,20**, `reserveCap` **20 034,00**, `debtLimit` **22 538,25** (§21.1's own
number, so the fixture double-checks the debt table), `frRemainder` 10 017,00, `micRemainder`
233,20, `investedObor` 31 694 000, `autoInvestGrowthPp` **0,63388**, `modifierPp` **+0,63388**,
every `finalPct` **3,63388**, `overallGrowthPct` **3,63388**, every `gdpNextObor` **20 726 776**,
`gdpNextTotalObor` **103 633 880**, `cleanTurn` **true**, `ratingRecovery` **+1**, `ratingNext`
**71**, tier still **B**.

The other fifteen test files, in one line each:

- `constants.test.ts` — every scalar equals its §2 value; the 11 control rows equal §7.1's table
  cell for cell; the 7 debt rows equal §2.9; the matrix inversion round-trips §13.2 both ways.
- `num.test.ts` — `roundTo(−0,125, 2) === −0,13` and `roundTo(0,125, 2) === 0,13`; `finiteOr`;
  `safeDivide` by 0.
- `control.test.ts` — every band boundary position, both edges, and the neutral row exactly.
- `rating.test.ts` — every tier boundary; factor 0,30 / 1,00 / 1,30 at 0 / 70 / 100; the clean-turn
  predicate's three clauses, each failing alone; recovery plus a penalty summing plainly (−4 + 1);
  the clamp at 100 and at 0.
- `resources.test.ts` — §19.3's eight rows and six penalties; `needUnits` 0; export clip + V19.
- `generation.test.ts` — §19.4; the standard start; mobilized multipliers; the drag reading the
  incoming counter.
- `actions.test.ts` — nationalization payout in each currency; privatization at rolls 5 and 6;
  cooldown and lockout availability.
- `debt.test.ts` — §19.8; the created-this-turn skip; capitalisation; oldest-first starvation;
  `ceil` on the shortfall penalty and its cap of 10; the three-state machine.
- `savings.test.ts` — over-cap block, headroom clip, withdrawal clip, partial upkeep loss + V16.
- `growth.test.ts` — §19.12; a full shortage giving exactly 0 and never negative; the −100 floor.
- `gdp.test.ts` — §19.13 within 1 obor per sector; the concession cost and its clamp + V20.
- `validate.test.ts` — each of V1–V20 fires exactly when it should and not otherwise, `NaN`
  included.
- `pipeline.test.ts` — the 15 step names in order; abort writes nothing; no mutation on success;
  the `frBalance9 === frAvailable − frSpent` identity; history trim at 12; §19.16's closing state.
- `serialize.test.ts` — round trip through `sanitizeRecord`; depth ≤ 8; a `NaN` never reaches the
  document; every repair path.
- `purity.test.ts` — the source scan of section 10.

## 10. `purity.test.ts`

Modelled on `src/scaffold.test.ts`'s directory walk. It reads every `.ts` under `src/economy/` and
asserts:

1. no import specifier matches `react`, `react-dom`, `@preact/signals-react`, `../ui/`, or a `.css`;
2. the only import from outside `src/economy/` is the `import type { JsonRecord } from
   "../state/schema";` line, and it is a **type-only** import;
3. no source text contains `document.`, `window.`, `localStorage`, `Math.random`, `new Date`,
   `Date.now`, `performance.now`, `structuredClone` (the draft copy is written by hand so the code
   is explicit about what it copies), `fetch` or `console.`;
4. every file ends with exactly one `export {` statement and contains no other `export` keyword.

Rule 4 is style enforcement `javascript/CLAUDE.md` requires and nothing else in the package checks.

## 11. Verification

Run from `javascript/packages/prototypes/civitas/civitas-interactive-map`:

```bash
yarn typecheck                                   # tsc --noEmit; prints nothing on success
yarn test                                        # the whole suite; 593 tests pass today
yarn tsx --test src/economy/fixture.test.ts      # the §19 fixture alone
yarn tsx --test "src/economy/*.test.ts"          # the engine alone
grep -rnE "react|signals|document\.|window\.|localStorage|Math\.random|Date\.now|new Date" src/economy
```

The last command must print nothing. Done means: `yarn typecheck` clean, `yarn test` green with the
593 existing tests still passing plus the new ones, `fixture.test.ts` reproducing §19 number by
number, and the grep silent.

## 12. Every addition to the spec, in one place

| # | Addition | Why it is forced |
| --- | --- | --- |
| 1 | `EconomyContext = { provinceCount }` as an optional second parameter on both entry points | §15.3 requires `provinceCount` and forbids the engine from reading a store. Defaults to 0, which is exactly guard G6, so the spec's one-argument signature stays valid |
| 2 | Eleven extra [A] fields on `DerivedEconomy` (§3.3) | §16.2 forbids steps from recomputing, so everything steps 4–15 need must live in the single derived object. Adds no formula |
| 3 | A loan whose `principalNext` rounds to 0 leaves `loans[]` | §14.3 says a loan "closes at exactly 0" but never says to remove it; keeping it grows the array without bound |
| 4 | `economyToJson` / `economyFromJson`, and the repairs §7.1 lists | The store persists a `JsonRecord` and reads back arbitrary JSON. Without a repairing reader, one damaged field loses the whole economy |
| 5 | `createInitialEconomy()` starts with **0 deposits on every resource** and `militaryPct` 10 | §11 makes 10% the standard start. The spec never states a starting geology, and the engine cannot invent one — a judge sets deposits. A fresh country therefore reads a full shortage until then, which is a legitimate state and not a bug |
| 6 | Warning strings are prefixed with their V-code (`"V17: …"`) | §17 numbers the rules and `warnings` is a bare `string[]`; the prefix is what lets T12 group them and lets a test assert one |

## 13. Not part of T11-B

- **The panel.** Every field of T12: rendering, the [P]/[V]/[A] editability split, the judge
  affordance, the End Turn control, the history view, number formatting and localisation.
- **Any signal, store or persistence wiring.** T11-B writes no file outside `src/economy/` and adds
  no call site. `setCountryEconomics` already exists and T12 calls it.
- **A migration.** `ECONOMY_SCHEMA_VERSION` is 1 and there is no earlier economy document.
  `src/state/migrations.ts` stays as it is.
- **Retuning any constant.** All four §0-A rulings are final: tier B stays 2,25 × income, a
  concession costs total GDP ÷ province count, `INVEST_GROWTH_COEFF` stays 2,00, 1 FR point stays
  2 000 obor, privatization stays 6+ on a d10, unpaid upkeep loses only the uncovered points. The
  flat debt table in §21.1 is **not** implemented.
- **Anything cross-country.** A concession's counterparty, the resource exchange market, prices and
  order costs are all outside the model by §13.5 and §15.3.
- **Randomness.** The dice roll is an input. The engine has no random source and never will.
