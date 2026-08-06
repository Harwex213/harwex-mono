# T12 — Economics panel and End Turn

Authority for every number and every tag: `.plan/T11/FORMULA-SPEC.md`.
Engine: `src/economy/`, already committed and **frozen** — T12 adds no formula and changes no
constant. Style rules: `javascript/CLAUDE.md` (semicolons, braced bodies on their own line, double
quotes, one grouped named export at the end of each file, one CSS declaration per line).

T12 is a panel plus a store bridge. Everything numeric already exists; the work is rendering it,
deciding who may type into what, and getting the state to and from `civitas.state.v1` intact.

---

## 1. What already exists and must be reused

Read this list before writing anything. Building a second version of any of it is a review failure.

| Thing | Where | What T12 uses it for |
| --- | --- | --- |
| `deriveEconomy(state, context?)` | `src/economy/derive.ts` | every `[A]` value, live, on every keystroke |
| `resolveTurn(state, context?)` | `src/economy/pipeline.ts` | End Turn |
| `createInitialEconomy()` | `src/economy/economy-state.ts` | a country with no saved economy |
| `economyToJson` / `economyFromJson` | `src/economy/serialize.ts` | the persistence seam |
| `sumLines(lines)` | `src/economy/derive.ts` | ledger totals — do **not** write a second sum |
| `SECTOR_LABELS`, `RESOURCE_LABELS`, `RESOURCE_CATEGORY`, `SECTOR_DEPENDENCIES`, `CONTROL_BANDS`, `RATING_TIERS`, `DEBT_TERMS`, `REGIONS`, `CONCESSION_REGIONS`, `ECONOMY_CONSTANTS`, `BASE_SECTOR_KEYS`, `OTHER_SECTOR_KEYS`, `RESOURCE_KEYS` | `src/economy/constants.ts` | every label, every range, every enum in the UI |
| `STEP_NAMES` | `src/economy/pipeline.ts` | the history view's step order |
| `setCountryEconomics`, `economicsOf`, `economics`, `statePersistent`, `stateWarning`, `stateBytes`, `flushState`, `countryById` | `src/state/world-store.ts` | persistence, quota, read-only mode |
| `selectedCountry`, `selectedCountryId` | `src/state/selection-store.ts` | which country's sheet |
| `Panel` | `src/ui/Panel.tsx` | the chrome, the close control, the `read-only` badge |
| `useFieldCommit(value, commit, delayMs?)` | `src/ui/use-field-commit.ts` | the 200 ms buffered commit under every input |
| `EditableText`, `EditableTextArea` | `src/ui/*.tsx` | the `[P]` name and the `[V]` grounds/label strings |
| `saveNoticeFor(warning, touched)`, `groupDigits(value)` | `src/ui/country-overview.ts` | the quota sentence table, digit grouping |
| `--civ-*` tokens | `src/ui/theme.css` | every colour, gap, radius, font size |

`src/economy/purity.test.ts` scans `src/economy/**` for react, signals, DOM, `Math.random` and
`Date`. **T12 must not put a single line of UI or signal code inside `src/economy/`.**

---

## 2. Files

Twenty files. Four are pure logic with tests, one is a store with tests, eleven are components,
one is CSS, and `EconomicsPanel.tsx` is a rewrite of the stub.

| File | New? | Lines (target) | Responsibility |
| --- | --- | --- | --- |
| `src/state/economy-store.ts` | new | ~300 | The bridge: hydrate, hold, derive, write through, End Turn, judge mode |
| `src/state/economy-store.test.ts` | new | ~350 | Round trip, write-through, End Turn, judge mode, draft pruning |
| `src/ui/economics-format.ts` | new | ~150 | Every number → string. No React, no signals, no DOM |
| `src/ui/economics-format.test.ts` | new | ~180 | |
| `src/ui/economics-fields.ts` | new | ~180 | Tag → editability, numeric parsing, the step window, ledger array edits |
| `src/ui/economics-fields.test.ts` | new | ~260 | |
| `src/ui/economics-history.ts` | new | ~170 | `TurnRecord[]` → a readable view model |
| `src/ui/economics-history.test.ts` | new | ~200 | |
| `src/ui/EconomyField.tsx` | new | ~170 | `NumberField`, `SelectField`, `ToggleField` — tag-aware inputs |
| `src/ui/EconomyReadout.tsx` | new | ~70 | `Readout` — an `[A]` cell. Contains no `<input>` at all |
| `src/ui/EconomySectors.tsx` | new | ~230 | Areas 1 and 2: GDP, the 5+2 sectors, per-sector and overall growth |
| `src/ui/EconomyStanding.tsx` | new | ~180 | Areas 3, 4 and 9: credit rating, control scale, both step limits |
| `src/ui/EconomyBudget.tsx` | new | ~300 | Areas 5, 7, 8 and 9: emission, military, FR/MIC generation, the four ledgers |
| `src/ui/EconomySavings.tsx` | new | ~160 | Area 6: FR reserve and MIC stockpile |
| `src/ui/EconomyResources.tsx` | new | ~180 | Area 10: the eight resources |
| `src/ui/EconomyDebt.tsx` | new | ~200 | Area 11: capacity, borrowing, the loan table, servicing |
| `src/ui/EconomyFlags.tsx` | new | ~240 | Area 12: mobilization, region, nat/priv, concessions, cooldowns, timed modifiers |
| `src/ui/EconomyTurn.tsx` | new | ~230 | End Turn, the pre-flight error list, the turn history |
| `src/ui/EconomicsPanel.tsx` | rewrite | ~180 | Shell, legend, judge toggle, notices, section composition |
| `src/ui/economics.module.css` | new | ~380 | Tokens only |

No file outside this list is created. `src/economy/**` is not touched. `src/state/migrations.ts` is
not touched (`ECONOMY_SCHEMA_VERSION` is 1 and there is no earlier economy document).

---

## 3. `src/state/economy-store.ts`

### 3.1 Why a store at all

Three problems the panel cannot solve on its own:

