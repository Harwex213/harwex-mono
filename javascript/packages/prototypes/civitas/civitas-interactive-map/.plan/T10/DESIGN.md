# T10 — Provinces overview panel — DESIGN

The list of every province in the selected country. Each row carries an editable
image, an editable name and editable multiline lore. The list is virtualised, a
search box filters it, and selection stays in sync with the map both ways.

T10 adds **no `localStorage` key, no schema field and no migration**. Every write
goes through the three province setters T05 already shipped, and those setters are
already sparse. T10 builds no second store, no second field component, no second
panel system and no second rendering path.

Sections 3, 4 and 5 are written to be implemented literally.

---

## 1. Files

### Created

| Path | Responsibility |
|---|---|
| `src/ui/province-list.ts` | The panel's pure half. Virtual-window geometry, scroll-to-index, the search predicate, row assembly, the override summary, the image budget, the quota notice. No React, no signals, no DOM. |
| `src/ui/province-list.test.ts` | Node tests over that module, plus the source assertions for the wiring jsdom cannot reach. |
| `src/ui/province-list.module.css` | The panel's own styles. Tokens only. |
| `src/ui/ProvinceList.tsx` | The search box, the scroll viewport, the virtual window, and the two-way selection sync. Owns the only signal subscription in the list. |
| `src/ui/ProvinceRow.tsx` | One row: header select strip, `ImageUpload`, `EditableText`, `EditableTextArea`. Reads no signal. |

### Changed

| Path | What changes |
|---|---|
| `src/ui/ProvincesOverviewPanel.tsx` | Rewritten body. Empty states, the save notice, `<ProvinceList>`, the footer. `ROW_CAP` and the `panel-bodies.module.css` import are deleted. |
| `src/ui/EditableTextArea.tsx` | One optional prop, `areaClassName`. Nothing else. |

### Explicitly NOT touched

Everything under `src/map/`. `render.ts`, `border-layer.ts`, `highlight-layer.ts`,
`tint-layer.ts`, `label-layer.ts`, `MapCanvas.tsx`, `Shell.tsx`, `Panel.tsx`,
`PanelHost.tsx`, `CountryPanel.tsx`, `CountryPlaque.tsx`,
`CountryOverviewPanel.tsx`, `EconomicsPanel.tsx`, `ImageUpload.tsx`,
`EditableText.tsx`, `use-field-commit.ts`, `country-overview.ts`,
`panel-bodies.module.css`, `fields.module.css`, `theme.css`, `shell.module.css`,
and every file under `src/state/`.

`panel-bodies.module.css` stays on disk. `EconomicsPanel` still imports it, and
T12 owns that sheet's remaining rows.

---

## 2. Why the shape is this shape

**The rows are uniform and fixed-height.** The brief blesses a fixed row height.
A uniform height makes index-to-offset arithmetic O(1) in both directions, which
removes the offset table, the measurement pass and the resize observer per row
that a variable-height virtualiser needs. The constant lives in TypeScript and is
applied as an inline `height`, so the CSS cannot silently disagree with the maths.

**Every row carries all three fields, as the brief states.** Virtualisation is
what makes that affordable: at most 13 rows exist in the DOM at once regardless of
whether the country holds 12 provinces or 900.

**The list holds the only signal subscription.** `ProvinceRow` takes plain props
and calls actions. Thirteen rows each subscribing to `provinceOverrides` would
re-render all thirteen on every keystroke anyway, because the parent re-renders
too — the subscription would buy nothing and would hide where the reactivity is.

**Sparseness is inherited, not re-implemented.** `writeOverrideField` in
`world-store.ts` already returns without writing when the value is unchanged, and
already deletes the whole override once its last field is emptied. T10's only duty
is to **never call a setter except from a commit handler**. Rendering a row must
write nothing. `useFieldCommit`'s unmount flush is safe here: `flush()` returns
early when `latest.current === null`, and `latest` is only assigned inside
`onChange`, so a row that scrolls past untouched commits nothing.

---

## 3. `src/ui/province-list.ts` — the pure module

No React, no signals, no DOM. This is the same split T07 used for
`label-layout.ts`, T08 for `nextSelection` and T09 for `country-overview.ts`. The
repo has no jsdom, so a `.tsx` cannot be tested; everything in this panel worth an
assertion lives here.

### 3.1 Constants

```ts
// The row is 196 CSS px and the constant is the SINGLE SOURCE OF TRUTH: the row
// element takes `style={{ height: PROVINCE_ROW_HEIGHT }}` and the CSS module sets
// no height at all. The internal budget, which is what fixes the number:
//   2 px border + 8 px padding top + 8 px padding bottom      = 18
//   header select strip                                       = 24
//   gap                                                       =  8
//   body, the taller of the two columns                       = 144
//     left  (ImageUpload): caption 14 + 4 + preview 72 + 8 + actions 26 = 124
//     right (two fields):  caption 14 + 4 + input 30 + 12
//                          + caption 14 + 4 + textarea 66              = 144
const PROVINCE_ROW_HEIGHT = 196;

// Four rows above and four below. Generous on purpose: a row unmounting under a
// fast scroll aborts an in-flight `downscaleImage` in that row (§8.7).
const OVERSCAN_ROWS = 4;

// The lore box inside a row. The full 8000-character cap still applies; the box
// scrolls internally and does not resize, because a resizable box would break the
// fixed row height.
const PROVINCE_LORE_ROWS = 3;

// One 320-edge WebP costs roughly this many BYTES OF localStorage. See §9.
const PROVINCE_IMAGE_STORE_BYTES = 48000;
```

