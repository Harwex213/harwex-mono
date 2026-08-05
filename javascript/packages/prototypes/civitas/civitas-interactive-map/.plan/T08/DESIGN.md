# T08 — Selection interaction and the UI shell

Selection becomes a real state machine with three slots. The app grows an EU-style
shell around the map: a country plaque, a button bar, one docked panel at a time,
a token file every later panel reads, and three shared editable-field components.

Phase 1 and Phase 2 code is EXTENDED, never duplicated. `selection-store.ts`,
`country-store.ts`, `MapCanvas.tsx`, `CountryPanel.tsx` and `App.tsx` are edited in
place. No second render path, no second store, no new overlay field on
`OverlayInput` — `src/ui/render.ts` is not touched at all, and
`render.test.ts`'s "an overlay drawn without the optional fields is byte-identical"
assertion therefore still holds unchanged.

---

## 1. Files

### Create

| Path | Responsibility |
|---|---|
| `src/ui/theme.css` | The `--civ-*` token block on `:root`, plus the re-point of T01's legacy aliases onto it. Global CSS, not a module. |
| `src/state/panel-store.ts` | Which of the three panels is open. One signal, three actions. |
| `src/ui/Shell.tsx` | The layout frame. Mounts the map, the plaque, the country panel, the button bar, the panel dock and the assign-mode banner. Owns the ONE window `Escape` handler. |
| `src/ui/shell.module.css` | Shell layout, the button bar, the assign-mode banner and rail. |
| `src/ui/CountryPlaque.tsx` | The top plaque: flag, name, slogan, sub-line, empty states. |
| `src/ui/country-plaque.module.css` | Plaque styles. |
| `src/ui/Panel.tsx` | Reusable panel chrome: heading, close control, scrollable body, read-only chip. |
| `src/ui/panel.module.css` | Panel chrome styles. |
| `src/ui/PanelHost.tsx` | Renders the panel named by `openPanelId`, or nothing. |
| `src/ui/CountryOverviewPanel.tsx` | Phase-3 placeholder body. Wires the four field components to `updateCountry` — this is the T08 round-trip proof. T09 replaces the layout. |
| `src/ui/ProvincesOverviewPanel.tsx` | Phase-3 placeholder body. Static list of the selected country's province names, no editing. T10 replaces it. |
| `src/ui/EconomicsPanel.tsx` | Phase-3 placeholder body. Text stub. T12 replaces it. |
| `src/ui/panel-bodies.module.css` | Shared styles for the three placeholder bodies. |
| `src/ui/use-field-commit.ts` | The buffered-commit hook both text fields use. No JSX, no signals. |
| `src/ui/EditableText.tsx` | Single-line controlled field. |
| `src/ui/EditableTextArea.tsx` | Multiline controlled field. |
| `src/ui/ImageUpload.tsx` | File picker -> `downscaleImage` -> data URL, with preview and remove. |
| `src/ui/fields.module.css` | Shared field styles. |
| `src/state/selection-store.test.ts` | The selection transition table and the signal wrappers. |
| `src/state/panel-store.test.ts` | Open / close / toggle. |

Flat under `src/ui/`, matching the existing layout. No `fields/` or `panels/`
subdirectories — the package has none anywhere and one convention beats two.

### Change

| Path | Change |
|---|---|
| `src/state/selection-store.ts` | Rewritten. Adds the country slot, the scope, the pure transition function and the read-only computeds. |
| `src/state/country-store.ts` | `buildTintWordTable` gains two optional parameters; `countryTintWords` reads `selectedCountryId`. |
| `src/ui/tint-layer.ts` | Adds `SELECTED_TINT_ALPHA` beside `TINT_ALPHA`. Nothing else. |
| `src/ui/MapCanvas.tsx` | Left-click and right-click selection semantics. HUD restyled and moved. |
| `src/ui/map-canvas.module.css` | `.host` gets an explicit sea background; the HUD moves and takes the new tokens. |
| `src/ui/CountryPanel.tsx` | Drops its own `Escape` listener; a row click also selects the country. |
| `src/ui/country-panel.module.css` | Converted to `--civ-*`. |
| `src/App.tsx` | Renders `<Shell />`. Keeps the store init, the flush install, the country sync, the load status and the warning banner. |
| `src/app.module.css` | Warning and status restyled onto the tokens. |
| `src/main.tsx` | Imports `./ui/theme.css` after `./index.css`. |
| `src/state/world-store.ts` | `updateCountry` stops copying `provinceIds`. One line. Reason in §9. |
| `src/state/country-store.test.ts` | Two added tests for the emphasis word. |

`src/ui/render.ts`, `src/map/*`, `src/state/borders-store.ts`,
`src/state/label-store.ts` and `src/state/assign-store.ts` are NOT touched.

---

## 2. Selection

### 2.1 The model

Three slots, held in one signal so a write is atomic and needs no `batch`.

```ts
type SelectionScope = "none" | "province" | "country";

type SelectionState = {
  provinceId: number | null;
  // Only meaningful when `scope` is "country". For "province" the country is
  // DERIVED live from `countryOfProvince`; see §2.3.
  countryId: number | null;
  scope: SelectionScope;
};
```

### 2.2 The pure transition — `nextSelection`

Same shape as `strokeActionFor` in `assign-store.ts`: the whole rule in one pure
exported function, so `selection-store.test.ts` covers it without touching signals.

```ts
type SelectionIntent =
  | { kind: "province"; provinceId: number | null }
  | { kind: "countryOfProvince"; provinceId: number | null }
  | { kind: "country"; countryId: number | null }
  | { kind: "clear" };

function nextSelection(
  current: SelectionState,
  intent: SelectionIntent,
  ownerOf: ReadonlyMap<number, number>,
): SelectionState;
```

The complete table. `owner` means `ownerOf.get(provinceId)`.

| Intent | Result `provinceId` | Result `countryId` | Result `scope` |
|---|---|---|---|
| `province`, id non-null | id | null | `"province"` |
| `province`, id null (sea) | null | null | `"none"` |
| `countryOfProvince`, id non-null, owner exists | id | owner | `"country"` |
| `countryOfProvince`, id non-null, no owner | id | null | `"province"` |
| `countryOfProvince`, id null (sea) | null | null | `"none"` |
| `country`, countryId non-null | `current.provinceId` if `ownerOf.get(it) === countryId`, else null | countryId | `"country"` |
| `country`, countryId null | `current.provinceId` | null | `current.provinceId === null ? "none" : "province"` |
| `clear` | null | null | `"none"` |