1. **`economyFromJson` is a *repairing* reader.** Round-tripping through JSON on every keystroke
   would let the reader silently rewrite a half-typed value. So the hydrated `EconomyState` object
   is held in memory and is the live truth for the session.
2. **`deriveEconomy` must run once per change, not once per readout.** A `computed` memoises it.
3. **`setCountryEconomics` silently no-ops for an unknown country id and `sanitizeRecord` DROPS a
   `NaN` key.** One writer, guarded, is the only way to keep that from being a scattered hazard.

### 3.2 Shape

```ts
type EconomySlot = {
  countryId: number;
  state: EconomyState;
  repairs: readonly string[];
};

type LedgerListKey =
  | "frExpenseLines"
  | "micExpenseLines"
  | "frIncomeLines"
  | "micIncomeLines";

type TurnOutcome =
  | { ok: true; countryId: number; turn: number; record: TurnRecord; saved: boolean }
  | { ok: false; countryId: number; turn: number; errors: readonly ValidationError[] };
```

Private writable signals:

```ts
const draftsSignal = signal<Map<number, EconomyState>>(new Map());
const judgeSignal = signal(false);
const outcomeSignal = signal<TurnOutcome | null>(null);
```

Public API — the grouped export at the end of the file:

```ts
// --- pure, exported for its test -------------------------------------------
function hydrateEconomy(slot: CountryEconomics | null): {
  state: EconomyState;
  repairs: string[];
};

// --- read ------------------------------------------------------------------
const judgeMode: ReadonlySignal<boolean>;
const selectedEconomy: ReadonlySignal<EconomySlot | null>;
const selectedDerived: ReadonlySignal<DerivedEconomy | null>;
const lastTurnOutcome: ReadonlySignal<TurnOutcome | null>;

// --- write -----------------------------------------------------------------
function setJudgeMode(on: boolean): void;
function toggleJudgeMode(): void;
function updateEconomy(countryId: number, mutate: (current: EconomyState) => EconomyState): void;
function updateSector(countryId: number, key: SectorKey, patch: Partial<Sector>): void;
function updateResource(countryId: number, key: ResourceKey, patch: Partial<ResourceState>): void;
function updateLoan(countryId: number, loanId: number, patch: Partial<Loan>): void;
function setLedgerLines(countryId: number, list: LedgerListKey, lines: readonly LedgerLine[]): void;
function addOtherSector(countryId: number, name: string, grounds: string): void;
function removeOtherSector(countryId: number, key: SectorKey): void;
function clearLedgerLines(countryId: number): void;
function endEconomyTurn(countryId: number): TurnOutcome;
function dismissTurnOutcome(): void;

// --- lifecycle -------------------------------------------------------------
function initEconomySync(): () => void;
function resetEconomyStore(): void;   // test seam: drops every draft, judge off, outcome null
```

### 3.3 `hydrateEconomy` — pure

```
hydrateEconomy(null)  -> { state: createInitialEconomy(), repairs: [] }
hydrateEconomy(slot)  -> economyFromJson(slot.data)
```

`economyFromJson` never throws and always returns a usable state, so there is no failure branch.

### 3.4 `selectedEconomy` — a computed with no write

```ts
const selectedEconomy = computed(() => {
  const id = selectedCountryId.value;
  if (id === null) {
    return null;
  }
  const draft = draftsSignal.value.get(id);
  if (draft !== undefined) {
    return { countryId: id, state: draft, repairs: [] };
  }
  const slot = economics.value.get(id) ?? null;
  const hydrated = hydrateEconomy(slot);
  return { countryId: id, state: hydrated.state, repairs: hydrated.repairs };
});
```

Three properties this shape buys, all load bearing:

- **No signal is written during render.** Hydration is a pure function inside a `computed`. An
  effect that hydrated into a signal would fire during a render pass and is the classic way to get
  an infinite loop here.
- **Once a draft exists the computed stops subscribing to `economics`.** `computed` tracks
  dynamically, so after the first edit another country's save does not re-hydrate this one.
- **A country the user only *looks at* is never written.** `hydrateEconomy(null)` produces the
  standard opening sheet for display; nothing lands in `civitas.state.v1` until the first edit or
  End Turn. That keeps a 60-country document from growing 60 economies nobody touched.

`repairs` is non-empty only on the render right after a reload, before the first edit. That is
exactly when the panel should say "the saved economy was repaired". After the first edit the draft
wins and `repairs` is empty, which is correct: the repairs have been superseded.

### 3.5 `selectedDerived`

```ts
const selectedDerived = computed(() => {
  const slot = selectedEconomy.value;
  if (slot === null) {
    return null;
  }
  const country = countryById.value.get(slot.countryId) ?? null;
  const provinceCount = country === null ? 0 : country.provinceIds.length;
  return deriveEconomy(slot.state, { provinceCount });
});
```

`provinceCount` feeds §15.3's concession cost (`gdpTotal / provinceCount`). Reading `countryById`
subscribes the panel to province painting, which is correct — painting a province changes what a
concession costs. `deriveEconomy` is total and never throws, so this computed is safe while a
field is momentarily out of range. Guard G6 (`provinceCount === 0`) is the engine's problem and it
already handles it.

### 3.6 The single writer

```ts
function commitEconomy(countryId: number, next: EconomyState): void {
  if (!countryById.peek().has(countryId)) {
    return;
  }
  const drafts = new Map(draftsSignal.value);
  drafts.set(countryId, next);
  draftsSignal.value = drafts;
  setCountryEconomics(countryId, economyToJson(next));
}
```

`updateEconomy` is `commitEconomy(id, mutate(current))` with `current` read through
`selectedEconomy.peek()` when the id matches, otherwise `draftsSignal.peek().get(id)` and then
`hydrateEconomy(economicsOf(id))`. `.peek()`, never `.value` — these run in event handlers and must
not subscribe.

**Write-through is synchronous and there is no second debounce.** `setCountryEconomics` calls
`markDirty`, and the T05 writer already coalesces the `localStorage` write at 400 ms. The inputs
above it are already buffered at 200 ms by `useFieldCommit`, so the real rate is about five
`economyToJson` calls a second over a ~200-field document — microseconds. A second debounce inside
this store would add a window in which a closing panel loses the last edit for no gain.