### 3.2 Types

```ts
type ProvinceRow = {
  id: number;
  // The layered display name: override -> manifest -> "Province N".
  name: string;
  // The RAW override value, "" when the province has none. The name input is
  // controlled on this, not on `name`, so an empty field can be typed into.
  rawName: string;
  lore: string;
  imageDataUrl: string | null;
  // True when the province has any stored override at all. Drives the row's
  // "edited" dot, which is the browser-visible instrument for sparseness.
  edited: boolean;
  // False for an id the manifest does not carry (ids 1318 and 1458 are absent,
  // and a stored document may name others). Such a row is still listed and still
  // editable; hiding it would make its override unreachable.
  known: boolean;
};

type ProvinceLookups = {
  displayNameOf: (id: number) => string;
  overrideOf: (id: number) => ProvinceOverride | null;
  isKnown: (id: number) => boolean;
};

type ListGeometry = {
  first: number;        // inclusive
  last: number;         // EXCLUSIVE
  offsetY: number;      // first * rowHeight, the window's translate
  totalHeight: number;  // rowCount * rowHeight, the spacer's height
};

type OverrideSummary = {
  edited: number;
  withImage: number;
};
```

`ProvinceOverride` is imported as a type from `../state/schema`.

### 3.3 Virtual-window geometry

```ts
// The index the window starts at for a scroll position, overscan applied and
// clamped. Called from the scroll handler; its integer result is the component's
// only scroll state, so scrolling WITHIN one row costs zero React renders.
function windowStart(
  scrollTop: number,
  rowHeight: number,
  overscan: number,
  rowCount: number,
): number;
```

Algorithm: guard `rowCount <= 0` and a non-finite `scrollTop` to `0`; then
`raw = Math.floor(scrollTop / rowHeight)`;
return `clamp(raw - overscan, 0, rowCount - 1)`.

```ts
// The window that starts at `first`. Re-clamps `first`, so a stale state value
// left over from a longer list can never render past the end.
function windowGeometry(
  first: number,
  viewportHeight: number,
  rowHeight: number,
  overscan: number,
  rowCount: number,
): ListGeometry;
```

Algorithm:

1. `totalHeight = rowCount * rowHeight`. `rowCount <= 0` returns
   `{ first: 0, last: 0, offsetY: 0, totalHeight: 0 }`.
2. `visible = Math.ceil(viewportHeight / rowHeight) + 1`, floored at 1. The `+ 1`
   covers a partially scrolled first row.
3. `maxFirst = Math.max(0, rowCount - visible - overscan)`. This is exactly the
   `first` a legitimate scroll to the bottom produces, so clamping to it never
   fights a real scroll position — and it is what removes the blank frame between
   a filter shrinking the list and the browser's own `scrollTop` clamp firing a
   `scroll` event.
4. `start = clamp(first, 0, maxFirst)`.
5. `last = Math.min(rowCount, start + visible + 2 * overscan)`.
6. `offsetY = start * rowHeight`.

**The rendered row count is `visible + 2 * overscan` and is independent of
`rowCount`.** That is the property the virtualisation test pins.

```ts
// The scrollTop that brings `index` fully into view, or null when it already is.
// null means "do not touch the scroll position" — which is also what makes a
// click on a visible row not jump the list under the user's cursor.
function scrollTopForIndex(
  index: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  rowCount: number,
): number | null;
```

Algorithm:

1. `index < 0 || index >= rowCount` or a non-finite input -> `null`.
2. `top = index * rowHeight`, `bottom = top + rowHeight`.
3. Already fully visible (`top >= scrollTop && bottom <= scrollTop + viewportHeight`)
   -> `null`.
4. `maxScroll = Math.max(0, rowCount * rowHeight - viewportHeight)`.
5. **A jump of more than one viewport centres the row**:
   `Math.abs(top - scrollTop) > viewportHeight` ->
   `clamp(top - (viewportHeight - rowHeight) / 2, 0, maxScroll)`. Centring is what
   makes a click on a distant province read as "the list revealed the row" rather
   than "the row is glued to an edge".
6. Otherwise a near miss: above -> `clamp(top, 0, maxScroll)`; below ->
   `clamp(bottom - viewportHeight, 0, maxScroll)`.

### 3.4 Search

```ts
// Trims, lowercases, and collapses every run of inner whitespace to one space.
function normalizeQuery(text: string): string;

// An empty query matches everything. Otherwise the NORMALIZED display name must
// contain the query, or the decimal id must START WITH it.
function matchesQuery(row: ProvinceRow, query: string): boolean;

// Returns the SAME array reference when the query is empty. That identity feeds
// the `useMemo` chain in `ProvinceList` and keeps an unfiltered list free.
function filterRows(rows: readonly ProvinceRow[], query: string): readonly ProvinceRow[];

// -1 when `id` is null or absent.
function indexOfProvince(rows: readonly ProvinceRow[], id: number | null): number;
```