Two rules to state out loud, because both are easy to get wrong:

- **Right-clicking an unassigned province does NOT clear the province.** There is
  no country to select, so the intent degrades to a province selection. Clearing
  would make right-click feel broken over the two thirds of the map that belongs to
  nobody.
- **`country` intent keeps the province only when it is inside that country.**
  Otherwise the province slot would point at a province of a different country
  while the plaque shows this one. This is the path `CountryPanel`'s row click and
  a future T10 row click take.

`sameSelection(a, b)` is a plain three-field comparison and the setter skips the
write when it returns true. A fresh object always notifies, so without the guard a
click on the already-selected province repaints the map and re-runs the tint diff.

### 2.3 The signals

```ts
const hoveredProvinceId: ReadonlySignal<number | null>;
const selectedProvinceId: ReadonlySignal<number | null>;
const selectedCountryId: ReadonlySignal<number | null>;
const selectionScope: ReadonlySignal<SelectionScope>;
const selectedCountry: ReadonlySignal<Country | null>;
const selectedProvince: ReadonlySignal<Province | null>;

function setHoveredProvince(id: number | null): void;
function selectProvince(id: number | null): void;          // left click
function selectCountryOfProvince(id: number | null): void;  // right click
function selectCountry(countryId: number | null): void;     // a list row
function clearSelection(): void;
```

Every exported signal is a `ReadonlySignal` computed over a private writable one,
which is T05's stated rule (`world-store.ts` header) and means an action is the only
way to change selection. `setSelectedProvince` from T04 is renamed to
`selectProvince`; the only caller is `MapCanvas.tsx`, which this task rewrites
anyway.

`selectedCountryId` is a **computed, not a stored value**:

```
scope === "country"  ->  countryById.value.has(stored) ? stored : null
otherwise            ->  provinceId === null ? null : (countryOfProvince.value.get(provinceId) ?? null)
```

Two problems fall out for free:

- **A deleted country cannot linger in the selection.** Same trick
  `activeCountryId` uses in `assign-store.ts`.
- **A province repainted into another country while it is selected updates the
  plaque immediately**, because a province-scoped selection reads the owner live.
  A stored id would show the old country for the rest of the session.

`selectionScope` is a computed that downgrades rather than reporting a state the
data no longer supports:

```
scope raw "country" && selectedCountryId.value !== null  ->  "country"
provinceId !== null                                      ->  "province"
otherwise                                                ->  "none"
```

`selectedCountry` is `countryById.value.get(selectedCountryId.value) ?? null`.
`selectedProvince` is `provinceById(selectedProvinceId.value)` and returns `null`
until the map load finishes — it is only used for `bounds`/`pixelCount` readouts.

`selection-store.ts` gains an import of `countryById` and `countryOfProvince` from
`./world-store`. There is no cycle: `world-store` imports `map-store`,
`persistence`, `schema` and `../map/borders`, and none of them import
`selection-store`.

### 2.4 Which mode owns the left click

The rule, in full. Nothing here is implicit.

| Condition | Left press | Left click (no drag) | Middle | Right |
|---|---|---|---|---|
| `assignMode === false` | starts a pan | **selects the province** | pans | **selects the country** |
| `assignMode === true` and `activeCountryId !== null` | starts a PAINT stroke | paints; **selection is untouched** | pans | **selects the country** |
| `assignMode === true` and `activeCountryId === null` | falls through to a pan | **selects the province** | pans | **selects the country** |
| press outside the map bounds in assign mode | falls through to a pan | selects `null` -> clears | pans | clears |

- **The paint tool owns the left button whenever it can actually paint.** The
  fall-through when no country is active already exists in `onPointerDown`
  (`beginStroke` returns `null`); T08 keeps it and makes the click at the end of
  that fall-through a selection, so the map is never a dead surface.
- **The right button is never a paint gesture and never a pan.** It selects in both
  modes. That is what lets a user inspect a rival country without leaving assign
  mode.
- **A ctrl+left click counts as the right button**, on every platform. It is the
  right click of macOS, so it takes the whole "Right" column of the table above and
  none of the "Left" one — it never pans and never paints. §2.5 has the mechanism.
- Double-click zoom stays suppressed in assign mode, unchanged from T06.

### 2.5 The right-click plumbing in `MapCanvas.tsx`

**Select on `contextmenu`, not on `pointerdown`.** `contextmenu` is the one event
that means "the user asked for the context action" on every platform, including
macOS ctrl+click where the pointer button is 0. It carries `clientX`/`clientY`, and
the handler that must call `preventDefault()` anyway is the same handler.

```tsx
function onContextMenu(event: ReactMouseEvent<HTMLDivElement>): void {
  // Unconditional, and first: the browser menu must not pop even when the
  // press is declined below.
  event.preventDefault();
  if (isHudControl(event.target)) {
    return;
  }
  // A GENUINE right press during a left pan or a paint stroke inspects nothing.
  // A ctrl+click cannot be turned away here, because `onPointerDown` declined
  // it and the gesture is still idle.
  if (gestureRef.current.kind !== "idle") {
    return;
  }
  selectCountryOfProvince(provinceAtClient(event.currentTarget, event.clientX, event.clientY));
}
```

`onPointerDown` gains an early return for a CONTEXT PRESS, placed **before** the
existing `event.preventDefault()`:

```tsx
function isContextPress(event: { button: number; ctrlKey: boolean }): boolean {
  return event.button === 2 || (event.button === 0 && event.ctrlKey);
}

// A context press starts no gesture at all. The return is BEFORE the
// preventDefault below on purpose: preventing a pointerdown's default suppresses
// the compatibility mouse events, and an engine that derives `contextmenu` from
// `mousedown` would then never fire it. Nothing about a context press needs the
// text-selection or drag suppression that call provides.
if (isContextPress(event)) {
  return;
}
```