The five collection helpers are thin wrappers, each replacing its array rather than mutating it
(the T05 rule: a mutated array is `Object.is`-equal to itself and nothing re-renders):

```ts
updateSector   -> { ...state, sectors: state.sectors.map(s => s.key === key ? { ...s, ...patch } : s) }
updateResource -> the same over `resources`
updateLoan     -> the same over `loans`
setLedgerLines -> { ...state, [list]: lines.slice(0, LEDGER_LINE_MAX).map(l => ({ ...l })) }
```

`addOtherSector(countryId, name, grounds)` appends `createSector(key)` with `name` and `grounds`
overridden and `gdpObor` 0, where `key` is the first free member of `OTHER_SECTOR_KEYS`. It returns
early when both slots are taken or `grounds.trim() === ""` — §4.1 makes an Other sector without
grounds illegal (V10), so the store refuses to create one rather than creating an invalid state the
panel then has to explain.

`clearLedgerLines` empties all four lists in one write — §8.5's "clear all lines" button.

### 3.7 `endEconomyTurn`

```
1. read state and provinceCount (peek, never value)
2. result = resolveTurn(state, { provinceCount })
3. if (!result.ok) -> outcomeSignal = { ok: false, countryId, turn: state.turn, errors }
                      and return it. NOTHING is written. The engine already guarantees this.
4. commitEconomy(countryId, result.next)
5. flushState()                      // resolve the quota outcome NOW, not 400 ms later
6. saved = statePersistent.peek() && (stateWarning.peek()?.kind !== "quota")
7. outcomeSignal = { ok: true, countryId, turn: result.record.turn, record, saved }
8. return it
```

Step 5 is T09's rule applied to the one write in this panel that is irreversible: an End Turn that
did not reach disk is data loss, and discovering it 400 ms later reads as "it worked, then a banner
appeared". Steps 4 through 7 are the only place `flushState` is called; a keystroke never flushes.

### 3.8 `initEconomySync`

An `effect` that drops a draft whose country no longer exists, installed from `App.tsx` beside
`initCountrySync()` and returning its disposer:

```ts
stop = effect(() => {
  const live = countryById.value;
  const drafts = draftsSignal.peek();
  // build the pruned map; assign only if something was actually removed
});
```

`deleteCountry` already removes the `economics` slot but knows nothing about this map. Ids are never
reused inside a session (`nextCountryId` only increases) and the map is empty after a reload, so a
stale draft is currently unreachable — but "unreachable" here rests on a counter in another file,
and ten lines removes the dependency. `peek()` on the drafts inside the effect, so the effect does
not re-trigger on its own write.

### 3.9 Judge mode

`judgeSignal` is **not persisted**, for the same reason `openPanelId` and `showLabels` are not: it
is view state, not world state, and `civitas.state.v1` gains no key from T12. It resets to off on
every reload, which is the safe default — a player reloading the page cannot inherit a judge's
unlocked sheet.

---

## 4. `src/ui/economics-format.ts`

Pure. No React, no signals, no DOM. Every number the panel prints goes through this file, so a
readout and a history row can never disagree about how a percentage looks.

```ts
function formatObor(value: number): string;          // "107,795,555" · sign kept · no decimals
function formatPoints(value: number): string;        // "15,483.20"   · 2 decimals
function formatPct(value: number): string;           // "1.69%"       · 2 decimals
function formatPp(value: number): string;            // "-0.90 pp"
function formatSigned(text: string, value: number): string;  // prefixes "+" when value > 0
function formatFactor(value: number): string;        // "x1.06"
function formatUnits(value: number): string;         // "50 units"
function formatInteger(value: number): string;       // "70"
function formatShare(fraction: number): string;      // "20.00%" from 0.2
function formatForInput(value: number, decimals: number): string;   // "12.5", never grouped
function formatDeltaValue(value: number, unit: string): string;     // dispatch on the unit tag
const DASH = "—";                               // what a null or a non-finite prints as
```

Decisions:

- **`.` decimal, `,` thousands.** The spec writes European commas; the codebase does not
  (`country-overview.ts` prints `18,687 px`). Matching the codebase wins — two conventions in one
  app is worse than either.
- **Reuse `groupDigits` from `country-overview.ts`** for the integer part. It clamps to
  non-negative, so `formatObor` splits the sign off first and prepends it. Do not copy the function.
- **No `toLocaleString`.** A test asserting `"18,687"` against `toLocaleString` asserts whatever ICU
  the test runner shipped with. `country-overview.ts` already made this call.
- **A non-finite value prints `DASH`**, never `NaN`. `deriveEconomy` guards everything with
  `finiteOr`, so this is defence in depth, but the panel also renders values straight off a loaded
  document.
- `formatDeltaValue` dispatches on the engine's own unit strings — `obor`, `fr`, `mic`, `pp`,
  `pct`, `units`, `rating`, `turns`, `count`, `factor` — the exact set in `UNIT_DECIMALS` in
  `src/economy/history.ts`. Unknown units fall back to `formatPoints`.

---

## 5. `src/ui/economics-fields.ts`

Pure. This file is where "editability is driven by the tag" actually lives.

```ts
type FieldTag = "P" | "V" | "A";

type FieldAccess = {
  editable: boolean;   // render an enabled input
  locked: boolean;     // a [V] field while judge mode is off
  auto: boolean;       // an [A] field — never rendered as an input at all
};

function fieldAccess(tag: FieldTag, judge: boolean): FieldAccess;
```

The whole table, and it is the panel's defining behaviour:

| tag | judge off | judge on |
| --- | --- | --- |
| `P` | `{ editable: true, locked: false, auto: false }` | same |
| `V` | `{ editable: false, locked: true, auto: false }` | `{ editable: true, locked: false, auto: false }` |
| `A` | `{ editable: false, locked: false, auto: true }` | **same — judge mode does not unlock `[A]`** |

`[A]` never becomes editable, in either mode. That is enforced twice: here, and structurally by
`EconomyReadout.tsx` containing no `<input>`.

