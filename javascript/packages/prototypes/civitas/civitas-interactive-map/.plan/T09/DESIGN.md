# T09 — Country overview panel

Fills in the body T08 stubbed in `src/ui/CountryOverviewPanel.tsx`: flag, name,
slogan, lore, plus two read-only territory facts. Everything persists through the
T05 store; nothing new is added to `civitas.state.v1`.

**Read `javascript/CLAUDE.md` before writing a line.** Double quotes, `;` on every
statement, braced bodies on their own line, ONE grouped named export at the end of
each file, `export { type Foo };` and never `export type { Foo };` —
`src/scaffold.test.ts:155` fails the file otherwise. CSS: one declaration per line.

The panel already round-trips its four fields (T08 wired them to prove the store
contract). T09 is therefore mostly **completion and polish**, not new plumbing.
Do not rebuild what is there: `EditableText`, `EditableTextArea`, `ImageUpload`,
`useFieldCommit`, `Panel`, `updateCountry`, `downscaleImage`, `countryAggregates`
all stay exactly as they are apart from the small, additive changes listed below.

---

## 1. Files

### Create

| Path | Responsibility |
|---|---|
| `src/ui/country-overview.ts` | The pure, DOM-free logic of this panel: `saveNoticeFor`, `formatArea`, `formatProvinceCount`, `formatBytes`, `loreCounterText`. No React, no signals. |
| `src/ui/country-overview.test.ts` | Tests for the above. |
| `src/ui/country-overview.module.css` | Everything the panel styles itself. Tokens only. |

### Change

| Path | Change |
|---|---|
| `src/state/schema.ts` | Add pure `countryDisplayName(id, name)`. `createCountry` calls it so the fallback string exists once. |
| `src/state/schema.test.ts` | Cases for `countryDisplayName`. |
| `src/state/image.ts` | `FLAG_MAX_EDGE` 256 -> 384 (§3.1). Nothing else. |
| `src/ui/ImageUpload.tsx` | Four optional props: `chooseLabel`, `replaceLabel`, `hint`, `previewClassName`. Defaults keep today's behaviour byte for byte. |
| `src/ui/fields.module.css` | `.status[data-kind="warn"]`, and `.hint`. |
| `src/ui/CountryOverviewPanel.tsx` | Rewritten body. This is the task. |
| `src/ui/CountryPlaque.tsx` | Name goes through `countryDisplayName`; the flag box always carries the country colour behind the image. |
| `src/ui/country-plaque.module.css` | `.flagImage` `object-fit: cover` -> `contain` (§7). |
| `src/ui/CountryPanel.tsx` | The row's name input gains `placeholder={countryDisplayName(country.id, "")}`. One line. |
| `src/state/label-store.ts` | Label text goes through `countryDisplayName`, so clearing a name does not delete the label. |
| `src/state/world-store.test.ts` | One test: a quota failure during a FLAG write keeps the flag in memory, and removing it saves and clears the warning. |

Not touched, and a reviewer should be able to confirm it with `git diff --stat`:
`src/map/*`, `src/ui/render.ts`, `src/ui/border-layer.ts`, `src/ui/label-layer.ts`,
`src/ui/MapCanvas.tsx`, `src/state/persistence.ts`, `src/state/migrations.ts`,
`src/state/borders-store.ts`, `src/state/assign-store.ts`, `src/state/selection-store.ts`,
`src/ui/use-field-commit.ts`, `src/ui/EditableText.tsx`, `src/ui/EditableTextArea.tsx`.

---

## 2. The display-name fallback

### 2.1 Why it is needed

`updateCountry` accepts an empty name: `clampText("", 120)` is `""`, which differs
from the current name, so `next.name = ""` and the write happens
(`world-store.ts:414-420`). Today that produces three separate wrongs:

- the plaque renders an empty `<p class="name">` — a blank gold plaque;
- `countryLabelSources` skips the country entirely (`label-store.ts:117-120`), so
  the map label **disappears** and does not come back until a name is retyped;
- on the next reload `normalizeState` refuses the empty name and `createCountry`
  puts `"Country N"` back (`schema.ts:323`), so the app silently changes the name
  behind the user's back.

One shared fallback fixes all three and makes the in-memory display agree with
what a reload would produce.

### 2.2 The function — `src/state/schema.ts`