**macOS ctrl+click is a first-class right click and must be declined in
`onPointerDown`, not repaired later.** `contextmenu` derives from `mousedown`,
which follows `pointerdown`, so a ctrl+click that is only tested against
`button === 2` has already started a pan or a PAINT stroke by the time
`onContextMenu` runs — and `beginStroke` assigns the pressed province
immediately, so nothing downstream can take that back. Declining the press at the
source keeps the gesture idle, which is the only reason the idle guard in
`onContextMenu` is safe.

`isContextPress` is applied on every platform, not gated on macOS. Windows and
Linux fire no `contextmenu` for a ctrl+click, so `onPointerUp` runs the same
selection there:

```tsx
if (event.button === 0 && event.ctrlKey && gesture.kind === "idle") {
  selectCountryOfProvince(provinceAtClient(event.currentTarget, event.clientX, event.clientY));
  return;
}
```

On macOS both handlers run and the second call is the identical intent on the
identical pixel, which `sameSelection` swallows. One rule, no platform sniffing,
and a ctrl+click means "select this country" everywhere.

### 2.6 The left-click plumbing

`onPointerUp` replaces the T04 placeholder. The existing structure already declines
a moved pan and already returns early for a paint gesture, so the change is only the
call:

```tsx
if (
  event.button === 0 &&
  gesture.kind === "pan" &&
  gesture.pointerId === event.pointerId &&
  !gesture.moved
) {
  const rect = event.currentTarget.getBoundingClientRect();
  const pixel = mapPixelAt(event.clientX - rect.left, event.clientY - rect.top);
  selectProvince(pixel ? provinceAt(pixel.x, pixel.y) : null);
}
```

`provinceAt` returning `null` covers both the sea and unpainted canvas, so "clicking
empty sea clears the selection" needs no separate branch.

Hover is unchanged: `onPointerMove` already calls `setHoveredProvince`, and
`onPointerLeave` already clears it. Both setters still deduplicate.

### 2.7 The selected country on the map

The selected country is emphasised by **raising the alpha of its existing tint**.
No new draw call, no new overlay field, no per-province stamp loop.

`src/ui/tint-layer.ts`:

```ts
// TINT_ALPHA is 0.32. The selected country goes to 0.48, which is a visible step
// without swallowing the T04 select fill (alpha 112/255 = 0.44 accent gold) drawn
// on top of it.
const SELECTED_TINT_ALPHA = 0.48;
```

`src/state/country-store.ts`:

```ts
function buildTintWordTable(
  list: readonly Country[],
  max: number,
  emphasisCountryId?: number | null,
  emphasisAlpha?: number,
): Uint32Array;
```

Both new parameters are optional and default to `null` / `TINT_ALPHA`, so the seven
existing `country-store.test.ts` call sites keep compiling and keep passing. Inside
the loop the alpha becomes
`country.id === emphasisCountryId ? (emphasisAlpha ?? SELECTED_TINT_ALPHA) : TINT_ALPHA`.
The hex is still parsed once per country.

```ts
const countryTintWords: ReadonlySignal<Uint32Array> = computed(() => {
  return buildTintWordTable(
    countries.value,
    maxProvinceId.value,
    selectedCountryId.value,
    SELECTED_TINT_ALPHA,
  );
});
```

Why this is cheap: `MapCanvas`'s existing tint effect already reacts to
`countryTintWords` and calls `syncTintLayer`, and `diffTintWords` repaints only the
ids whose word actually changed — that is the previously-selected country's
provinces plus the newly-selected one's, and nothing else. Selecting a
300-province country repaints 300 bounding boxes once, on the click, not per frame.
`country-store.ts` gains an import from `./selection-store`; there is no cycle,
because `selection-store` imports only `./world-store`.

---

## 3. Theme tokens — `src/ui/theme.css`

Imported from `src/main.tsx` **after** `./index.css`, so its `:root` block wins on
equal specificity. It is global CSS, not a module: custom properties have to reach
every subtree, and CSS modules would mangle nothing here but would need an import in
every file.

```css
:root {
  /* surfaces */
  --civ-sea: #0e1218;
  --civ-parchment: #ece3d0;
  --civ-parchment-dim: #ded2b9;
  --civ-vellum: #f6f1e4;
  --civ-plaque: #f2ead8;
  --civ-scrim: rgba(14, 18, 24, 0.45);

  /* ink */
  --civ-ink: #241d14;
  --civ-ink-dim: #574a39;
  --civ-ink-faint: #8a7c66;
  --civ-ink-invert: #f0ead9;

  /* lines and marks */
  --civ-rule: #c8b896;
  --civ-rule-strong: #9d8a64;
  --civ-gild: #9a6b1f;
  --civ-gild-soft: #d8a24a;
  --civ-danger: #8f3a2e;

  /* space */
  --civ-space-1: 2px;
  --civ-space-2: 4px;
  --civ-space-3: 8px;
  --civ-space-4: 12px;
  --civ-space-5: 16px;
  --civ-space-6: 24px;
  --civ-space-7: 32px;

  /* radius and borders */
  --civ-radius-sm: 2px;
  --civ-radius-md: 4px;
  --civ-border-hair: 1px solid var(--civ-rule);
  --civ-border-strong: 1px solid var(--civ-rule-strong);
  --civ-border-plaque: 2px solid var(--civ-rule-strong);

  /* type */
  --civ-font-sans: "Inter", "Segoe UI", system-ui, sans-serif;
  --civ-font-display: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --civ-font-mono: "SF Mono", "JetBrains Mono", ui-monospace, monospace;
  --civ-text-xs: 10px;
  --civ-text-sm: 11px;
  --civ-text-md: 13px;
  --civ-text-lg: 16px;
  --civ-text-xl: 22px;
  --civ-leading-tight: 1.2;
  --civ-leading-body: 1.5;
  --civ-tracking-caps: 0.14em;
  --civ-tracking-plaque: 0.22em;

  /* elevation */
  --civ-shadow-panel: 0 6px 20px rgba(8, 10, 14, 0.45);
  --civ-shadow-plaque: 0 4px 14px rgba(8, 10, 14, 0.4);

  /* layers */
  --civ-z-map: 0;
  --civ-z-chrome: 2;
  --civ-z-panel: 3;
  --civ-z-plaque: 4;
  --civ-z-banner: 5;
  --civ-z-warning: 6;
}
```