```ts
const TAG_LEGEND: readonly { tag: FieldTag; title: string; help: string }[];
// P: "player"  — "you set it directly"
// V: "verdict" — "only a judge, an event or a dice roll changes it"
// A: "auto"    — "the engine computes it; it is never editable"

type NumberSpec = {
  min: number;
  max: number;
  decimals: number;
  integer: boolean;
};

type ParseResult =
  | { ok: true; value: number }
  | { ok: false; reason: string };

function parseNumberInput(text: string, spec: NumberSpec): ParseResult;
```

`parseNumberInput` algorithm, in order:

1. `trim()`. An empty string is `{ ok: false, reason: "enter a number" }` — **not** 0. Silently
   turning a cleared field into 0 is how a player wipes their GDP without noticing.
2. Reject anything `Number.parseFloat` leaves a tail on: test against
   `/^[+-]?(\d+(\.\d*)?|\.\d+)$/` first, so `"1e9"`, `"12px"` and `"1,000"` all fail cleanly.
3. `Number.isFinite` check. `NaN` and `Infinity` are rejected, because `sanitizeRecord` **drops**
   such a key and the field would vanish from the saved document on the next reload.
4. `spec.integer && !Number.isInteger(value)` → rejected, naming the field as whole-numbers-only.
5. `!(value >= spec.min && value <= spec.max)` — **written negated**, so a `NaN` that slipped
   through would still fail — → rejected, quoting the range.
6. Otherwise `{ ok: true, value }`.

**Nothing here clamps.** §12 is explicit: a step violation is a validation error, not a clamp,
"a clamp would silently change what the player typed and then resolve a turn they did not intend".
The same reasoning applies to every range in the sheet, so rejection is uniform.

```ts
type StepWindow = { min: number; max: number; limitPp: number };

function stepWindow(last: number, limitPp: number, min: number, max: number): StepWindow;
function stepWindowText(window: StepWindow, current: number): string;
```

`stepWindow` returns `{ min: max(min, last - limitPp), max: min(max, last + limitPp), limitPp }`.
This is the UI half of the hard cap the brief demands: the `NumberField` for `emissionPct` gets
`spec.min`/`spec.max` from `stepWindow(state.emissionPctLast, derived.emissionStepLimitPp, 0,
EMISSION_PCT_MAX)`, and for `militaryPct` from `derived.militaryStepLimitPp` (which already carries
mobilization's +10 pp). An over-large value therefore fails `parseNumberInput` at step 5 and is
never written, so V3 and V4 can never be produced by typing.

`stepWindowText` produces the always-visible sentence under both fields, e.g.
`"step this turn: 10.00 pp — you may set 0.00% to 14.00% (now 4.00%)"`. The brief asks for exactly
this: "Show the current step and what the limit allows."

Ledger array edits, pure and testable:

```ts
const LEDGER_LINE_MAX = 24;        // spec 8.5 / 8.6
const LEDGER_LABEL_MAX = 60;

function appendLedgerLine(lines: readonly LedgerLine[]): LedgerLine[];   // no-op at the cap
function removeLedgerLine(lines: readonly LedgerLine[], index: number): LedgerLine[];
function patchLedgerLine(
  lines: readonly LedgerLine[],
  index: number,
  patch: Partial<LedgerLine>,
): LedgerLine[];
function canAddOtherSector(sectors: readonly Sector[]): boolean;
function freeOtherSectorKey(sectors: readonly Sector[]): SectorKey | null;
```

---

## 6. `src/ui/economics-history.ts`

Pure. Turns `EconomyState.history` into something a player reads rather than a raw dump. This is the
"readable record" half of the DONE condition.

```ts
type HistoryDelta = {
  label: string;      // humanized
  text: string;       // formatted through economics-format
  unit: string;
  sign: -1 | 0 | 1;
};

type HistoryStep = {
  key: string;              // the engine's step name, e.g. "debt-service"
  title: string;            // "Debt service"
  deltas: HistoryDelta[];   // zero-valued rows dropped
  notes: string[];
  quiet: boolean;           // nothing survived the filter and there are no notes
};

type HistoryTurn = {
  turn: number;
  headline: HistoryDelta[];
  steps: HistoryStep[];
  warnings: { code: string | null; text: string }[];
};

const STEP_TITLES: Readonly<Record<string, string>>;
function humanizeLabel(label: string): string;
function splitWarning(warning: string): { code: string | null; text: string };
function buildHistoryTurn(record: TurnRecord): HistoryTurn;
function buildHistoryView(records: readonly TurnRecord[]): HistoryTurn[];   // NEWEST FIRST
```

- `STEP_TITLES` covers all fifteen `STEP_NAMES`: `derive-and-validate` → "Checks",
  `resources` → "Resources", `generation` → "Income", `actions` → "Actions",
  `borrowing` → "Borrowing", `savings` → "Savings", `debt-service` → "Debt service",
  `upkeep` → "Stockpile upkeep", `spending` → "Spending", `auto-invest` → "Auto-investment",
  `growth` → "Growth", `gdp` → "GDP", `rating` → "Credit rating", `flags` → "Flags and cooldowns",
  `commit` → "Committed". An unknown key falls back to `humanizeLabel(key)`, so a future engine step
  degrades to a readable row instead of disappearing.
- `humanizeLabel` maps the known engine delta labels explicitly first — `frGenerated` → "FR
  generated", `micGenerated` → "MIC generated", `frCore` → "FR before emission",
  `controlFrMultiplier` → "Control multiplier", `gdpTotalObor` → "GDP", and so on — and otherwise
  splits camelCase on the case boundary, lower-cases the tail and upper-cases the first letter.
  `"coal shortage"` already reads correctly and passes through the fallback unchanged.
- **Zero-valued deltas are dropped**, because a fifteen-step dump where twelve rows read `0.00` is
  the raw dump the brief forbids. A step that loses every row is marked `quiet: true` and the view
  renders it as one line, `"no change"`, so the step order is still visible and a reader can see
  that the step ran.
- `headline` is built from the record's own closing numbers: GDP → next GDP, overall growth, FR
  generated, FR remainder, MIC generated, MIC remainder, rating → next, control → next. Those are
  precisely the `TurnRecord` scalar fields, so nothing is recomputed.
- `splitWarning` splits the engine's `"V17: …"` prefix (T11-B memory: warning strings carry their
  V-code as a prefix) into a chip and a sentence. No prefix → `{ code: null, text }`.