It belongs in `schema.ts` because `createCountry` already owns the `"Country " + id`
convention and the string must exist exactly once.

```ts
// The name every surface shows. A country whose name is empty or blank still has
// to read as something: the plaque, the map label and the panel all fall back to
// the same string `createCountry` and `normalizeState` would produce.
//
// It does NOT clamp and it does NOT trim the returned name. Clamping is
// `updateCountry`'s job and trimming a name while the user is typing " New" would
// fight the field.
function countryDisplayName(id: number, name: string): string {
  if (typeof name !== "string" || name.trim() === "") {
    return "Country " + id;
  }
  return name;
}
```

`createCountry` becomes:

```ts
function createCountry(id: number, name?: string): Country {
  const requested = name === undefined ? "" : clampText(name, NAME_MAX);
  return {
    id,
    name: countryDisplayName(id, requested),
    slogan: "",
    lore: "",
    flagDataUrl: null,
    provinceIds: [],
    colorHex: defaultCountryColor(id),
  };
}
```

Behaviour is identical for every existing input (`undefined`, `""`, a real name).
The one change is that `createCountry(3, "   ")` now stores `"Country 3"` instead of
three spaces. Add `countryDisplayName` to the grouped export.

`normalizeState` is **not** changed. It already falls back for an empty stored name,
and rewriting a stored blank name into the document on load would be a silent edit
of user data for no gain.

### 2.3 Call sites, exhaustively

| Site | Use |
|---|---|
| `CountryOverviewPanel` | The `placeholder` on the Name field, so an emptied field shows the fallback greyed. |
| `CountryPlaque.tsx:87` | `{countryDisplayName(country.id, country.name)}` in `.name` and in its `title`. |
| `label-store.ts:117` | `countryDisplayName(country.id, country.name).trim().toUpperCase()`. Keep the `text === ""` guard below it — it is now unreachable, and a guard that cannot fire is cheaper than a label layout that divides by a zero-width string. |
| `CountryPanel.tsx:78-85` | `placeholder` only. The input's `value` stays `country.name`: a raw controlled input must let the user clear it. |

`EconomicsPanel`'s subtitle also reads `country.name`; leave it, that panel is
T12's and will be rewritten.

---

## 3. The flag

### 3.1 `FLAG_MAX_EDGE`: 256 -> 384

`fitDownscale` scales the LONG edge and keeps the ratio (`image.ts:33-45`), so a
wide flag is never squashed — the brief's "flags are wide, respect the aspect
ratio" is already satisfied by T05's maths. What T09 must choose is the number.

The largest place a flag is ever drawn:

| Surface | CSS size | Device px at DPR 2 |
|---|---|---|
| Panel preview (§3.3) | 288 x 192 | 576 x 384 |
| Plaque (`country-plaque.module.css`) | 64 x 43 | 128 x 86 |

At 256 the panel preview upscales a 3:2 flag by 1.13x in CSS px and shows it at
44% of the device resolution. 384 covers the CSS size outright and two thirds of
the device pixels, which is where the returns stop being visible.

The cost, from T05's measured data point (`assets/country-flag.jpg`, 735 x 490,
98 KB -> 256 x 171 WebP, 13 KB): 384 x 256 is 2.25x the pixels, so about 26 KB of
WebP -> roughly 35 000 base64 chars -> **70 KB of localStorage** (UTF-16, so
`utf16Bytes` counts each char twice). Against the 4 000 000-byte budget in
`persistence.ts` that is about 57 flags before the budget warning fires, and a
realistic game has tens of countries. `IMAGE_TARGET_BYTES` (262 144) still caps
the pathological case, and `IMAGE_DATA_URL_MAX` (600 000 chars) still rejects
anything larger at the store.

Change the constant only. `image.test.ts:10` passes `FLAG_MAX_EDGE` a 100 x 80
input and asserts no scaling, which holds at any value >= 100.

`PROVINCE_IMAGE_MAX_EDGE` is untouched — that is T10's.

### 3.2 `ImageUpload` additions

Additive and defaulted, so the component's current behaviour is unchanged for a
caller that passes nothing new. **Do not restructure the file**: the request
counter, the `mountedRef` guard, the `MAX_UPLOAD_BYTES` pre-check and the
`onError`/`broken` handling are all load-bearing and already correct.