The id match is a **prefix**, not a substring: typing `41` should surface province
41 and 412, not every province whose id happens to contain the digits. The lore is
deliberately **not** searched — it is up to 8000 characters per province and a
name-plus-id match is predictable, which a full-text match over prose is not.

`filterRows` is called on every keystroke with no debounce. It is one lowercase
`includes` over at most a few hundred short strings, which is far below a frame.

### 3.5 Row assembly and the summary

```ts
function buildProvinceRows(
  ids: readonly number[],
  lookups: ProvinceLookups,
): ProvinceRow[];
```

Per id: `override = lookups.overrideOf(id)`;
`name = lookups.displayNameOf(id)`;
`rawName = override?.name ?? ""`;
`lore = override?.lore ?? ""`;
`imageDataUrl = override?.imageDataUrl ?? null`;
`edited = override !== null`;
`known = lookups.isKnown(id)`.

The layering lives in `provinceDisplayName` in `world-store.ts` and is **injected,
never re-implemented**.

```ts
function overrideSummary(rows: readonly ProvinceRow[]): OverrideSummary;
```

Counts `edited` and `withImage`. It is the number the footer prints, and it is the
in-app instrument for "only touched provinces are persisted": open a 300-province
country, scroll the whole list, and the footer must still read `0 edited`.

### 3.6 The image budget

```ts
// Floors at 0. Never negative, so a document already over budget reads "0 more".
function imagesRemaining(
  usedBytes: number,
  budgetBytes: number,
  bytesPerImage: number,
): number;

// e.g. "3 images · room for about 76 more", or "no images yet · room for about
// 82" when `withImage` is 0.
function budgetText(withImage: number, remaining: number): string;
```

`ProvincesOverviewPanel` calls
`imagesRemaining(stateBytes.value, STORAGE_BUDGET_BYTES, PROVINCE_IMAGE_STORE_BYTES)`.
`STORAGE_BUDGET_BYTES` is imported from `../state/persistence`.

### 3.7 The quota notice

```ts
function imageSaveNoticeFor(
  warning: StateWarning | null,
  afterImageWrite: boolean,
): SaveNotice | null;
```

It **delegates to T09's `saveNoticeFor`** for every warning kind and overrides one
branch only: `warning.kind === "quota" && afterImageWrite` returns a sentence
naming a province image instead of a flag. Everything else is
`saveNoticeFor(warning, false)`.

Delegating rather than copying keeps the warning-to-sentence table in one place,
so a new `WarningKind` still has exactly one place to be handled. `SaveNotice` and
`saveNoticeFor` are imported from `./country-overview`. That is a `ui -> ui`
import and adds no cycle: `country-overview.ts` imports only a type from
`../state/persistence`.

### 3.8 Export

One grouped named export at the end, per `javascript/CLAUDE.md` and
`scaffold.test.ts:155`. Types are exported as `type Foo` inside that group — never
`export type { … }`, which the same test rejects.

---

## 4. `src/ui/ProvinceList.tsx`

```tsx
type ProvinceListProps = {
  provinceIds: readonly number[];
  onImageNotice: (notice: ImageNotice | null) => void;
};
```

`ImageNotice` is `{ provinceId: number; rejected: boolean; touched: boolean }`,
declared in `province-list.ts` and lifted to the panel so the notice renders at
the top of the panel body rather than inside a row — the same rule T09 set for the
flag.

### 4.1 Mounting and reset

The panel renders `<ProvinceList key={country.id} … />`. **The key is what resets
the search query and the scroll position when the selection moves to another
country**, with no effect and no cleanup. `country.id` does not change when the
user paints provinces into that same country, so painting never resets the list.
This is the T08 keying doctrine applied one level up.

### 4.2 Signals

`useSignals()` at the top. Three reads, all in the component body, never inside a
`useMemo`:

```ts
const overrides = provinceOverrides.value;
const selectedId = selectedProvinceId.value;
// `getMapAssets()` is a plain module variable and NOTIFIES NOBODY. Without this
// read the names stay "Province N" for the whole session when the panel is opened
// before the manifest lands.
const phase = loadPhase.value;
```

A read inside a `useMemo` body is not enough: on a render where the memo does not
re-execute the component would read nothing and quietly unsubscribe.

### 4.3 Rows

```ts
const rows = useMemo(() => {
  return buildProvinceRows(props.provinceIds, {
    displayNameOf: provinceDisplayName,
    overrideOf: (id) => {
      return overrides.get(id) ?? null;
    },
    isKnown: (id) => {
      return provinceById(id) !== null;
    },
  });
}, [props.provinceIds, overrides, phase]);
```

`props.provinceIds` is stable by identity: `assignProvinces` is its only writer and
returns the same array for every country it did not touch, and `updateCountry`
deliberately does not copy it. So a rename, a keystroke in the country lore, or a
paint stroke on another country all cost zero row rebuilds.

`const visible = useMemo(() => filterRows(rows, normalizeQuery(query)), [rows, query])`.

### 4.4 Scroll state