- `buildHistoryView` reverses the array. The engine stores newest **last**; a player reads newest
  **first**.

---

## 7. Components

### 7.1 `EconomyReadout.tsx` — the `[A]` cell

```tsx
type ReadoutProps = {
  label: string;
  value: string;
  tone?: "normal" | "good" | "bad" | "muted";
  hint?: string;
};
function Readout(props: ReadoutProps): JSX.Element;
```

Renders a `<div class={styles.readout}>` with a `<span class={styles.readoutLabel}>` carrying an
`[A]` chip and a `<span class={styles.readoutValue}>`. **This file contains no `<input>`, no
`<select>` and no `contentEditable`.** That is the structural half of "`[A]` fields must never be
editable" — there is no code path through which one becomes an input.

`tone` drives a `data-tone` attribute only; the colour lives in the CSS module and comes from
`--civ-gild` / `--civ-danger` / `--civ-ink-faint`.

### 7.2 `EconomyField.tsx` — the tag-aware inputs

```tsx
type FieldShellProps = {
  tag: FieldTag;         // "P" or "V" only; "A" belongs in Readout
  label: string;
  hint?: string;
  error?: string | null;
};

type NumberFieldProps = FieldShellProps & {
  value: number;
  spec: NumberSpec;
  suffix?: string;                    // "%", "pp", "FR", "obor"
  onCommit: (next: number) => void;
};

type SelectFieldProps<T extends string> = FieldShellProps & {
  value: T;
  options: readonly { value: T; label: string }[];
  onCommit: (next: T) => void;
};

type ToggleFieldProps = FieldShellProps & {
  value: boolean;
  onCommit: (next: boolean) => void;
};

function NumberField(props: NumberFieldProps): JSX.Element;
function SelectField<T extends string>(props: SelectFieldProps<T>): JSX.Element;
function ToggleField(props: ToggleFieldProps): JSX.Element;
```

All three call `useSignals()` and read `judgeMode.value`, then `fieldAccess(props.tag, judge)`.

`NumberField` bridges the string world of `useFieldCommit` to the numeric world of the engine:

```
const text = formatForInput(props.value, props.spec.decimals);
const field = useFieldCommit(text, (next) => {
  const parsed = parseNumberInput(next, props.spec);
  if (!parsed.ok) {
    return;                       // REJECTED. Nothing is written.
  }
  props.onCommit(parsed.value);
});
const live = parseNumberInput(field.value, props.spec);
const message = live.ok ? (props.error ?? null) : live.reason;
```

Because `useFieldCommit` clears its draft after the commit window, a rejected value **snaps back**
to the last committed number. That is the "cannot type an over-large step" behaviour the brief asks
for, and it is the spec-faithful one: the panel refuses the edit instead of silently clamping it.
While the draft is illegal the input carries `aria-invalid="true"` and `data-invalid="true"` and the
message renders under it. The `<input type="number">` also carries `min`, `max` and a `step`
derived from `spec.decimals`, so the browser's own spinner and validation agree with ours.

`props.error` is the *externally* supplied message — `derived.errors` filtered by field name — and
it shows when the draft itself is fine. That is what surfaces the case in §9.6: a judge lowers the
control position, the committed emission is now outside the new step window, and nothing was typed.

When `access.locked` is true the input is rendered `disabled`, carries a lock glyph in its caption
and `title="verdict field — turn on judge mode to change it"`, and the whole field gets
`data-locked="true"`. A disabled input cannot be focused, typed into, pasted into or dropped on, so
"a player must not be able to edit a `[V]` field by accident" holds without a click handler.

**Every call site passes a `key` containing the country id**, per T09/T10's rule. Switching country
remounts the field and drops the buffered draft, so a draft for country 3 can never be committed
into country 4.

### 7.3 The eight section components

Each is `function EconomyX({ slot, derived }: SectionProps)` where

```ts
type SectionProps = {
  slot: EconomySlot;
  derived: DerivedEconomy;
};
```

The panel reads the two signals once and passes plain objects down, so only `EconomicsPanel`,
`EconomyField` and `EconomyTurn` call `useSignals()`. Sections that need the store call the exported
action functions directly (they are plain functions, not signals).

Every section renders `<section class={styles.section}>` with a small-caps rule heading, a one-line
subtitle naming the spec area, and a `<div class={styles.grid}>` of fields and readouts.

**`EconomySectors.tsx` — areas 1 and 2.**
Header readouts: `gdpTotalObor` `[A]`, `gdpNextTotalObor` `[A]`, `gdpChangeObor` `[A]` signed,
`overallGrowthPct` `[A]`, `plannedGrowthPct` `[A]`.
Then a table, one row per present sector, columns:
sector name (`[P]` text for `other1`/`other2` via `EditableText`, static otherwise) ·
`gdpObor` `[V]` · share `[A]` · `growthPermanentPct` `[V]` · `growthTemporaryPct` `[V]` ·
`shortagePenalty` `[A]` · `preShortagePct` `[A]` · **`finalPct` `[A]`** · `gdpNextObor` `[A]`.
The sector row's `[A]` cells come from `derived.sectors` matched by `key`.
Under the table: the Other-sector control, judge-only — a name field, a `grounds` textarea
(`EditableTextArea`, required, `<= 400`), and "add sector", disabled when
`!canAddOtherSector(slot.state.sectors)`. Removing an Other sector is `[V]` and asks for a second
press before it fires (an Other sector carries GDP; deleting it silently loses it).
A footer line names the shortage rule so a 0.00% row is explicable: "a shortage caps a sector's
growth at 0 and can never on its own drive it negative".