```ts
type ImageUploadProps = {
  label: string;
  value: string | null;
  maxEdge: number;
  onCommit: (dataUrl: string | null) => void;
  disabled?: boolean;
  // "choose file…" by default. Shown when there is no image.
  chooseLabel?: string;
  // "replace…" by default. Shown when there IS one, so the primary control reads
  // as what it does rather than repeating "choose file…" next to a picture.
  replaceLabel?: string;
  // A static line under the actions: what the field accepts and what it does to
  // the file. It is not an error and never disappears.
  hint?: string;
  // REPLACES `styles.preview`, it does not add to it. Two single-class selectors
  // from two different CSS modules have equal specificity, so which one wins
  // depends on the order rspack happens to emit the modules in. Replacing is
  // deterministic; appending is a coin flip that looks fine until a rebuild.
  previewClassName?: string;
};
```

Rendering changes, and nothing else in the file:

```tsx
const hasImage = props.value !== null && props.value !== "";

<div className={props.previewClassName ?? styles.preview}>…</div>

<button …>
  {busy ? "working…" : hasImage ? (props.replaceLabel ?? "replace…") : (props.chooseLabel ?? "choose file…")}
</button>

{props.hint === undefined ? null : <p className={styles.hint}>{props.hint}</p>}
```

The remove button already renders only when there is a value — that is the
brief's "remove control" and it stays where it is, after the replace control.

The `hint` paragraph goes **after** the actions and **before** the error
paragraph, so a fresh error is the last thing in the block and closest to the
button that produced it.

### 3.3 The preview box

`country-overview.module.css`:

```css
/* Replaces `.preview` from fields.module.css — see the note on previewClassName.
   3:2 is the commonest flag ratio; `object-fit: contain` on the image inside
   letterboxes anything else rather than cropping a canton off the edge. */
.flagPreview {
  align-items: center;
  aspect-ratio: 3 / 2;
  background: var(--civ-parchment-dim);
  border: var(--civ-border-strong);
  border-radius: var(--civ-radius-sm);
  display: flex;
  justify-content: center;
  max-width: 288px;
  overflow: hidden;
  width: 100%;
}
```

The dock is 380 px wide with 16 px of body padding, so 288 px never overflows and
never upscales a 384-px flag.

### 3.4 The commit path, exactly

```
file picker
  -> ImageUpload.onPick
       -> file.size > MAX_UPLOAD_BYTES ?  visible error, nothing committed
       -> downscaleImage(file, FLAG_MAX_EDGE)      // the ONLY encoder
            throws on a non-image        ->  visible error, previous flag KEPT
  -> props.onCommit(dataUrl)
       -> updateCountry(id, { flagDataUrl: dataUrl })   // validates, clamps, markDirty
       -> read the store back to detect a silent rejection (§8.3)
       -> flushState()                                   // resolve quota NOW
  -> next render reads stateWarning and renders the notice
```

`flushState()` (already exported from `world-store.ts`) is called **only** on a
flag commit or removal, never on a keystroke. The reason: `writeNow` is where a
quota failure is discovered, and without a flush that discovery arrives 400 ms
after the upload, which reads as "it worked, then a banner appeared". A flag write
is a single deliberate act and one synchronous `setItem` at that moment is free.
Removing a flag flushes for the same reason in reverse: removal is the recovery
action, so the warning must clear immediately.

---

## 4. `src/ui/country-overview.ts` — the pure module

No React, no signals, no DOM. This is the only part of T09 a unit test can reach,
so every non-trivial decision in the panel lives here.

```ts
import type { StateWarning } from "../state/persistence";

// The panel's pure logic: the save-failure message table and the number
// formatting. Kept out of the .tsx because there is no jsdom in this repo and a
// component cannot be tested — a table that maps a warning to a sentence can.

const LORE_COUNTER_AT = 0.9;

type SaveNoticeKind = "error" | "warn";

type SaveNotice = {
  kind: SaveNoticeKind;
  text: string;
};

// `toLocaleString()` is locale dependent and would make a test assert whatever
// ICU the runner was built with. Grouping by hand is four lines and deterministic.
function groupDigits(value: number): string { … }

function formatArea(pixelCount: number): string;       // 18687 -> "18,687 px"
function formatProvinceCount(count: number): string;   // 1 -> "1 province"
function formatBytes(bytes: number): string;           // 13312 -> "13 KB"
function loreCounterText(length: number, max: number): string | null;
function saveNoticeFor(warning: StateWarning | null, afterFlagWrite: boolean): SaveNotice | null;

export {
  LORE_COUNTER_AT,
  formatArea,
  formatBytes,
  formatProvinceCount,
  groupDigits,
  loreCounterText,
  saveNoticeFor,
  type SaveNotice,
  type SaveNoticeKind,
};
```