Two pieces of state and one ref:

```ts
const viewportRef = useRef<HTMLDivElement | null>(null);
const [first, setFirst] = useState(0);
const [viewportHeight, setViewportHeight] = useState(0);
```

- `onScroll` computes
  `windowStart(el.scrollTop, PROVINCE_ROW_HEIGHT, OVERSCAN_ROWS, visible.length)`
  and calls `setFirst`. React bails out when the integer is unchanged, so a scroll
  inside one row height costs **zero renders**. The window's position is
  `offsetY`, which is derived from `first` alone — it lives in content space, so
  no per-pixel update is needed.
- `viewportHeight` comes from a `ResizeObserver` on the viewport element, set in a
  `useEffect` with an empty dependency array and disconnected on cleanup. It also
  changes only rarely.
- The render calls
  `windowGeometry(first, viewportHeight, PROVINCE_ROW_HEIGHT, OVERSCAN_ROWS, visible.length)`
  and never reads `el.scrollTop` during render.

### 4.5 Markup

```
<div class=search>            <!-- flex: none -->
  <label>… <input type="search"> …</label>
  <button class=clear>        <!-- only when the query is non-empty -->
</div>
<div class=viewport ref onScroll>       <!-- flex: 1; min-height: 0; overflow-y: auto -->
  <div class=spacer style={{ height: totalHeight }}>
    <div class=window style={{ transform: "translateY(" + offsetY + "px)" }}>
      … rows first..last …
    </div>
  </div>
</div>
```

`.window` is `position: absolute; inset-inline: 0; top: 0`, so it contributes
nothing to `.spacer`'s height. One translated block of contiguous rows, not one
absolute position per row: it is a single style write per scroll step.

`.viewport` is `flex: 1; min-height: 0; overflow-y: auto`. `Panel`'s `.body` is
already `display: flex; flex-direction: column` with `overflow-y: auto` and
`min-height: 0`, so a `flex: 1; min-height: 0` child becomes the scroller and the
panel body itself never scrolls. **`Panel` needs no change.** Every sibling of the
viewport inside the body must be `flex: none`, or the body will scroll instead.

Each row is `<ProvinceRow key={row.id} … />`. Keying by the province id is what
makes the sliding window correct: when the window moves, the leaving key unmounts
and the entering key mounts fresh, so `useFieldCommit`'s buffer can never be shown
over, or committed into, a different province. The inner fields therefore need no
keys of their own.

### 4.6 Selection sync — list to map

The row's header strip is a `<button>` whose `onClick` calls `selectProvince(row.id)`.

`selectProvince` sets scope `"province"` and clears the stored country id. The
panel does **not** empty as a result: `selectedCountryId` at any scope other than
`"country"` reads `countryOfProvince` live, and the province is by construction
inside the listed country, so `selectedCountry` returns the same country and the
list keeps rendering. This is worth stating because it looks like a bug waiting to
happen and is not.

The row container also carries `onFocusCapture={() => selectProvince(row.id)}`, so
typing in a field moves the map highlight to the province being edited.
`selectProvince` deduplicates through `sameSelection`, so a focus move inside one
row writes nothing.

### 4.7 Selection sync — map to list

```ts
const syncedRef = useRef<number | null>(null);

useEffect(() => {
  const el = viewportRef.current;
  if (el === null) {
    return;
  }
  if (selectedId === null) {
    syncedRef.current = null;
    return;
  }
  if (syncedRef.current === selectedId) {
    return;
  }
  const index = indexOfProvince(visible, selectedId);
  if (index < 0) {
    // Filtered out, or not in this country. Do NOT record it as synced: clearing
    // the query re-runs this effect and the scroll happens then.
    return;
  }
  syncedRef.current = selectedId;
  const next = scrollTopForIndex(
    index,
    el.scrollTop,
    el.clientHeight,
    PROVINCE_ROW_HEIGHT,
    visible.length,
  );
  if (next === null) {
    return;
  }
  el.scrollTop = next;
}, [selectedId, visible]);
```

Three properties this shape buys:

- **It never fights the user.** The guard is on the selection id, not on a render.
  Scrolling by hand does not re-scroll, because `selectedId` did not change.
- **A row click does not jump the list.** The clicked row is visible, so
  `scrollTopForIndex` returns `null`.
- **No loop.** Assigning `scrollTop` fires `scroll`, which calls `setFirst`, which
  re-renders — but `syncedRef` already holds the id, so the effect is a no-op on
  that render.

A plain `useEffect`, not a `useSignalEffect`: the signal is read in the render body
and arrives here as a dependency. `selectProvince` is called from DOM handlers
only, never from an effect.

### 4.8 Empty and edge states inside the list

- No rows at all: the panel handles it (§5), the list is not rendered.
- A query matches nothing: `no province matches "<query>"` plus a `clear filter`
  button.
- The selected province is filtered out: a line above the viewport reading
  `the selected province is hidden by this filter`, with the same clear button. No
  scroll happens.

---

## 5. `src/ui/ProvinceRow.tsx`

```tsx
type ProvinceRowProps = {
  row: ProvinceRow;
  selected: boolean;
  onSelect: (id: number) => void;
  onImageNotice: (notice: ImageNotice | null) => void;
};
```