**`EconomyStanding.tsx` — areas 3, 4 and 9.**
Rating: `ratingScore` `[V]` integer 0..100 · `ratingTier` `[A]` · `ratingFactor` `[A]` ·
`ratingNext` `[A]` · `ratingCleanTurn` `[A]` shown as "clean turn: yes / no" with the three clauses
of §6.2a listed and individually ticked (`emissionPct === 0`, `debtShortfallTotal === 0`,
`overallGrowthPct > 0`) · `ratingDeltas[]` `[A]` as a signed list with each reason.
The seven-tier scale renders as a band strip with the occupied tier marked, from `RATING_TIERS`.
Control: `controlPosition` `[V]` integer 0..100 with a range input **and** a number input (the range
is for feel, the number for precision; both commit through the same handler) · `controlBandIndex`
and `controlBandName` `[A]` · `controlGrowthPp` `[A]` · `controlFrMultiplier` `[A]` ·
`emissionStepLimitPp` and `militaryStepLimitPp` `[A]` · `controlNext` `[A]`.
The eleven bands render as a strip from `CONTROL_BANDS`, the occupied one marked, each showing its
growth / FR / step triple. That is area 9's "show the current step" at its source.

**`EconomyBudget.tsx` — areas 5, 7, 8 and the step cap.**
`emissionPct` `[P]` with the step window as its spec and `stepWindowText` under it ·
`militaryPct` `[P]` likewise · then the derived consequences as readouts: `inflationPct`,
`inflationGrowthPp`, `emissionRatingPenalty`, `frEmission`, `defenceGrowthPp`, `frDefenceDrag`.
FR block: `frTaxBase`, `frGrowthFactor`, `frLightBonus`, `frRegimeMultiplier`, `frCore`,
**`frGenerated`**, `frOtherIncome`, `frAvailable`, `frSpent`, **`frRemainder`** (tone `bad` when
negative), plus the three running balances `frBalanceAfterSavings/Debt/Upkeep` behind a
`<details>` labelled "running balance, step by step" — §8.4a is the one ordering a reader has to
hold in mind, and hiding it by default keeps the section readable.
MIC block: `micHeavyBonus`, `micRegimeMultiplier`, `micGenerated`, `micOtherIncome`, `micAvailable`,
`micSpent`, `micRemainder`.
Four ledgers, each a list of `[P]` rows (label text + points number, both `[P]`), an "add line"
button disabled at `LEDGER_LINE_MAX`, a per-row remove, and a total from `sumLines`. One local
unexported `Ledger` sub-component parameterised by `LedgerListKey`, rendered four times.
A "clear all lines" button calling `clearLedgerLines`, with a second-press confirm.

**`EconomySavings.tsx` — area 6.**
Reserve: `reserveFr` `[A]` in · `reserveCap` `[A]` · `reserveAdd` `[P]` · `reserveWithdraw` `[P]` ·
`reserveAddApplied` / `reserveWithdrawApplied` `[A]` shown beside the raw inputs whenever they
differ, which is the visible form of V14's clip · `reserveEnd` `[A]` · `reservePenaltyPp` `[A]`.
Stockpile: `micStock` `[A]` in · `micStockAdd` `[P]` · `micStockWithdraw` `[P]` ·
`micStockWithdrawApplied` `[A]` · `micUpkeepDue` `[A]` · `micUpkeepPaid` `[A]` ·
`micStockLost` `[A]` with tone `bad` when non-zero · `micStockEnd` `[A]`.
A standing line: "the cap is two annual incomes; an addition over the cap is refused, not clipped
to zero" and "unpaid upkeep loses only the points the budget could not cover".

**`EconomyResources.tsx` — area 10.**
One table, eight rows in `RESOURCE_KEYS` order, grouped by `RESOURCE_CATEGORY` with a fuel / raw /
luxury sub-heading. Columns: label · `deposits` `[V]` · `extractionBonusPct` `[V]` ·
`blockadePct` `[V]` · `importsRequested` `[P]` · `exports` `[P]` · `stockUnits` `[A]` in ·
`needUnits` `[A]` · `extractionUnits` `[A]` · `importUnits` `[A]` · `exportsAppliedUnits` `[A]` ·
`supplyUnits` `[A]` · **`shortage` `[A]`** as a percentage with tone `bad` above 0 ·
`freeUnits` `[A]` · `stockNextUnits` `[A]`.
The table scrolls horizontally inside its own container; the panel body never does.
Under it, the dependency matrix from `SECTOR_DEPENDENCIES`, read-only, so a player can see which
sectors a shortage is about to hit.

**`EconomyDebt.tsx` — area 11.**
Capacity: `ratingTier` `[A]` → `debtLimit` `[A]` · `debtOutstanding` `[A]` ·
`newLoanAvailable` `[A]` · `newLoanRatePct` `[A]` · `newLoanTermTurns` `[A]` · `debtStatus` `[A]` ·
`debtStatusNext` `[A]`.
Borrowing: `borrowRequest` `[P]`, spec `0..derived.newLoanAvailable`, so V7 cannot be produced by
typing. When the tier is F or the status is `default` the field is disabled with the reason spelled
out rather than silently accepting a number the turn will reject.
`debtAutoService` `[P]` toggle. The loan table: id · principal `[A]` · rate `[A]` · term `[A]` ·
turns remaining `[A]` · `allocatedFr` — `[P]` **only while `debtAutoService` is false**, an `[A]`
readout otherwise — and, from `derived.loanService` matched by `loanId`, required · allocated ·
interest · principal paid · shortfall `[A]` with tone `bad`.
`debtRequiredTotal`, `debtShortfallTotal`, `debtRatingPenalty` as readouts.
A note on a loan whose `createdTurn === state.turn`: "taken this turn — its first payment falls next
turn" (§14.2).