### 4.1 `groupDigits`

```ts
function groupDigits(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const digits = String(Math.max(0, Math.trunc(value)));
  let out = "";
  for (let at = 0; at < digits.length; at += 1) {
    out += digits[at];
    const left = digits.length - at - 1;
    if (left > 0 && left % 3 === 0) {
      out += ",";
    }
  }
  return out;
}
```

`18687` -> `"18,687"`, `2756578` -> `"2,756,578"`, `999` -> `"999"`, `0` -> `"0"`.
Comma, not a thin space, because `CountryPanel`'s existing row already reads
`18,687 px` and the two must not disagree.

### 4.2 `formatArea` / `formatProvinceCount` / `formatBytes`

```ts
function formatArea(pixelCount: number): string {
  return groupDigits(pixelCount) + " px";
}

function formatProvinceCount(count: number): string {
  const whole = Math.max(0, Math.trunc(count));
  return groupDigits(whole) + (whole === 1 ? " province" : " provinces");
}

// KB only. A flag is never megabytes — `IMAGE_TARGET_BYTES` is 256 KB — and a
// second unit is a second thing to get wrong.
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }
  return groupDigits(Math.max(1, Math.round(bytes / 1024))) + " KB";
}
```

### 4.3 `loreCounterText`

Silent until the lore is within 10% of `LORE_MAX`, because a counter that is
always on is noise in a field meant for prose.

```ts
function loreCounterText(length: number, max: number): string | null {
  if (max <= 0 || length < Math.floor(max * LORE_COUNTER_AT)) {
    return null;
  }
  const left = Math.max(0, max - length);
  if (left === 0) {
    return "the lore is full at " + groupDigits(max) + " characters";
  }
  return groupDigits(left) + " characters left";
}
```

### 4.4 `saveNoticeFor` — the whole table

| `warning.kind` | `afterFlagWrite` | Result |
|---|---|---|
| (warning is `null`) | either | `null` |
| `quota` | `true` | `error` — "storage is full, so the flag was not saved. it is still shown here; remove it or a province image, and the next change will save." |
| `quota` | `false` | `error` — "storage is full, so the last change was not saved. remove a flag or a province image." |
| `budget` | either | `warn` — `warning.message` (it already carries the KB figure and the advice) |
| `unavailable` | either | `error` — "saving is off: " + `warning.message` |
| `future` | either | `error` — "this document was written by a newer build, so nothing typed here is being saved." |
| `corrupt` | either | `null` |
| `unmigratable` | either | `null` |
| `repaired` | either | `null` |

The last three are load-time events about the document as a whole. `App.tsx`
already renders them in the top banner with a dismiss control, and repeating them
inside a panel would say the same thing twice about something the panel cannot
fix.

Written as an exhaustive `switch` on `warning.kind` with no `default` other than
`return null;`, so adding a `WarningKind` in a later task surfaces here.

---

## 5. `CountryOverviewPanel.tsx`

### 5.1 Structure

```
Panel  title="Country"  subtitle={"country " + id}
  [notice]            — only when saveNoticeFor returns one
  ImageUpload         — label "Flag", previewClassName=flagPreview, hint
  EditableText        — "Name", placeholder = countryDisplayName(id, "")
  EditableText        — "Slogan", placeholder "ever onward"
  EditableTextArea    — "Lore", rows 12
    [lore counter]    — only inside the last 10%
  <dl> Territory      — provinces, area, flag size (flag row only when set)
```

The three empty/edge states:

- `selectedCountry === null` -> the existing empty paragraph, reworded to name
  both ways in (right-click a province, or click a row in the country list).
- no flag -> `ImageUpload`'s own `no image` placeholder, unchanged.
- name cleared -> the placeholder shows the fallback; the plaque and the label
  show it for real.

### 5.2 The per-country local state

The panel does **not** remount when the selection moves, so a flag message for
country 3 must not survive into country 4. Keep the flag's local state tagged
with the id it belongs to and derive, rather than adding an effect:

```tsx
type FlagState = { countryId: number; touched: boolean; rejected: boolean };

const [flagState, setFlagState] = useState<FlagState | null>(null);
…
const flag = flagState !== null && flagState.countryId === country.id ? flagState : null;
```

`ImageUpload` itself still gets `key={"flag-" + country.id}` so its own `busy`,
`error` and `broken` state is dropped on a selection change, exactly as T08's
comment requires of every field call site. The four field components keep their
`key`s for the same reason.

### 5.3 The flag handler

```tsx
function onFlag(dataUrl: string | null): void {
  updateCountry(country.id, { flagDataUrl: dataUrl });
  // `updateCountry` REJECTS SILENTLY: a data URL over IMAGE_DATA_URL_MAX fails
  // `isImageDataUrl` and the patch is dropped with no return value and no
  // warning. Reading the store back is the only way to know. `.peek()`, not
  // `.value` — this is an event handler and must not subscribe.
  const stored = countryById.peek().get(country.id)?.flagDataUrl ?? null;
  const rejected = dataUrl !== null && stored !== dataUrl;
  // Resolves the quota outcome synchronously instead of 400 ms later. Only on a
  // flag write; keystrokes stay on the debounce.
  flushState();
  setFlagState({ countryId: country.id, touched: dataUrl !== null, rejected });
}
```

### 5.4 The rest of the body

```tsx
const aggregate = countryAggregates.value.get(country.id);
const provinceCount = aggregate ? aggregate.provinceCount : country.provinceIds.length;
const pixelCount = aggregate ? aggregate.pixelCount : 0;
const flagBytes = country.flagDataUrl === null ? 0 : dataUrlBytes(country.flagDataUrl);

const notice =
  flag !== null && flag.rejected
    ? { kind: "error", text: "that image is still too large to store after downscaling; try a smaller file" }
    : saveNoticeFor(stateWarning.value, flag !== null && flag.touched);
```

`countryAggregates` is the T06 cache and is already a `computed` keyed on the
countries array identity — read it, never re-derive it, and never call
`aggregateCountry` from a component. The `? :` fallbacks cover the window before
the manifest resolves, when `resolvedCount` is 0 and `pixelCount` is 0.

The counter under the lore:

```tsx
const counter = loreCounterText(country.lore.length, LORE_MAX);
```

It reads the COMMITTED value, not the draft, so it updates on the 200 ms window
like everything else. That is fine: it exists to warn near a 8000-character cap,
not to count keystrokes.

### 5.5 The facts list

`<dl>` / `<div>` / `<dt>` / `<dd>`, the same shape `EconomicsPanel` uses:

| Term | Value |
|---|---|
| `provinces` | `formatProvinceCount(provinceCount)` |
| `area` | `formatArea(pixelCount)` |
| `flag` | `formatBytes(flagBytes)` — the row renders only when a flag is set |

Read-only. The brief asks for province count and pixel area; the flag size is one
extra `dataUrlBytes` call (already exported by `src/state/image.ts`) and it is the
number the user needs when the quota notice tells them to remove something.

### 5.6 Reactivity

`useSignals()` at the top — the panel reads `selectedCountry`, `countryAggregates`
and `stateWarning`. `Panel` calls it for its own `statePersistent` read.
`ImageUpload`, `EditableText` and `EditableTextArea` read no signal and must NOT
gain the call.

---

## 6. CSS — `src/ui/country-overview.module.css`

Tokens only, one declaration per line, no hardcoded colour, size, radius or font.

Classes: `.empty`, `.notice`, `.flagPreview`, `.counter`, `.facts`, `.factsTitle`,
`.fact`, `.factTerm`, `.factValue`.

The panel imports **only** this module. It deliberately does not import
`panel-bodies.module.css`: that file is the shared sheet for the three T08
placeholders, and T10 and T12 will rewrite their own halves of it. Twenty lines of
readout styling repeated once is a smaller cost than three panels sharing a sheet
that each of them then needs to override. Delete nothing from
`panel-bodies.module.css` — `ProvincesOverviewPanel` and `EconomicsPanel` still
use it.