**No `useSignals()`.** It reads no signal, and the call would subscribe a component
to nothing — the same rule `EditableText` and `ImageUpload` follow.

Markup, in order:

```
<li class=row data-province-row data-selected data-known
    style={{ height: PROVINCE_ROW_HEIGHT }}
    onFocusCapture={...}>
  <button class=rowHead onClick={...}>
    <span class=rowName>{row.name}</span>
    {row.edited ? <span class=rowDot title="edited — stored in this browser" /> : null}
    <span class=rowId>#{row.id}</span>
  </button>
  <div class=rowBody>
    <ImageUpload … />
    <div class=rowFields>
      <EditableText … />
      <EditableTextArea … />
    </div>
  </div>
</li>
```

`data-province-row` is the browser check's selector for counting live rows (§11).

### 5.1 The image

```tsx
<ImageUpload
  chooseLabel="add…"
  label="Image"
  maxEdge={PROVINCE_IMAGE_MAX_EDGE}
  previewClassName={styles.rowPreview}
  replaceLabel="change…"
  value={props.row.imageDataUrl}
  onCommit={onImage}
/>
```

No `hint`: the row is 196 px tall and a standing hint line does not fit. The panel
footer carries the format and the budget once for the whole list instead.

The short labels are load bearing. The dock is 380 px, the image column is 136 px,
and `.uploadActions` is a non-wrapping flex row: `choose file…` beside `remove`
overflows it, while `change…` beside `remove` does not. **This is why `ImageUpload`
needs no new prop.**

```ts
function onImage(dataUrl: string | null): void {
  const id = props.row.id;
  if (dataUrl !== null && !isImageDataUrl(dataUrl)) {
    // `setProvinceImage` REJECTS SILENTLY — no return value, no warning, no timer
    // armed. Calling the same predicate the store calls, first, turns a silent
    // drop into a visible sentence without a read-back and without a `.peek()`.
    props.onImageNotice({ provinceId: id, rejected: true, touched: true });
    return;
  }
  setProvinceImage(id, dataUrl);
  // Resolves the quota outcome NOW instead of 400 ms later, which would read as
  // "it worked, then a banner appeared". Only on an image write or removal;
  // keystrokes stay on the debounce. Same rule T09 set for the flag.
  flushState();
  props.onImageNotice({ provinceId: id, rejected: false, touched: dataUrl !== null });
}
```

`isImageDataUrl` is imported from `../state/schema` — the same predicate
`setProvinceImage` runs, not a copy of its rule. The store still guards
independently; this check exists to produce the message, not to replace the guard.

### 5.2 The name

```tsx
<EditableText
  label="Name"
  maxLength={NAME_MAX}
  placeholder={props.row.name}
  value={props.row.rawName}
  onCommit={(value) => {
    setProvinceName(props.row.id, value);
  }}
/>
```

`value` is `rawName`, not `name`. A controlled input has to let the user clear the
field, and `setProvinceName("")` **removes the override**, which is exactly how a
province returns to its manifest name. The resolved name shows as the
`placeholder` and in the header strip, the same pattern T09 used for
`countryDisplayName`.

### 5.3 The lore

```tsx
<EditableTextArea
  areaClassName={styles.rowArea}
  label="Lore"
  maxLength={LORE_MAX}
  placeholder="what happened here"
  rows={PROVINCE_LORE_ROWS}
  value={props.row.lore}
  onCommit={(value) => {
    setProvinceLore(props.row.id, value);
  }}
/>
```

`setProvinceLore("")` removes the field, and removing the last field removes the
whole override. No lore counter: `country-overview.ts`'s counter belongs to a
12-row prose field, and a 3-row box repeated across hundreds of rows has no space
for one.

### 5.4 The one change to `EditableTextArea`

Add a single optional prop:

```ts
// REPLACES `styles.area`, it does not add to it. Two single-class selectors from
// two different CSS modules have equal specificity, so which one wins depends on
// the order rspack happens to emit the modules in. Replacing is deterministic;
// appending is a coin flip that looks fine until a rebuild.
areaClassName?: string;
```

and use it: `className={props.areaClassName ?? styles.area}`. This is exactly the
rule and the wording T09 established for `ImageUpload`'s `previewClassName`.

It is needed because `fields.module.css`'s `.area` sets `min-height: 6em` and
`resize: vertical`, and both break a fixed row height. `styles.rowArea` in T10's
module sets `min-height: 0`, `height: 100%` and `resize: none`, and keeps
everything else — background, border, font, padding — identical by re-declaring it
from the same tokens.

No prop is added to `EditableText`: the default `.input` fits the row unchanged.

---

## 6. `src/ui/ProvincesOverviewPanel.tsx`

```tsx
function ProvincesOverviewPanel() {
  useSignals();
  const [notice, setNotice] = useState<ImageNotice | null>(null);
  const country = selectedCountry.value;
  const warning = stateWarning.value;
  const used = stateBytes.value;
  …
}
```

Order of the body:

1. `country === null` -> the existing empty state, unchanged wording.
2. `country.provinceIds.length === 0` -> the existing empty state, unchanged
   wording.