**`EconomyFlags.tsx` — area 12.**
Mobilization: `mobilized` `[V]` · `mobilizationJustified` `[V]` · the four consequences as readouts
(`MOB_STEP_BONUS_PP` on the military step, `frRegimeMultiplier`, `micRegimeMultiplier`,
`mobilizationGrowthPp`), and the −5 rating line when mobilized and unjustified.
Region: `region` `[V]` select from `REGIONS`.
Action: `pendingAction.kind` `[P]` select (none / nationalization / privatization),
`.enterprise` `[P]` select (civilian / military), `.roll` `[V]` integer 1..10.
`nationalizationAvailable` and `privatizationAvailable` `[A]` with the reason when false —
cooldown from `turnsSinceNationalization` / `turnsSincePrivatization`, or the band lockout at
`controlBandIndex` 0 / 10. A `[P]` kind whose action is unavailable is refused at the select, so V8
cannot be produced by clicking.
Concession: `pendingConcession.sectorKey` `[V]` select; disabled with an explanation when
`region` is not in `CONCESSION_REGIONS`. `concessionGrowthPp` and `concessionCostObor` `[A]`, and
the granted `concessions[]` list with `active` as a `[V]` toggle.
Cooldowns, `timedModifiers[]` and both privatization drag counters as `[A]` rows.

**`EconomyTurn.tsx` — End Turn and history.**
Pre-flight: when `derived.errors.length > 0`, a list of every error as `code · field · message`,
always visible. When `derived.warnings.length > 0`, the same in a quieter tone.
The button. **Two-stage, because an End Turn cannot be undone**: the first press arms it and the
label becomes `"confirm turn N"`; a second press within 5 s resolves; the arm is dropped by the
timeout, by a re-render with a different country id, and on unmount. The button is disabled when
`statePersistent.value === false`, with the reason — resolving a turn that can never be saved is
the worst outcome in this panel.
After a resolution, `lastTurnOutcome` renders as a banner: on failure the error list with
`role="alert"` and "nothing changed"; on success "turn N resolved" plus, when `saved === false`,
an error-toned line saying the economy advanced in memory but did not reach storage.
History: `buildHistoryView(slot.state.history)`, newest first. Each turn is a `<details>` — the
newest `open` by default, the rest closed — with the headline row in the `<summary>` and the
fifteen steps inside, each step a title, its surviving deltas as label/value pairs, and its notes.
Warnings render as chips with the V-code from `splitWarning`. Empty history renders
"no turns resolved yet — the sheet above is turn N".
A footer notes the 12-turn cap from `TURN_HISTORY_MAX`.

### 7.4 `EconomicsPanel.tsx`

```tsx
function EconomicsPanel(): JSX.Element;
```

```
useSignals()
country  = selectedCountry.value
slot     = selectedEconomy.value
derived  = selectedDerived.value
warning  = stateWarning.value
judge    = judgeMode.value

country === null  -> <Panel panelId="economics" title="Economics"> empty state </Panel>
slot === null || derived === null -> the same empty state (cannot happen when country is non-null,
                                     but the types say it can and an unchecked `!` is not allowed)

otherwise:
  <Panel panelId="economics" subtitle={country.name + " - turn " + slot.state.turn} title="Economics">
    save notice        (saveNoticeFor(warning, false))
    repair notice      (slot.repairs, first 5, "and N more")
    legend row         (TAG_LEGEND, three chips with their help text)
    judge toggle       (a labelled checkbox: "Judge mode - unlocks [V] fields")
    <EconomySectors />  <EconomyStanding />  <EconomyBudget />  <EconomySavings />
    <EconomyResources /> <EconomyDebt />     <EconomyFlags />   <EconomyTurn />
  </Panel>
```

The panel root carries `data-judge={judge ? "true" : "false"}`, so the CSS can put one visible
treatment on every unlocked `[V]` field from a single rule rather than from a prop threaded through
eleven components.

---

## 8. `src/ui/economics.module.css`

Tokens only — no hardcoded colour, gap, radius or font size, per T08's rule. Register: the same
parchment sheet as the other panels, denser.

- `.section` — a bottom rule (`--civ-border-hair`), `--civ-space-5` of vertical rhythm.
- `.sectionTitle` — `--civ-font-display`, `--civ-text-md`, small caps, `--civ-tracking-caps`.
- `.grid` — `display: grid`, `grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))`,
  `gap: var(--civ-space-3)`. Dense without becoming a wall.
- `.tableWrap` — `overflow-x: auto`. Every table lives inside one; the panel body scrolls only
  vertically.
- `.tag` — the `[P]` / `[V]` / `[A]` chip. `data-tag="P"` gild, `"V"` gild-soft with a lock glyph,
  `"A"` ink-faint.