Then the legacy re-point, so T01's palette moves with the theme and
`map-canvas.module.css`, `app.module.css` and the base control styles in
`index.css` do not each need rewriting:

```css
:root {
  --bg: var(--civ-sea);
  --bg-panel: var(--civ-parchment);
  --bg-raised: var(--civ-vellum);
  --bg-sunken: var(--civ-parchment-dim);
  --border: var(--civ-rule);
  --border-strong: var(--civ-rule-strong);
  --text: var(--civ-ink);
  --text-dim: var(--civ-ink-dim);
  --accent: var(--civ-gild);
  --accent-dim: var(--civ-gild-soft);
  --danger: var(--civ-danger);
  --radius: var(--civ-radius-md);
}
```

Four consequences of the re-point that must be handled, not discovered:

1. **`--bg-sunken` maps to parchment-dim, NOT to the sea.** `index.css` styles
   `input[type="text"]` with `background: var(--bg-sunken)` and `color: var(--text)`.
   Pointing it at the sea colour would put ink text on a near-black field.
2. **`.host` in `map-canvas.module.css` therefore needs an explicit
   `background: var(--civ-sea);`** — it currently relies on `--bg-sunken` being dark.
   This is the one required edit in that file besides the HUD.
3. **`color-scheme` is `dark` at the root and `light` on parchment surfaces.** The
   map is dark and the panels are not. `.panel`, `.plaque` and the shell rail each
   set `color-scheme: light;` so the panel-body scrollbar, `input[type="color"]` and
   `input[type="file"]` render against a light surface.
4. **The canvas label font stays on the sans stack.** `LABEL_FONT_STACK` in
   `label-layer.ts` duplicates `--font` and canvas cannot read a custom property.
   `--civ-font-display` is a DOM-chrome-only token. Do not point `--font` at it, and
   do not touch `label-layer.ts`.

Later panels use `--civ-*` only. No panel written from here on hardcodes a colour, a
gap, a radius or a font size.

---

## 4. The shell

### 4.1 Layout

`App.tsx` keeps everything lifecycle-shaped and renders one child:

```tsx
<div className={styles.app}>
  <Shell />
  {warning === null ? null : <div className={styles.warning} …/>}
  {phase === "ready" ? null : <p className={styles.status} …/>}
</div>
```

`Shell.tsx`:

```tsx
<div className={styles.shell} data-mode={assignMode.value ? "assign" : "pan"}>
  <div className={styles.mapLayer}>
    <MapCanvas />
  </div>
  <div className={styles.plaqueRail}>
    <CountryPlaque />
  </div>
  <CountryPanel />
  <div className={styles.bar}>{/* three buttons */}</div>
  <PanelHost />
  {assignMode.value ? <div className={styles.assignRail} … /> : null}
</div>
```

Positions, all absolute over a full-bleed map:

| Piece | Position |
|---|---|
| `mapLayer` | `inset: 0`, `z-index: var(--civ-z-map)` |
| `plaqueRail` | `top: var(--civ-space-4)`, centred, full width, `pointer-events: none` |
| `CountryPlaque` | inside the rail, `width: max-content`, `pointer-events: auto` |
| `CountryPanel` (T06) | left dock, unchanged geometry |
| `bar` | `bottom: var(--civ-space-4)`, centred |
| `PanelHost` | right dock, `top`/`bottom: var(--civ-space-4)`, `width: 380px` |
| HUD (in `MapCanvas`) | bottom-LEFT, so it never sits under the bar |

**The rail is `pointer-events: none` and only the plaque box inside it is
`auto`.** A full-width strip with pointer events would eat every map click along the
top of the window.

**Every shell control is a SIBLING of the map host, never a descendant.** That is
the rule T06 already established for `CountryPanel`, and it is why none of this
needs `data-hud-control`: a pointer event on shell chrome never reaches the map's
handlers at all. `data-hud-control` stays reserved for a control placed INSIDE the
host, which T08 adds none of.

### 4.2 The single Escape handler

`Shell.tsx` owns one window `keydown` listener. `CountryPanel.tsx`'s own listener is
**removed** — two independent listeners on the same key means one press does two
things and neither is predictable.

```
if (event.key !== "Escape" || event.altKey || event.ctrlKey || event.metaKey) return;
if (openPanelId.peek() !== null) {
  closePanel();
  restoreFocusToBarButton(thatPanelId);
  return;
}
if (assignMode.peek()) {
  setAssignMode(false);
}
```

Escape is **not** suppressed inside a text field. A field commits on change (debounced)
and again on blur and on unmount, so there is no draft to protect and no revert
semantics to explain. After a close, if `document.activeElement` was inside the
closing panel, focus moves to that panel's bar button — the shell holds a
`Map<PanelId, HTMLButtonElement>` of refs for exactly this. Focus is never trapped
while the panel is open; Tab walks out of it normally.

### 4.3 `panel-store.ts`

```ts
type PanelId = "country" | "provinces" | "economics";

const openPanelId: ReadonlySignal<PanelId | null>;

function openPanel(id: PanelId): void;
function closePanel(): void;
function togglePanel(id: PanelId): void;   // same id -> close, other id -> switch
```

One panel at a time: the three share the right dock. Not persisted, for the same
reason `showLabels` is not — it is view state, not world state, and
`civitas.state.v1` gains no key from this task.

### 4.4 The button bar

Three real `<button type="button">`s, labelled `Country`, `Provinces`, `Economics`.
Each carries `aria-pressed={openPanelId.value === id}`, `aria-controls={PANEL_DOM_ID}`
and `data-on` for styling. `onClick` is `togglePanel(id)`.

**No button is ever disabled.** All three panels are country-scoped, so a disabled
state when nothing is selected would be defensible — but a control that greys out for
an unexplained reason is worse than a panel that says why it is empty. Each panel
renders its own empty state instead.

No digit shortcuts. The brief asks for none, and every extra global key needs the
typing-target guard `MapCanvas`'s `L` handler carries.

### 4.5 `CountryPlaque.tsx`