```css
.notice {
  border: 1px solid var(--civ-danger);
  border-radius: var(--civ-radius-sm);
  color: var(--civ-danger);
  font-family: var(--civ-font-mono);
  font-size: var(--civ-text-xs);
  line-height: var(--civ-leading-body);
  margin: 0;
  padding: var(--civ-space-3);
}

.notice[data-kind="warn"] {
  border-color: var(--civ-gild);
  color: var(--civ-gild);
}

.facts {
  border-top: var(--civ-border-hair);
  display: flex;
  flex-direction: column;
  gap: var(--civ-space-2);
  margin: 0;
  padding-top: var(--civ-space-4);
}
```

`fields.module.css` gains two rules and nothing else:

```css
.hint {
  color: var(--civ-ink-faint);
  font-family: var(--civ-font-mono);
  font-size: var(--civ-text-xs);
  line-height: var(--civ-leading-body);
  margin: 0;
}

.status[data-kind="warn"] {
  color: var(--civ-gild);
}
```

The lore textarea gets `rows={12}`. `.area` already has `min-height: 6em` and
`resize: vertical`; leave both.

---

## 7. The plaque

Two small changes, both a direct consequence of T09 owning the flag.

1. `country-plaque.module.css`: `.flagImage` moves from `object-fit: cover` to
   `object-fit: contain`. `cover` crops a 2:1 flag into a 3:2 box, and what it
   crops is the left and right ends — where a flag's charge usually is.
2. `CountryPlaque.tsx`: set `style={{ background: country.colorHex }}` on
   `.flag` **unconditionally**, not only when there is no flag. The country colour
   then letterboxes a contained flag and the empty state is the same element with
   nothing in it, instead of two visually different states.

The name goes through `countryDisplayName` (§2.3). Nothing else in the plaque
changes; its `brokenFlag` handling is already correct.

---

## 8. Edge cases and failure modes

| # | Case | Behaviour |
|---|---|---|
| 8.1 | A non-image file (a PDF renamed `.png`) | `createImageBitmap` throws, `downscaleImage` rethrows `"the file is not a readable image"`, `ImageUpload` shows it in `.status[data-kind="error"]` and **keeps the previous flag**. No commit, no store write. |
| 8.2 | A 200 MB TIFF | Rejected on `file.size > MAX_UPLOAD_BYTES` before any decode. Message names the size in MB. |
| 8.3 | `updateCountry` silently drops the flag | Only reachable if the encoded URL passes `IMAGE_TARGET_BYTES` but exceeds `IMAGE_DATA_URL_MAX` (600 000 chars). §5.3 reads the store back and shows "still too large to store after downscaling". Without that read the UI would show a flag that was never stored. |
| 8.4 | The write hits quota | `writeState` returns `{ ok: false, reason: "quota" }`, `writeNow` raises the `quota` warning, `persistent` stays `true`, **the in-memory flag survives**. The panel shows the flag-specific message and the top banner shows the store's. Removing the flag flushes, the write succeeds, `writeNow` clears the warning. |
| 8.5 | The document crosses `STORAGE_BUDGET_BYTES` but still writes | `budget` warning -> the panel's `warn` notice. Not an error: the data is saved. |
| 8.6 | A future-version document | `writable: false`, `markDirty` drops every write. `Panel` already shows the `read-only` chip; the panel adds the plain sentence. Fields stay editable — the in-memory edit is real for this session. |
| 8.7 | Selection changes mid-upload | `ImageUpload`'s `requestRef` counter plus the `key` remount discard the older result. The `flagState` tag in §5.2 discards a stale message. A flag can never land on the wrong country. |
| 8.8 | The panel is closed mid-upload | `mountedRef` short-circuits the resolve; no `setState` on an unmounted component. Already handled by T08. |
| 8.9 | Two picks in flight | The counter keeps the newer one; the older resolves into nothing. Already handled by T08. |
| 8.10 | The name is cleared | The store keeps `""`; every surface shows `"Country N"` via §2. On reload `normalizeState` writes the same string back, so nothing appears to change. |
| 8.11 | The name is 120 characters | `maxLength` stops the paste at the input; `clampText` truncates at the store; `useFieldCommit` clears the draft after the commit, so an over-long paste visibly snaps. Unchanged from T08. |
| 8.12 | Lore at 8000 characters | Counter reads "the lore is full at 8,000 characters". `maxLength` blocks further input. |
| 8.13 | A stored flag data URL is corrupt | `<img onError>` sets `broken`, the preview falls back to `no image`, and the remove control is still reachable. Already handled by T08. |
| 8.14 | No country selected | The empty paragraph. No hook order changes: `useSignals` and `useState` both run before the early return. |
| 8.15 | The manifest has not loaded | `countryAggregates` yields 0 pixels; the facts read `0 px`. They fill in when `loadPhase` becomes `ready`, because the aggregate computed reads `maxProvinceId`. |
| 8.16 | The country is deleted while its panel is open | `selectedCountry` is a computed validated against `countryById`, so it becomes `null` and the panel falls to its empty state. |
| 8.17 | localStorage unavailable (Safari, cookies blocked) | `initWorldStore` sets the `unavailable` warning and `persistent` false at boot. The panel says saving is off; every field still edits in memory. |