- `.field[data-locked="true"]` — dimmed, cursor default.
- `:global([data-panel="economics"][data-judge="true"]) .field[data-tag="V"]` — a gild outline, so
  an unlocked verdict field is unmistakable. (A `:global` prefix is needed because the attribute
  sits on `Panel`'s own element.)
- `.value[data-tone="bad"]` — `--civ-danger`; `"good"` — `--civ-gild`; `"muted"` — `--civ-ink-faint`.
- `.numbers` — `--civ-font-mono`, `font-variant-numeric: tabular-nums`, so a column of figures
  lines up.
- `.endTurn` / `.endTurn[data-armed="true"]` — the second state is visibly different (gild fill).
- `.historyTurn`, `.historyStep`, `.historyDelta`, `.chip`.

---

## 9. Edge cases and failure modes

1. **No country selected.** Empty state, same wording register as the other two panels.
2. **A country with no saved economy.** The standard opening sheet renders from
   `createInitialEconomy()` and **nothing is written** until the first edit or End Turn. Deliberate:
   a 60-country document must not gain 60 economies nobody touched.
3. **A fresh country reads a total shortage.** `createInitialEconomy` starts with 0 deposits, so
   every resource-dependent sector shows 0.00% growth. T11-B's memory calls this correct, not a bug.
   The resources section says so in one line, so nobody files it as one.
4. **`economyFromJson` repaired the document.** `slot.repairs` renders as a dismissible notice.
   It is naturally present only until the first edit, at which point the draft supersedes it.
5. **A number typed out of range.** `parseNumberInput` rejects, nothing is written, the field snaps
   back on commit and shows the reason while the draft is live.
6. **A judge lowers `controlPosition` and the committed `emissionPct` is now over the new step.**
   Nothing was typed, so no field-local message fires. `derived.errors` carries V3; the emission
   field receives it through `props.error` and `EconomyTurn` lists it; End Turn refuses. This is the
   case the step-window `spec` alone cannot catch, and it is why both mechanisms exist.
7. **`frRemainder` or `micRemainder` negative (V5/V6).** The budget section shows the remainder with
   tone `bad`, the pre-flight list names it, End Turn refuses. `resolveTurn` returns
   `{ ok: false }` and writes nothing — the engine guarantees this and the store relies on it.
8. **Ledger at 24 lines.** "add line" disabled, with the cap named.
9. **An Other sector without grounds.** The store refuses to create it, so V10 is unreachable
   through the panel. A loaded document that already violates V10 still surfaces the error.
10. **`borrowRequest` above `newLoanAvailable`, or tier F, or status `default`.** The field's spec
    max is `newLoanAvailable`, and the field is disabled with the reason in the last two cases, so
    V7 is unreachable through the panel.
11. **`allocatedFr` while auto-service is on.** Rendered as an `[A]` readout, not an input. §14.5
    makes it `[P]` "only when auto-service is off".
12. **Quota failure on a keystroke.** T05's debounced write raises `quota`; `saveNoticeFor` renders
    it at the top of the panel body, never inside a field. Non-fatal — the in-memory state stands
    and the next write retries.
13. **Quota failure on End Turn.** `flushState()` resolves it immediately, and the outcome banner
    says the turn advanced in memory but did not reach storage. This is the one place in the panel
    where an unsaved write is real data loss, so it gets error tone, not warn.
14. **A future-version document (`statePersistent === false`).** `Panel` already shows `read-only`.
    End Turn is disabled with the reason; edits still render but never save.
15. **Switching country mid-edit.** Every field carries `key={"<name>-" + countryId}`, so the buffered
    draft is dropped on remount and can never land on another country's sheet.
16. **A double-pressed End Turn.** `resolveTurn` is synchronous, so a fast double click would advance
    two turns with no way back. The two-stage arm makes that impossible.
17. **`deleteCountry` while its economy is drafted.** `initEconomySync`'s effect prunes the draft.
18. **A `NaN` reaching the store.** `parseNumberInput` rejects it, so the only route is a loaded
    document — and `economyFromJson` repairs those. Defence in depth: `sanitizeRecord` inside
    `setCountryEconomics` would drop the key, and every formatter prints `DASH` for a non-finite
    value rather than `NaN`.
19. **History longer than 12 turns.** The engine trims; the view says so in its footer.
20. **`provinceCount === 0`.** Guard G6: a concession costs nothing. The flags section shows the
    computed `concessionCostObor` as it is, and names the divisor, so a free concession is legible
    rather than mysterious.

---

## 10. Verification

Run from `javascript/packages/prototypes/civitas/civitas-interactive-map`.

```bash
yarn typecheck
yarn test
yarn tsx --test src/ui/economics-format.test.ts src/ui/economics-fields.test.ts \
  src/ui/economics-history.test.ts src/state/economy-store.test.ts
yarn tsx --test src/economy/*.test.ts
yarn build
```

- `yarn typecheck` exits 0 with no output. `noUnusedLocals` and `noUnusedParameters` are on.
- `yarn test` must report **796 existing tests still passing** plus the new ones, `fail 0`. Any
  regression is a stop.
- `yarn tsx --test src/economy/*.test.ts` must still report **203 passing**, which is the proof that
  T12 changed no engine behaviour.
- `yarn build` compiles with exactly the pre-existing asset-size warning on `map.png`,
  `provinces_map.png` and `provinces_manifest.json`.

Manual check with `yarn dev`, because no `.tsx` in this repo is unit-testable (there is no jsdom):

1. create a country, paint a few provinces into it, open Economics;
2. change `emissionPct` from 0 to 4 — `frGenerated`, `inflationPct`, every `finalPct` and
   `gdpNextTotalObor` move on the same commit. That is the `[A]`-updates-live condition;
3. with judge mode **off**, confirm `ratingScore`, `controlPosition`, `deposits`, `mobilized` and
   every sector volume are disabled and cannot be focused; turn judge mode **on** and confirm they
   become editable and visibly marked;
4. type `emissionPct` 30 at control position 50 (step 10.00 pp, last 0) — the field marks itself
   invalid, names the window, and snaps back on blur. Nothing is written;
5. press End Turn twice to confirm, and read the history: turn 1's steps show the income, the
   growth, the upkeep, the interest, the shortages, the flags and the cooldowns;
6. reload the page. The turn number, every input, the history and the sector volumes are unchanged.
   That is the survives-a-reload condition;
7. with DevTools, set `civitas.state.v1` to something huge, edit a field, and confirm the quota
   notice appears at the top of the panel and the panel keeps working.

---

## 11. What is NOT part of T12

- **Any change to `src/economy/`.** No formula, no constant, no new field. If the panel appears to
  need one, the design is wrong. The engine reproduces §19 and the standard start exactly and 203
  tests pin it.
- **A persistence migration.** `ECONOMY_SCHEMA_VERSION` is 1, there is no earlier economy document,
  and `src/state/migrations.ts` is untouched.
- **Real judge authentication.** Judge mode is an honesty toggle in one browser. There is no
  backend, no roles and no audit — PLAN section 6 puts multiplayer and any server out of scope.
- **The verdict workflow.** PLAN section 6: "turn resolution, orders, and the judge's verdict
  workflow beyond the flags in T12". T12 renders the flags and lets a judge set them. It does not
  model orders, an inbox, or a verdict document.
- **Dice rolling.** §16.3: the roll is an input, never generated by the engine. The panel takes the
  number a judge types after a roll in chat. No `Math.random` anywhere.
- **Undo, or editing a resolved turn.** History is a record, not a save state.
- **Charts, sparklines or any visualisation of the history.** Numbers and text.
- **Export, import or printing the sheet.** PLAN section 3 decision 1: no export/import UI.
- **A second economy view anywhere else** — no economy readouts on the plaque, the map or the
  country panel.
- **`.tsx` unit tests.** There is no jsdom in the monorepo. The four pure modules carry the tests;
  the components are verified by the manual pass in §10.