3. The save notice, if any, at the **top of the body** — panel level, never inside
   a row. A quota failure caused by lore must not appear under one province's file
   picker. `imageSaveNoticeFor(warning, notice !== null && notice.touched)`, plus
   the rejected sentence when `notice.rejected` is true.
4. `<ProvinceList key={country.id} provinceIds={country.provinceIds} onImageNotice={setNotice} />`
5. The footer: `<shown> of <total> · <edited> edited · <budgetText>`, plus the
   image format and max edge, in `.note`.

The notice is not reset in an effect. Like T09's flag message it is **tagged and
derived**: the panel does not remount when the selection moves, only its keyed
child does, so a notice produced for province 412 is simply not shown once the
list is keyed to another country. The `ImageNotice` carries `provinceId` for that
comparison and for naming the province in the sentence.

`Panel`'s `subtitle` reads `country.name + " · " + total + " provinces"`, as today.

---

## 7. `src/ui/province-list.module.css`

Tokens only — no hardcoded colour, gap, radius or font size, per the T08 rule. One
declaration per line, per `javascript/CLAUDE.md`.

Classes: `.search`, `.searchRow`, `.clear`, `.hint`, `.viewport`, `.spacer`,
`.window`, `.rows`, `.row`, `.rowHead`, `.rowName`, `.rowDot`, `.rowId`,
`.rowBody`, `.rowPreview`, `.rowFields`, `.rowArea`, `.empty`, `.note`,
`.notice`, `.filtered`.

The load-bearing rules:

- `.viewport { flex: 1; min-height: 0; overflow-y: auto; position: relative; }`
- `.spacer { position: relative; }` — its height is inline.
- `.window { inset-inline: 0; position: absolute; top: 0; }` — its transform is
  inline.
- `.rows { display: flex; flex-direction: column; list-style: none; margin: 0;
  padding: 0; }` — **no `gap`**. A gap would add height the geometry does not know
  about and the window would drift from the scrollbar.
- `.row { overflow: hidden; }` — **no `height`**. The height is inline, from
  `PROVINCE_ROW_HEIGHT`.
- `.row[data-selected="true"] { border-color: var(--civ-gild); }` — the same mark
  the placeholder's `[data-on="true"]` used.
- `.rowBody { display: grid; grid-template-columns: 136px minmax(0, 1fr); }` —
  136 px is what fits `change…` beside `remove` at `--civ-text-sm`.
- `.rowPreview` is the 72 px-tall preview box, otherwise a copy of
  `fields.module.css`'s `.preview` built from the same tokens.
- `.rowArea` re-declares `.area` with `height: 100%`, `min-height: 0` and
  `resize: none`.

---

## 8. Edge cases and failure modes

1. **The manifest has not loaded.** `provinceById` returns `null`, so every name
   reads `"Province N"` and `known` is false for every row. The list reads
   `loadPhase.value` so it re-renders and re-labels the moment the load finishes.
   Nothing is written, so nothing is corrupted by editing during the window.
2. **A phantom province id.** Ids 1318 and 1458 do not exist and a stored document
   can name others. Such a row is listed, marked `data-known="false"`, and stays
   fully editable. Hiding it would leave its override unreachable and undeletable.
3. **The list shrinks under the scroll position** — a search narrows it, or a
   paint stroke moves provinces out of the country. `windowGeometry` clamps `first`
   to `maxFirst`, so no blank frame renders before the browser's own `scrollTop`
   clamp fires a `scroll` event.
4. **A row unmounts with a pending draft.** `useFieldCommit` flushes on unmount and
   the row is keyed by the province id, so the draft lands on the right province.
   This is the intended behaviour, not a leak.
5. **A row unmounts untouched.** `flush()` returns early because
   `latest.current === null`. No write, no `markDirty`, no debounce timer. This is
   what makes scrolling a 900-province list write nothing.
6. **A row is focused when it scrolls out of view.** The browser moves focus to
   `body`. The draft is committed by the unmount flush, so nothing is lost. The
   user has to scroll the list while typing to reach this, which is unlikely and
   harmless.
7. **An image upload is in flight when its row unmounts.** `ImageUpload` guards on
   `mountedRef` and returns before `onCommit`, so the picked image is silently
   dropped. `downscaleImage` takes tens of milliseconds and the OS file dialog has
   just closed, so reaching this needs a deliberate scroll immediately after
   picking. `OVERSCAN_ROWS` of 4 widens the safe band. **Known limitation, recorded
   rather than fixed** — fixing it means lifting the busy flag out of
   `ImageUpload`, which changes a component three panels share.
8. **The store silently rejects an image.** `setProvinceImage` drops a data URL
   that fails `isImageDataUrl` with no return value and no warning. §5.1 runs the
   same predicate first and renders a sentence.
9. **The quota is hit.** `flushState()` after an image write resolves it
   immediately, `writeNow` raises the `quota` warning, `imageSaveNoticeFor` turns
   it into a sentence at the top of the panel, and `App.tsx`'s banner shows it too.
   The image stays on screen and in memory, persistence stays on, and the next
   edit retries. Non-fatal, exactly as T09.