---

## 9. Integration points, by name

Called by T09, all of them already existing:

- `selectedCountry` (`state/selection-store.ts`) — the country the panel renders.
- `updateCountry(id, patch)` (`state/world-store.ts`) — the only writer.
- `countryById` (`state/world-store.ts`) — `.peek()` for the §5.3 read-back.
- `flushState()` (`state/world-store.ts`) — flag commit and removal only.
- `stateWarning` (`state/world-store.ts`) — the notice source.
- `countryAggregates` (`state/country-store.ts`) — province count and pixel area.
- `downscaleImage(file, maxEdge)` (`state/image.ts`) — inside `ImageUpload`, the
  only encoder. The panel never touches `FileReader`, `toDataURL` or
  `URL.createObjectURL`.
- `dataUrlBytes(url)` (`state/image.ts`) — the flag-size fact.
- `FLAG_MAX_EDGE` (`state/image.ts`), `LORE_MAX` / `NAME_MAX` / `SLOGAN_MAX` and
  `countryDisplayName` (`state/schema.ts`).
- `Panel`, `EditableText`, `EditableTextArea`, `ImageUpload`, `useFieldCommit`.

Not called, deliberately: `setCountryEconomics`, `assignProvinces`, `addCountry`,
`deleteCountry`, `aggregateCountry`, anything in `src/map/`.

Live-update chain for a name change, end to end — the DONE-WHEN clause:

```
keystroke -> useFieldCommit draft (instant, local)
          -> 200 ms fixed window -> updateCountry -> countriesSignal replaced
             -> countryById / selectedCountry  -> CountryPlaque re-renders
             -> countryAggregates (identity-cached; provinceIds array is NOT
                copied, so the label anchor cache is not invalidated)
             -> countryLabelSources -> MapCanvas rAF -> the map label repaints
             -> markDirty -> 400 ms window -> localStorage
```

Do not shorten either window to make it "more live". 200 ms is already
imperceptible and T08 measured the propagation in the browser.

---

## 10. Tests

`src/ui/country-overview.test.ts` (new, ~16 cases)

- `groupDigits`: 0, 7, 999, 1000, 18687, 2756578, a negative, a `NaN`.
- `formatArea`, `formatProvinceCount` (0 / 1 / 2 pluralisation), `formatBytes`
  (0, 1 byte -> "1 KB" floor, 13312 -> "13 KB").
- `loreCounterText`: null below the threshold, a count at the threshold, the full
  message at the cap, null for a zero max.
- `saveNoticeFor`: every row of the §4.4 table, including both `quota` variants
  and all three `null` kinds. Assert the `kind`, and assert that the flag variant
  mentions the flag — not the exact sentence, which would pin prose.

`src/state/schema.test.ts` (+4)

- `countryDisplayName` with a real name, `""`, `"   "`, and a non-string cast
  through `as unknown as string`.
- `createCountry(3, "   ")` stores `"Country 3"`.

`src/state/world-store.test.ts` (+1)

- A flag write under a storage that throws `QuotaExceededError`: after
  `flushState()` the warning is `quota`, `countryById.value.get(1).flagDataUrl`
  still holds the data URL, `statePersistent` is still `true`, and nothing was
  written. Then `updateCountry(1, { flagDataUrl: null })` with the storage healed
  writes and clears the warning. Reuse the file's existing `fakeStorage`,
  `fakeTimers`, `quotaError` and `storedDoc` helpers — do not write new ones.

No `.tsx` is unit tested. There is no jsdom in this repo, and every earlier task
took the same position; the logic worth testing was moved into
`country-overview.ts` and `schema.ts` for exactly that reason.