Reads `selectedCountry`, `selectionScope`, `selectedProvinceId`,
`provinceDisplayName` and `countryAggregates`. Calls `useSignals()`.

Rendered as a `<section aria-label="selected country">` — a plaque of parchment with
a `--civ-border-plaque` frame and `--civ-shadow-plaque`:

```
[ flag 64x43 ]  COUNTRY NAME                       (display serif, small caps,
                “slogan in italic”                   letter-spacing plaque)
                Province 412 · 37 provinces        (mono, ink-faint)
```

- The flag is `<img src={country.flagDataUrl} alt="">` inside a fixed 64x43 box
  (3:2, matching the sample flag's 735x490) with `object-fit: cover`. When
  `flagDataUrl` is `null`, or when `onError` fires on a corrupt data URL, the box
  falls back to a flat swatch of `country.colorHex` with a hairline frame.
- The name is truncated with `text-overflow: ellipsis` and carries the full string
  in `title`.
- The sub-line shows the selected province's display name, then the country's
  province count from `countryAggregates.get(id)?.provinceCount`.
- `data-scope={selectionScope.value}` drives one visual difference: at scope
  `"country"` the plaque frame takes `--civ-gild`; at `"province"` it stays
  `--civ-rule-strong`. That is the visible answer to "did my right click do
  something".

Empty states, all three of them:

| Condition | Plaque |
|---|---|
| scope `"none"` | `NO SELECTION` in ink-faint caps, plus `left-click a province · right-click for its country` |
| scope `"province"`, no owner | the province's display name, plus `unassigned — right-click to select a country, or paint it in assign mode` |
| a country selected | the full plaque above |

The plaque is **not interactive**. Nesting a button around a block that contains an
image invites a nested-interactive accessibility problem for no gain; the button bar
is one row below it.

### 4.6 `Panel.tsx`

```tsx
type PanelProps = {
  panelId: PanelId;
  title: string;
  subtitle?: string;
  children: ReactNode;
};
```

```tsx
<section className={styles.panel} id={PANEL_DOM_ID} role="region"
         aria-labelledby={headingId} data-panel={props.panelId}>
  <header className={styles.header}>
    <div className={styles.headingBlock}>
      <h2 className={styles.title} id={headingId}>{props.title}</h2>
      {props.subtitle === undefined ? null : <p className={styles.subtitle}>{props.subtitle}</p>}
    </div>
    {statePersistent.value ? null : <span className={styles.readonly}>read-only</span>}
    <button className={styles.close} type="button" aria-label={"close " + props.title}
            onClick={closePanel}>×</button>
  </header>
  <div className={styles.body}>{props.children}</div>
</section>
```

- `headingId` comes from React's `useId()`.
- `role="region"` and NOT `role="dialog"`: this is a docked panel, not a modal.
  A dialog role implies a focus trap, and the brief forbids one.
- The panel is `display: flex; flex-direction: column;` and **`.body` carries
  `min-height: 0` as well as `overflow-y: auto`.** Without `min-height: 0` a flex
  child refuses to shrink below its content and the panel grows past the dock
  instead of scrolling. This is the single most common failure in this component.
- The `read-only` chip reads `statePersistent` from `world-store`. When a
  future-version document put the store in read-only mode, `markDirty` silently
  drops every write; a field that looks like it saved and did not is the worst
  outcome, so the panel says so.
- `Panel` registers NO key listener. The shell owns Escape.

### 4.7 `PanelHost.tsx`

`useSignals()`, then a switch on `openPanelId.value` returning
`<CountryOverviewPanel />`, `<ProvincesOverviewPanel />`, `<EconomicsPanel />` or
`null`. Each panel component renders its own `<Panel>` with its own title, so a
panel owns its heading text.

### 4.8 The placeholder bodies

**`CountryOverviewPanel`** — the round-trip proof. When `selectedCountry.value` is
`null` it renders the empty state `no country selected — right-click a province on
the map, or pick one from the country list`. Otherwise, keyed on the country id:

```tsx
<ImageUpload key={"flag-" + c.id} label="Flag" value={c.flagDataUrl}
             maxEdge={FLAG_MAX_EDGE}
             onCommit={(url) => updateCountry(c.id, { flagDataUrl: url })} />
<EditableText key={"name-" + c.id} label="Name" value={c.name} maxLength={NAME_MAX}
              onCommit={(v) => updateCountry(c.id, { name: v })} />
<EditableText key={"slogan-" + c.id} label="Slogan" value={c.slogan} maxLength={SLOGAN_MAX}
              onCommit={(v) => updateCountry(c.id, { slogan: v })} />
<EditableTextArea key={"lore-" + c.id} label="Lore" value={c.lore} maxLength={LORE_MAX}
                  rows={8} onCommit={(v) => updateCountry(c.id, { lore: v })} />
<p className={styles.note}>T09 fills in the rest of this panel.</p>
```

These four fields are T09's content, and T09 will rearrange them. They are here
because "the editable-field components round-trip through the T05 store" cannot be
demonstrated otherwise.

**`ProvincesOverviewPanel`** — the selected country's provinces as a plain
`<ul>` of `provinceDisplayName(id)`, **capped at the first 50 rows** with a
`… and N more — T10 virtualises this list` footer. No editing, no images. Capping is
deliberate: a 300-row unvirtualised list is exactly the performance trap T10 exists
to solve, and shipping it here would make the shell feel slow before T10 lands.
Clicking a row calls `selectProvince(id)`.

**`EconomicsPanel`** — the country name, the turn placeholder `turn —`, and
`T11-B implements the calculator; T12 renders the sheet.` Nothing reads or writes
`economics`.

### 4.9 The assign-mode signal

Two additions, both in `Shell.tsx`, both `pointer-events: none`:

- **A banner** under the plaque while `assignMode.value` is true:
  `ASSIGN MODE · <active country name> · left drag paints · alt erases · esc exits`,
  with a small swatch of the active country's `colorHex`. When
  `activeCountryId.value` is `null` the text becomes
  `ASSIGN MODE · no country picked — the left button still pans`, which is the honest
  description of the fall-through in §2.4.
- **A rail**: an inset ring around the whole viewport,
  `box-shadow: inset 0 0 0 2px var(--civ-gild-soft)`, so the mode is visible even
  when the pointer is nowhere near the banner.

The existing cursor changes (`data-mode="assign"` -> crosshair, `data-painting` ->
cell) stay exactly as T06 left them.

---

## 5. The editable-field components

### 5.1 `use-field-commit.ts`

Shared by both text fields. No JSX, no signals — a plain hook.

```ts
const FIELD_COMMIT_MS = 200;

type FieldCommit = {
  value: string;
  onChange: (next: string) => void;
  onBlur: () => void;
};

function useFieldCommit(
  value: string,
  commit: (next: string) => void,
  delayMs?: number,
): FieldCommit;
```

Algorithm — a fixed-window trailing debounce, the same shape as
`createStateWriter` in `persistence.ts` and the colour debounce in
`CountryPanel.tsx`:

1. State `draft: string | null`, refs `timer`, `latest: string | null`,
   `commitRef: (next: string) => void`.
2. `commitRef.current = commit` is assigned on **every render**, so the unmount
   flush calls the current callback and not the one captured on first render. This
   is not optional: `onCommit` is an arrow function in the parent's JSX and its
   identity changes every render.
3. Returned `value` is `draft ?? props.value`.
4. `onChange(next)`: `setDraft(next)`, `latest.current = next`, and if `timer` is
   null start one for `delayMs ?? FIELD_COMMIT_MS`. **An edit inside an open window
   does not push the deadline out.** A restarting debounce starves: continuous
   typing would postpone the write indefinitely.
5. The timer fires: clear `timer`, read and clear `latest`, call
   `commitRef.current(value)`, `setDraft(null)`.
6. `onBlur`: clear the timer and run the same commit body immediately.
7. `useEffect(() => () => { clear timer; run the commit body; }, [])` — the last
   keystroke must not be lost when the panel closes or the selection changes.
8. After a commit, `draft` is `null` so the field falls back to `props.value`. The
   store write is synchronous, so `props.value` is already the committed text — or
   the CLAMPED text if it exceeded the cap, which then visibly snaps. That is the
   correct feedback.

**Every call site passes a `key` that includes the target id.** Switching the
selected country remounts the field and resets the draft. Without the key, a pending
draft for country 3 would be displayed over — and then committed into — country 4.
This is stated in the props doc of both components.

Why debounce at all, when `markDirty` already batches localStorage writes at 400 ms:
`updateCountry` replaces the countries array, which invalidates `countryById`,
`countryOfProvince`, `countryTintWords`, `countryAggregates` and
`countryLabelSources`, and re-runs `layoutCountryLabels` on the next frame. 200 ms
turns a burst of twenty keystrokes into two of those instead of twenty.

### 5.2 `EditableText.tsx`

```ts
type EditableTextProps = {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
};
```

A `<label>` wrapping a caption `<span>` and an `<input type="text">`. `maxLength` is
passed through, so the browser enforces the cap before `clampText` silently truncates.
No `useSignals()` — this component reads no signal, and calling it needlessly
subscribes a component to nothing.

### 5.3 `EditableTextArea.tsx`

The same props plus `rows?: number` (default 6). A `<textarea>` with
`resize: vertical`, `min-height: 6em`, `font-family: var(--civ-font-sans)` and
`line-height: var(--civ-leading-body)`. Same hook, same key rule.

### 5.4 `ImageUpload.tsx`

```ts
type ImageUploadProps = {
  label: string;
  value: string | null;
  maxEdge: number;              // FLAG_MAX_EDGE or PROVINCE_IMAGE_MAX_EDGE
  onCommit: (dataUrl: string | null) => void;
  disabled?: boolean;
};
```

Structure: a preview box, a `Choose file…` `<button type="button">`, a `Remove`
button shown only when `value !== null`, an inline status line, and a **visually
hidden** `<input type="file" accept="image/*">` driven by
`inputRef.current?.click()`. The button is a real button, so the control is
keyboard-reachable; a bare file input is not styleable and looks wrong on a
parchment panel.

Flow on change:

1. `const file = event.target.files?.[0]`. Immediately set `event.target.value = ""`
   so picking the SAME file twice fires `change` both times.
2. Reject `file.size > MAX_UPLOAD_BYTES` (20 MB) with
   `that file is too large (N MB)`. Nothing is decoded; a 200 MB TIFF must not reach
   `createImageBitmap`.
3. `requestRef.current += 1; const id = requestRef.current;` then set `busy`.
4. `await downscaleImage(file, props.maxEdge)`.
5. On resolve: if `id !== requestRef.current` return (a newer pick won); if
   `!mountedRef.current` return (the panel closed). Otherwise `onCommit(dataUrl)`,
   clear `busy`, clear the error.
6. On reject: the same two guards, then show `error.message` —
   `the file is not a readable image` or `the image has no pixels`, both thrown by
   `downscaleImage`. **The previous value is kept.** An unreadable pick must not
   destroy the flag that was already there.

`Remove` calls `onCommit(null)`. `setProvinceImage` and `updateCountry` both accept
`null` and both treat `""` the same way.

The preview is `<img src={props.value} alt={props.label}>` with
`max-width: 100%`, `object-fit: contain` and an `onError` that swaps in the
`no image` placeholder — a stored data URL can be corrupt, and a broken-image glyph
in a parchment panel looks like a bug in the app.

`downscaleImage` is the ONLY path an image takes into the store; the component never
calls `toDataURL`, `FileReader` or `URL.createObjectURL` itself. That is what keeps
the ~256 KB bound and the WebP-with-JPEG-fallback behaviour in one place.

---

## 6. Integration points, by name

| What T08 calls | From | Why |
|---|---|---|
| `mapPixelAt(sx, sy)` | `state/view-store` | screen -> integer map pixel for both clicks |
| `provinceAt(x, y)` | `state/map-store` | map pixel -> province id, `null` on sea |
| `provinceById(id)` | `state/map-store` | `selectedProvince` computed |
| `provinceDisplayName(id)` | `state/world-store` | plaque sub-line, province list |
| `countryById` | `state/world-store` | `selectedCountryId` validity, `selectedCountry` |
| `countryOfProvince` | `state/world-store` | `nextSelection`'s owner map, live province-scope country |
| `updateCountry(id, patch)` | `state/world-store` | every field commit in the country panel |
| `statePersistent` | `state/world-store` | the panel's read-only chip |
| `countryAggregates` | `state/country-store` | plaque province count |
| `buildTintWordTable`, `countryTintWords` | `state/country-store` | selected-country emphasis |
| `TINT_ALPHA`, `SELECTED_TINT_ALPHA` | `ui/tint-layer` | the two alphas |
| `assignMode`, `activeCountryId`, `setAssignMode` | `state/assign-store` | mode banner, rail, Escape |
| `setActiveCountry` | `state/assign-store` | `CountryPanel` row click, unchanged |
| `downscaleImage`, `FLAG_MAX_EDGE`, `PROVINCE_IMAGE_MAX_EDGE` | `state/image` | `ImageUpload` |
| `NAME_MAX`, `SLOGAN_MAX`, `LORE_MAX` | `state/schema` | `maxLength` on the fields |

Not called, deliberately: `drawOverlay`'s optional fields gain no member;
`syncTintLayer` is not called from T08 code (MapCanvas's existing effect already
does it); `borders-store` is untouched.

---

## 7. Reactivity checklist

`useSignals()` from `@preact/signals-react/runtime` is required in, and only in,
components that read a signal:

- `Shell` (reads `assignMode`, `activeCountryId`, `openPanelId`) — yes
- `CountryPlaque` — yes
- `PanelHost` — yes
- `Panel` (reads `statePersistent`) — yes
- `CountryOverviewPanel`, `ProvincesOverviewPanel`, `EconomicsPanel` — yes
- `EditableText`, `EditableTextArea`, `ImageUpload`, `useFieldCommit` — **no**.
  They take plain props and read nothing.

No action may be called from inside a `useSignalEffect`. Every selection and panel
action in this task is called from a DOM handler or a plain `useEffect`.

---

## 8. Edge cases and failure modes

1. **Right press during a left pan or a paint stroke** — `contextmenu` fires while
   the pointer is captured. The handler returns when the gesture is not idle, so the
   menu is still suppressed and nothing is selected.
2. **macOS ctrl+click** fires `pointerdown` with button 0 and `ctrlKey` true, then
   `contextmenu`. `isContextPress` declines the `pointerdown`, so no pan and no
   paint stroke starts, and `onContextMenu` finds an idle gesture and selects the
   country. In assign mode it selects and does NOT paint, which is the §2.4 rule
   that the right button is never a paint gesture. On a platform that fires no
   `contextmenu` for a ctrl+click, `onPointerUp` runs the same selection instead.
3. **`preventDefault` on a right `pointerdown`** can suppress the compatibility
   mouse events and, on some engines, `contextmenu` with them. `onPointerDown`
   returns for button 2 BEFORE its `preventDefault()`. Verify in the browser: right
   click must never show the OS menu and must always select.
4. **Right-drag** — no gesture starts, so the map does not move. The menu is
   suppressed on release. Nothing else happens.
5. **The selected country is deleted** — `selectedCountryId` is a computed validated
   against `countryById`, so it returns `null` on the same tick. `selectionScope`
   downgrades to `"province"` and the plaque switches to the unassigned state. The
   open panel STAYS open and shows its own empty state; closing a panel out from
   under the user is worse than an empty one.
6. **The selected province is repainted into another country** during a paint drag —
   a province-scoped selection derives its country live, so the plaque follows. A
   country-scoped selection keeps the country the user chose, which is correct: they
   selected that country, not that province's current owner.
7. **Clicking the same province twice** — `sameSelection` guards the write, so no
   repaint, no tint diff, no label relayout.
8. **A click that follows a drag** — unchanged from T03: the `moved` flag on the pan
   gesture already declines it past the 3 px threshold.
9. **A pointer cancel** — `onPointerCancel` never selects, unchanged from T04.
10. **A field edit while the store is read-only** (`future`-version document) —
    `markDirty` drops the write. The panel shows the `read-only` chip and the
    existing warning banner explains why. The in-memory value still updates, so the
    UI is not frozen.
11. **An upload that pushes the document past `STORAGE_BUDGET_BYTES`** — `writeNow`
    raises the `budget` warning through the existing banner. T08 adds no eviction and
    no retry; T05 decided that deliberately.
12. **Two uploads in flight** — the request-counter guard drops the stale resolve.
13. **An upload that resolves after the panel closed** — the mounted guard drops it.
14. **A corrupt stored data URL** — `onError` on the `<img>` falls back to the
    placeholder in both the plaque and `ImageUpload`.
15. **A 200-character country name pasted into the field** — `maxLength` stops it at
    the input, `clampText` stops it at the store, and the field snaps to the clamped
    value on commit.
16. **Escape with a panel open AND assign mode on** — the panel closes; a second
    press leaves assign mode. Documented order, one listener.
17. **Escape typed inside a field** — the panel closes and the field's unmount commit
    writes the pending draft. Nothing is lost.
18. **A long country name in the plaque** — one line, ellipsis, full text in `title`.
19. **Nothing selected and a panel opened** — each panel renders its own empty state
    naming the action that fills it.
20. **A country with zero provinces** — `countryAggregates.get(id)` exists with
    `provinceCount: 0` and `centroid: null`. The plaque prints `0 provinces`; nothing
    dereferences the null centroid.
21. **Province ids are 1..1650 for 1648 provinces** (1318 and 1458 are missing).
    `provinceDisplayName` falls back to `"Province N"` and the province list skips an
    id the manifest lacks rather than throwing.
22. **The shell renders before the map loads** — `provinceById` returns `null`,
    `countryAggregates` is empty, `selectedProvince` is `null`. Every readout has a
    `—` fallback. The panels are usable on a hydrated document while the PNG is still
    decoding.

---

## 9. The one-line change in `world-store.ts`

`updateCountry` currently builds `{ ...current, provinceIds: [...current.provinceIds] }`.
The copy is defensive and nothing mutates `provinceIds` in place — `assignProvinces`
always builds a fresh array. But `label-store.ts` validates its anchor cache on
`country.provinceIds` ARRAY IDENTITY, and its header comment states that "a rename
costs nothing" precisely because that identity is stable. The copy breaks that: today
every rename invalidates the anchor cache and re-runs `resolveLabelAnchor`, which is
up to 1728 `contains` probes.

T08 makes renaming a per-keystroke operation, so the change moves from cosmetic to
load-bearing:

```ts
const next: Country = { ...current };
```

Add one test in `src/state/world-store.test.ts` pinning it:
`updateCountry(id, { name })` leaves `provinceIds` strictly equal to the array it
had before. No existing test asserts the copy — this was checked.

---

## 10. Tests

Node's built-in runner through `tsx`. Pure logic only; there is no jsdom, so no
component renders in a test.

`src/state/selection-store.test.ts`
- `nextSelection` covering every row of the §2.2 table, including the two named
  rules (unassigned right click degrades to `"province"`; a `country` intent drops a
  province that is not inside it).
- `sameSelection` is true for equal triples and false on each field.
- Through the store, using `initWorldStore({ storage: fakeStorage() })` as the reset,
  then `addCountry` / `assignProvinces`:
  - `selectProvince(id)` on an assigned province leaves `selectedCountryId` at the
    owner and `selectionScope` at `"province"`.
  - `selectCountryOfProvince(id)` gives scope `"country"`.
  - `deleteCountry(owner)` makes `selectedCountryId` null and downgrades the scope.
  - `assignProvinces(other, [id])` while that province is province-selected moves
    `selectedCountryId` to `other`.
  - `selectProvince(null)` clears all three.

`src/state/panel-store.test.ts`
- open, close, `togglePanel` on the same id closes, on a different id switches.

`src/state/country-store.test.ts` (extended)
- `buildTintWordTable(list, max, 1, SELECTED_TINT_ALPHA)` gives country 1 the
  emphasis alpha and every other country `TINT_ALPHA`.
- `buildTintWordTable(list, max)` with no emphasis argument is byte-identical to the
  pre-T08 output, which is what keeps the seven existing call sites honest.

`src/state/world-store.test.ts` (extended)
- the `provinceIds` identity assertion from §9.

Not tested, and stated in `memory.md`: every `.tsx` file in this task. There is no
jsdom in the repo and faking one to assert on a rendered plaque tests the fake. The
logic worth testing was pushed out of the components into `nextSelection`,
`panel-store` and `buildTintWordTable` for exactly that reason.

---

## 11. Verification

Shell commands, run from
`javascript/packages/prototypes/civitas/civitas-interactive-map`:

```bash
yarn typecheck      # tsc --noEmit; prints nothing on success
yarn test           # every *.test.ts, including the three new/extended files
yarn build          # must emit a bundle; two asset size warnings are expected
yarn dev            # then open the printed URL
```

Manual checklist in the browser, in order. Every item is pass/fail with no
interpretation:

1. Left-click a land province. The province fills with the gold select tint and the
   HUD `selected` readout shows its id.
2. Left-click the sea. The fill disappears and the plaque reads `NO SELECTION`.
3. Create a country in the left panel, turn assign mode on, paint five provinces.
4. Left-click one of those five with assign mode still on. It PAINTS — the selection
   does not change. This is §2.4 row 2.
5. Turn assign mode off. Left-click one of the five. The plaque shows the country's
   name and the sub-line shows the province name and `5 provinces`.
6. Right-click a province of that country. No OS menu appears. The plaque frame turns
   gold and the country's tint visibly deepens.
6a. Ctrl+click that same province with assign mode OFF. No OS menu, and the scope
    becomes `country` — a ctrl+click is a right click, not a left one.
6b. Ctrl+click a province of that country with assign mode ON and the country
    active. No OS menu, the scope becomes `country`, and the province is NOT
    painted: the country's province count does not move.
7. Right-click a province with no country. No menu, plaque shows the unassigned state.
8. Right-drag across the map. No menu on release, the map does not move.
8a. Hold the left button down over the map, then press the right button without
    releasing. No menu, and the selection does not change.
9. Middle-drag. The map pans in both modes.
10. Open each of the three panel buttons in turn. Each opens the right panel, and
    clicking the same button again closes it.
11. With a panel open, press Escape. It closes. Press Escape again with assign mode
    on: the mode turns off.
12. In the Country panel, type into Name. The map label and the left country list
    both follow within a beat. Reload the page — the name is still there. Same for
    Slogan and Lore.
13. Upload `assets/country-flag.jpg` as the flag. A preview appears within a second,
    the plaque shows it, and it survives a reload.
14. Pick a non-image file (`package.json`). The inline error appears and the previous
    flag is still shown.
15. Press Remove. The flag clears and the plaque falls back to the colour swatch.
16. Turn assign mode on with a country picked. The rail rings the viewport and the
    banner names the country. Turn it off — both disappear.
17. Zoom to 8x and check that the HUD still reports province 1000 at map pixel
    (1382, 1329). The shell must not have disturbed the transform.
18. Resize the window narrow. The right panel and the plaque stay inside the
    viewport and the panel body scrolls rather than overflowing.

---

## 12. Explicitly NOT part of T08

- **Real panel content.** T09 fills the country overview, T10 the provinces overview
  with a virtualised list, T11-B/T12 the economics engine and sheet. The three bodies
  shipped here are placeholders and say so on screen.
- **List virtualisation.** The provinces placeholder caps at 50 rows instead.
- **Province name / lore / image editing UI.** The components exist and are exercised
  by the country panel; wiring them to `setProvinceName`, `setProvinceLore` and
  `setProvinceImage` is T10's row.
- **Any change to `civitas.state.v1`.** No new key, no new field, no migration. The
  open panel, the selection and the assign mode are all session state.
- **Any change to `src/ui/render.ts` or `OverlayInput`.** The country emphasis goes
  through the existing tint word table.
- **Multi-select, marquee select, keyboard map navigation, selection history.**
- **Country creation or deletion from the plaque or the panels.** `CountryPanel`
  keeps that, unchanged.
- **Touch and mobile.** Desktop prototype, as T06 recorded.
- **A second `localStorage` tab-sync path.** T05 decided against it.
- **Retuning the canvas label colours or font.** `label-layer.ts` is not touched.