10. **The document passes `STORAGE_BUDGET_BYTES`.** The `budget` warning renders as
    a `warn`-kind notice, not an error: the data is on disk. The footer's
    "room for about N more" reaches `0` at the same point.
11. **The country is deleted while the panel is open.** `selectedCountry` becomes
    `null` and the panel falls back to its empty state. No stale row survives.
12. **The selected province leaves the country mid-drag.** `selectedCountry`
    follows the province live, so the panel switches to the new country, the list
    remounts on the new key, and the sync effect scrolls to the row there.
13. **Escape with a pending draft.** `Shell` closes the panel, the rows unmount,
    and the unmount flush commits. There is no draft to protect, which is why
    `Shell` deliberately does not suppress Escape inside a field.
14. **A 900-province country.** 900 * 196 = 176 400 px of scroll height, well
    inside every browser's element height limit. Rendered rows stay at 13.

---

## 9. The image budget — the numbers to state

`PROVINCE_IMAGE_MAX_EDGE` **stays at 320.** T09 moved `FLAG_MAX_EDGE` to 384 and
explicitly left this constant to T10, and `image.test.ts` pins it at 320. The
number is right on its own terms: the row preview is 96 CSS px, which is 192
device px at DPR 2, and 320 leaves headroom for a larger preview later without
another re-encode of everybody's images. Raising it would multiply the storage
cost by the square of the ratio for a surface nothing draws.

The arithmetic, from T05's measured data point (a 384-edge WebP of the sample flag
is 35 359 base64 characters):

- `localStorage` is accounted in **UTF-16 code units**, so one character costs
  2 bytes. `utf16Bytes` in `persistence.ts` is `length * 2`.
- At 320 the pixel area is `(320 / 384)² = 0.69` of that, so roughly 24 000
  characters, or **about 48 KB of `localStorage` per province image**.
- `STORAGE_BUDGET_BYTES` is 4 000 000, so **about 80 province images** fit before
  the `budget` warning appears.
- The real quota is near 5 000 000, so **about 100** before `setItem` throws and
  the `quota` warning appears.
- Worst case: `IMAGE_TARGET_BYTES` caps one image at 256 KB decoded, which is
  about 350 000 characters, or 700 KB stored. **Five such images would exhaust the
  budget.** It takes a large, noisy photograph that resists the whole quality
  ladder.
- Text is not free either: an 8000-character lore is 16 KB stored, so about 250
  full-length lores would also fill the budget. Neither limit is reachable by
  accident, and both are surfaced by the footer and the `budget` warning.

`PROVINCE_IMAGE_STORE_BYTES = 48000` is the constant the footer divides by.

---

## 10. Tests — `src/ui/province-list.test.ts`

Node's runner through `tsx`, beside the source, pure logic only. No `.tsx` is unit
tested; the repo has no jsdom.

1. `windowStart` floors, subtracts the overscan, clamps at 0 and at `rowCount - 1`,
   and returns 0 for an empty list and a non-finite scroll.
2. `windowGeometry` — `last` is exclusive and never exceeds `rowCount`;
   `offsetY === first * rowHeight`; `totalHeight === rowCount * rowHeight`; an
   empty list yields all zeros.
3. **The virtualisation property.** For a 600 px viewport at
   `PROVINCE_ROW_HEIGHT`, the rendered count `last - first` is the same for 50,
   300 and 1648 rows, and is at most `ceil(600 / 196) + 1 + 2 * OVERSCAN_ROWS`.
   This is the test that fails if someone renders the whole list.
4. `windowGeometry` clamps a stale high `first` after the list shrinks, so `last`
   equals `rowCount` and the window is never past the end.
5. `scrollTopForIndex` returns `null` for a fully visible row, for a negative index
   and for an index past the end.
6. `scrollTopForIndex` aligns to the top for a row just above, to the bottom for a
   row just below, centres a jump beyond one viewport, and clamps the result into
   `[0, total - viewportHeight]` at both ends.
7. `normalizeQuery` trims, lowercases and collapses inner whitespace runs.
8. `matchesQuery` — an empty query matches everything; the name match is
   case-insensitive and a substring; the id match is a **prefix**, so `41` matches
   41 and 412 but not 141; the lore is not searched.
9. `filterRows` returns the **same array reference** for an empty query, and a new
   shorter array otherwise.
10. `indexOfProvince` returns `-1` for `null` and for an absent id.
11. `buildProvinceRows` layers the injected display name, defaults `lore` to `""`
    and `imageDataUrl` to `null`, sets `rawName` from the override only, and sets
    `edited` false for an untouched province.
12. `buildProvinceRows` keeps a phantom id with `known: false`.
13. `overrideSummary` counts `edited` and `withImage` independently.
14. `imagesRemaining` floors at 0 for a document already over budget and matches
    the §9 arithmetic at 4 000 000 / 48 000.
15. `budgetText` reads differently at zero images.
16. **`imageSaveNoticeFor` decides for every `WarningKind`.** The expectation table
    is typed `Record<WarningKind, SaveNoticeKind | null>`, so adding a kind in
    `persistence.ts` fails `yarn typecheck` in this test. Same guard T09 wrote,
    because the underlying `switch` still ends in a `return null`.