Expected total: **493 + ~21 = ~514 passing, 0 failing.** Do not weaken, reword or
delete an existing assertion. If one turns red, the change is wrong.

---

## 11. Verification

Shell commands, run from
`javascript/packages/prototypes/civitas/civitas-interactive-map`:

```bash
yarn typecheck          # expect exit 0, no output
yarn test               # expect ~514 pass, 0 fail
npx tsx --test src/ui/country-overview.test.ts src/state/schema.test.ts src/state/world-store.test.ts
yarn build              # expect exit 0 and ONLY the three known asset-size warnings
git -C ../civitas-map status --porcelain   # must print nothing
yarn dev                # then the checklist below
```

Browser checklist (Chrome, tab kept in the foreground — a hidden tab renders no
frames):

1. Create a country, paint a few provinces, open `COUNTRY`.
2. Upload `assets/country-flag.jpg`. The preview fills the 3:2 box, the button
   reads `replace…`, `remove` appears, and the plaque's flag shows the whole flag
   letterboxed against the country colour — not cropped.
3. `JSON.parse(localStorage["civitas.state.v1"]).countries[0].flagDataUrl` starts
   `data:image/webp` (or `data:image/jpeg`) and its length is well under 600 000.
   The `flag` fact in the panel agrees with `length * 3 / 4` in KB.
4. Reload. Flag, name, slogan and lore all come back, and the plaque shows the flag.
5. Type in Name. The plaque, the map label and the left country list all follow
   within a beat; the panel field itself never lags a keystroke.
6. Clear Name completely. The field shows `Country 1` greyed, the plaque reads
   `COUNTRY 1`, and **the map label is still there**. Reload: unchanged.
7. Pick a `.pdf` (or any non-image) through the file dialog. A red line appears
   under the buttons; the existing flag is still shown and still in `localStorage`.
8. Force a quota failure: in the console, fill the origin with
   `localStorage.setItem("civ.ballast." + i, "x".repeat(500000))` until roughly
   4.5 MB is used, then upload a flag. The panel notice appears **immediately**
   (not 400 ms later), the flag is still on screen, and the top banner also
   reports it. Press `remove` — the notice clears and the write succeeds. Delete
   the ballast keys afterwards.
9. Paste 8000 characters into Lore. The counter appears in the last 800 and reads
   `the lore is full at 8,000 characters` at the cap.
10. Switch the selection to another country mid-message: no message, no flag and
    no draft crosses over.
11. `read_console_messages` with `onlyErrors`: nothing from the app.

---

## 12. Explicitly NOT part of T09

- **Province name, lore and image.** T10. Do not wire a province field, and do not
  touch `PROVINCE_IMAGE_MAX_EDGE`, `setProvinceImage`, `setProvinceName` or
  `setProvinceLore`.
- **The provinces list and its virtualisation.** T10.
- **Anything economic.** The `economics` slot is not read or written here.
- **Country colour.** It stays in the left `CountryPanel`'s swatch, with its 80 ms
  debounce. Adding a second colour control would mean two debounced writers for
  one field.
- **Country creation, deletion and province assignment.** T06 owns them and they
  stay in the left panel.
- **Export / import, and any new `localStorage` key.** Locked by PLAN §3.1. T09
  adds no schema field, no migration and no key. `serializeState`'s output shape
  is unchanged — `flagDataUrl` already exists.
- **Flag cropping, rotation or a colour picker.** One file in, one downscale, one
  data URL.
- **The two shell layout defects T08's review left open** — the plaque/dock
  overlap between roughly 900 and 1200 px, and `.hud`'s `max-width` below roughly
  760 px. Both live in `shell.module.css` and `map-canvas.module.css`, both affect
  all three panels equally, and neither is reachable from this panel's own
  markup. Fixing shell chrome inside a panel task hides the change from the
  reviewer of that chrome. They stay open; §12 of `memory.md` records them.
- **The resize-ratchet defect from `VISUAL-CHECK-PHASE2.md` §3.1.** A view-store
  policy decision, unrelated to this panel.
- **jsdom, a component test harness, or a React testing library.** Not in the
  repo, and adding one is a task of its own.
- **Changing the 200 ms field window or the 400 ms write window.** Both are load
  bearing and both are already tested.
- **`README.md`.** The docs agent owns it.