17. `imageSaveNoticeFor(quota, true)` differs from `saveNoticeFor(quota, true)` and
    names a province image, and every other kind is byte-identical to
    `saveNoticeFor(warning, false)`.
18. **Source assertions**, the precedent being `scaffold.test.ts` and
    `country-overview.test.ts`. Each of these is silent when removed and none is
    reachable without jsdom:
    - `ProvinceRow.tsx` passes `maxEdge={PROVINCE_IMAGE_MAX_EDGE}` and contains no
      `FileReader`, `toDataURL` or `createObjectURL`.
    - `ProvinceRow.tsx` calls `flushState()` and `isImageDataUrl(`.
    - `ProvinceRow.tsx` does **not** call `useSignals`.
    - `ProvinceList.tsx` reads `loadPhase.value`.
    - `ProvinceList.tsx` renders the row with `key={row.id}`.
    - `ProvincesOverviewPanel.tsx` renders `<ProvinceList` with `key={country.id}`.
    - `ProvinceRow.tsx` applies `PROVINCE_ROW_HEIGHT` as an inline height, and
      `province-list.module.css` sets no `height` on `.row` — the constant is the
      single source of truth.
    - `province-list.module.css` contains no `gap` inside `.rows`.

Expect roughly 22 new cases. **No existing test may be edited, weakened or
deleted.** The measured baseline is 547 (`.plan/T09/memory.md`); the brief's "493"
is stale.

---

## 11. Verification

Run from
`javascript/packages/prototypes/civitas/civitas-interactive-map`.

```bash
yarn typecheck                                   # exit 0, no output
yarn test                                        # 547 before, ~569 after, 0 failing
npx tsx --test src/ui/province-list.test.ts      # the new file alone
yarn build                                       # exit 0, only the 3 known asset-size warnings
git status --porcelain -- ../civitas-map         # must print NOTHING
yarn dev                                         # then the checklist below
```

Browser checklist, Chrome, foreground tab:

1. Create a country and paint a few hundred provinces. Open `PROVINCES`.
2. `document.querySelectorAll("[data-province-row]").length` is at most 13 at the
   top, in the middle and at the bottom of the scroll. **The virtualisation gate.**
3. Scroll the whole list top to bottom, close the panel, then read
   `JSON.parse(localStorage["civitas.state.v1"]).provinceOverrides` — it must be
   `{}`. The footer must read `0 edited`. **The sparseness gate.**
4. Edit one name. Exactly one key appears, holding only `name`. Add lore and an
   image to the same province: the key gains only those two fields.
5. Clear the name: the key loses `name` and the header strip falls back to the
   manifest name. Clear all three: the key disappears entirely.
6. Type in the search box: the row count drops, the footer's `n of N` follows, and
   the id prefix `41` surfaces 41 and 412.
7. Click a row header: the map highlight moves, the plaque follows, and the list
   does not jump.
8. Left-click a province on the map that is far down the list: the list scrolls to
   it, the row is centred, and it carries the selected mark.
9. Filter the selected province out: the "hidden by this filter" line appears and
   no scroll happens. Clear the filter: the list scrolls to it.
10. Scroll with the panel open and watch the frame rate in the Performance panel —
    no long task over 16 ms during a continuous scroll.
11. Quota: fill the origin with ballast until `setItem` throws, then upload an
    image. The panel notice appears **immediately**, the image stays on screen, and
    the app keeps working. Delete the ballast afterwards.
12. `read_console_messages` with `onlyErrors`: nothing from the app.
13. `localStorage.clear()` at the end, so the next agent starts empty.

---

## 12. Explicitly NOT part of T10

- **No new `localStorage` key, schema field or migration.** `serializeState`'s
  shape is unchanged and `provinceOverrides` keeps the three optional fields T05
  defined.
- **No camera move.** Selecting a row highlights the province; it does not pan or
  zoom the map to it. That needs a new `view-store` action, and `view-store`'s
  fitted policy and its "no action inside a `useSignalEffect`" rule are not
  something a panel task should be reopening.
- **No province geometry editing**, no reordering, no multi-select, no bulk edit,
  no copy between provinces. Geometry belongs to `../civitas-map`.
- **No assignment from this panel.** Painting a province into or out of a country
  stays in assign mode and the left `CountryPanel`. Country colour, creation and
  deletion stay there too.
- **No "all provinces" view.** The panel lists the selected country's provinces.
  The 1648-province unassigned set has no owner to hang a panel on.
- **No lore full-text search** and no lore character counter in a row.
- **No jsdom and no `.tsx` unit test.** Adding a DOM test environment is a task of
  its own.
- **No change to `ImageUpload`, `EditableText`, `use-field-commit.ts`, `Panel` or
  any store.** The single shared-component change is `areaClassName` on
  `EditableTextArea`.
- **No new dependency.** The virtualiser is about forty lines of pure arithmetic
  in `province-list.ts`.
- Still open from earlier tasks and still out of scope here: the plaque and panel
  dock overlap between roughly 900 and 1200 px, `.hud`'s `max-width` below roughly
  760 px, and the in-flight-upload-on-unmount drop in §8.7.
- `README.md` — the docs agent owns it.
