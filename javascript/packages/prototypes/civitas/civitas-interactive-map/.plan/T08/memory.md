# T08 — think agent handoff

Design: `.plan/T08/DESIGN.md`. The transition table in §2.2 and the field-commit
algorithm in §5.1 are written to be implemented literally.

## Decided, with reasons

- **Selection is three slots in ONE signal**: province id, country id, scope
  (`none` / `province` / `country`). One write, no `batch`, and a pure
  `nextSelection(current, intent, ownerOf)` holds the whole rule — the same split
  `strokeActionFor` uses in `assign-store.ts`, so it is testable in Node.
- **`selectedCountryId` is a computed, never stored.** At scope `"country"` it is
  the stored id validated against `countryById`; otherwise it reads
  `countryOfProvince` LIVE. That kills two bugs at once: a deleted country cannot
  linger in the selection, and a province repainted into another country updates
  the plaque while the drag is still running.
- **Right-clicking an unassigned province does not clear it.** There is no country
  to select, so the intent degrades to a province selection. Two thirds of the map
  belongs to nobody; clearing there makes right-click feel broken.
- **Select on `contextmenu`, not on `pointerdown` button 2.** It is the one event
  that means "context action" on every platform including macOS ctrl+click, and it
  is the handler that must `preventDefault` anyway.
- **`onPointerDown` returns for button 2 BEFORE its `preventDefault()`.**
  Preventing a pointerdown default suppresses the compatibility mouse events, and an
  engine that derives `contextmenu` from `mousedown` would then never fire it. This
  is the one browser behaviour in the task I could not verify from the code, so it
  is item 3 of the manual checklist.
- **The selected country is emphasised by raising its TINT alpha (0.32 -> 0.48),
  not by a new draw call.** `diffTintWords` already repaints only the ids whose word
  changed, so a selection change repaints the old and new country's boxes once, on
  the click. `render.ts` and `OverlayInput` are untouched, so `render.test.ts`'s
  byte-identical assertion still holds.
- **The paint tool owns the left button only when it can actually paint.** With
  assign mode on and no active country, the existing fall-through to a pan makes the
  click a selection. Right click selects in both modes and is never a paint gesture.
- **ONE window Escape listener, in `Shell.tsx`.** It closes the open panel first and
  leaves assign mode second. `CountryPanel`'s own listener is deleted — two
  listeners on the same key means one press does two things.
- **Panels are `role="region"`, not `role="dialog"`.** A dialog role implies a focus
  trap and the brief forbids one.
- **Fields buffer locally and commit on a 200 ms fixed window, plus blur, plus
  unmount.** Not for localStorage — `markDirty` already debounces at 400 ms — but
  because `updateCountry` invalidates five computeds and re-runs the label layout.
  Fixed window, not restarting: a restarting one starves under continuous typing.
- **Every field call site passes a `key` containing the target id.** Otherwise a
  pending draft for country 3 gets committed into country 4 when the selection moves.
- **`theme.css` re-points T01's legacy aliases (`--bg`, `--text`, …) onto the new
  `--civ-*` tokens.** One file moves the whole palette instead of rewriting four CSS
  files. New CSS uses `--civ-*` only.

## Surprising things found in the existing code

- **`updateCountry` copies `provinceIds`**, but `label-store.ts` validates its anchor
  cache on that array's IDENTITY and its header claims "a rename costs nothing".
  Today every rename re-runs `resolveLabelAnchor` (up to 1728 probes). §9 makes it a
  one-line fix plus a pinning test. No existing test asserts the copy — checked.
- **`--bg-sunken` cannot map to the sea colour.** `index.css` styles
  `input[type="text"]` with it and `color: var(--text)`. Point it at parchment-dim
  and give `.host` an explicit `background: var(--civ-sea)`.
- `color-scheme` has to be `dark` at the root and `light` on the parchment panels,
  or the panel scrollbar and the colour/file inputs render dark on light.
- `LABEL_FONT_STACK` in `label-layer.ts` duplicates `--font`. `--civ-font-display`
  is DOM-chrome only; do not point `--font` at a serif or the canvas labels diverge.
- Shell chrome is a SIBLING of the map host, so it needs no `data-hud-control`. That
  attribute stays reserved for a control placed inside the host.
- The plaque rail spans the window, so it must be `pointer-events: none` with only
  the plaque box set to `auto`, or it eats every map click along the top edge.

## Not done here

Real panel bodies (T09/T10/T12), virtualisation, province field wiring, any schema
or `localStorage` change, multi-select, touch. No `.tsx` in this task is unit tested
— there is no jsdom, and the logic worth testing was pushed into `nextSelection`,
`panel-store.ts` and `buildTintWordTable`.

---

## Implementation (attempt 1)

Design followed literally. §2.2's transition table, §5.1's commit algorithm and
§3's token block are implemented as written. `src/ui/render.ts`, `OverlayInput`,
`src/map/*`, `borders-store.ts`, `label-store.ts` and `assign-store.ts` were not
touched, so `render.test.ts`'s byte-identical assertions still hold unchanged.

### Files created

| Path | What it is |
|---|---|
| `src/ui/theme.css` | The `--civ-*` token block plus the re-point of T01's legacy aliases. Global CSS. |
| `src/state/panel-store.ts` | `openPanelId`, `PANEL_DOM_ID`, `openPanel` / `closePanel` / `togglePanel`. |
| `src/state/panel-store.test.ts` | Open, close, toggle-same-closes, toggle-other-switches. |
| `src/state/selection-store.test.ts` | The whole §2.2 table, `sameSelection`, and eight through-the-store cases. |
| `src/ui/Shell.tsx` | The layout frame. Owns the ONE window Escape handler and the bar-button ref map. |
| `src/ui/shell.module.css` | Shell layout, plaque rail, button bar, assign banner and rail, panel dock. |
| `src/ui/CountryPlaque.tsx` | Flag / name / slogan / sub-line, three empty states, `data-scope` frame. |
| `src/ui/country-plaque.module.css` | Plaque styles. |
| `src/ui/Panel.tsx` | Panel chrome: heading, close, scrollable body, read-only chip. `role="region"`. |
| `src/ui/panel.module.css` | Panel chrome styles. |
| `src/ui/PanelHost.tsx` | Switches on `openPanelId`. |
| `src/ui/CountryOverviewPanel.tsx` | Placeholder body. The four fields that prove the store round-trip. |
| `src/ui/ProvincesOverviewPanel.tsx` | Placeholder body. First 50 province rows, each row selects. |
| `src/ui/EconomicsPanel.tsx` | Placeholder body. Country name and `turn —`. |
| `src/ui/panel-bodies.module.css` | Shared styles for the three placeholder bodies. |
| `src/ui/use-field-commit.ts` | The fixed-window buffered-commit hook, 200 ms, plus blur and unmount. |
| `src/ui/EditableText.tsx` | Single-line controlled field. |
| `src/ui/EditableTextArea.tsx` | Multiline controlled field. |
| `src/ui/ImageUpload.tsx` | File picker -> `downscaleImage` -> data URL, preview, remove, inline error. |
| `src/ui/fields.module.css` | Shared field styles. |

### Files changed

| Path | Change |
|---|---|
| `src/state/selection-store.ts` | Rewritten. One `SelectionState` signal, pure `nextSelection` / `sameSelection`, six read-only computeds, five actions. |
| `src/state/country-store.ts` | `buildTintWordTable` gained two optional emphasis parameters; `countryTintWords` reads `selectedCountryId`. |
| `src/state/country-store.test.ts` | Two tests: the emphasis alpha, and no-emphasis being byte-identical to the pre-T08 table. |
| `src/state/world-store.ts` | `updateCountry` no longer copies `provinceIds` (§9). |
| `src/state/world-store.test.ts` | One test pinning that a rename keeps the same `provinceIds` array. |
| `src/ui/tint-layer.ts` | Added `SELECTED_TINT_ALPHA = 0.48` and exported it. |
| `src/ui/MapCanvas.tsx` | `onPointerDown` returns for button 2 BEFORE its `preventDefault`; `onContextMenu` selects the country; `onPointerUp` calls `selectProvince`; HUD gained a `scope` readout. |
| `src/ui/map-canvas.module.css` | `.host` takes an explicit `background: var(--civ-sea)`; the HUD moved onto the tokens and is capped so it never slides under the button bar. |
| `src/ui/CountryPanel.tsx` | Its own Escape listener removed; a row click also calls `selectCountry`; rows carry `data-selected`. |
| `src/ui/country-panel.module.css` | Converted to `--civ-*`, plus `color-scheme: light` and the `data-selected` mark. |
| `src/App.tsx` | Renders `<Shell />`. Lifecycle, warning banner and load status unchanged. |
| `src/app.module.css` | Warning and status restyled onto the tokens. The warning is top-centre, above the plaque. |
| `src/main.tsx` | Imports `./ui/theme.css` after `./index.css`. |

### One deviation from the design

The HUD's `max-width` is `calc(50% - 190px)`, not the `calc(100% - space-7)` a
naive read gives. Verified in the browser: at 1531 px the unconstrained HUD ran
straight under the centred button bar. It now wraps to two lines and stops short
of it.

### Verification

```
$ yarn typecheck
(no output, exit 0)

$ yarn test
ℹ tests 463
ℹ suites 0
ℹ pass 463
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 833.469875

$ npx tsx --test src/state/selection-store.test.ts src/state/panel-store.test.ts
✔ no panel is open until one is asked for (0.352875ms)
✔ openPanel opens, closePanel closes, and both are idempotent (0.093125ms)
✔ openPanel on a second id switches: one panel at a time (0.391042ms)
✔ togglePanel closes the same id and switches to a different one (0.052667ms)
✔ a province intent selects the province and drops the stored country (0.554333ms)
✔ a province intent with a null id is the sea and clears everything (0.046041ms)
✔ right-clicking an owned province selects its country (0.037584ms)
✔ right-clicking an UNASSIGNED province degrades to a province selection (0.031541ms)
✔ right-clicking the sea clears everything (0.050875ms)
✔ a country intent keeps the province only when it is INSIDE that country (0.056667ms)
✔ a null country intent keeps the province and downgrades the scope (0.050375ms)
✔ a clear intent empties all three slots (0.037584ms)
✔ sameSelection compares all three fields (0.054417ms)
✔ selecting an assigned province reports its owner but keeps scope province (0.486333ms)
✔ right-clicking a province of a country gives scope country (0.120542ms)
✔ deleting the selected country nulls the id and downgrades the scope (0.089833ms)
✔ repainting a province-selected province moves the reported country live (0.070584ms)
✔ a country-scoped selection keeps the country the user chose (0.06025ms)
✔ selectCountry from a list row drops a province of another country (0.0705ms)
✔ selecting the sea clears all three signals (0.065375ms)
ℹ tests 20
ℹ pass 20
ℹ fail 0

$ yarn build
WARNING in ⚠ asset size limit: The following asset(s) exceed the recommended size limit (300.000 KiB). This can impact web performance.
  │ Assets:
  │   assets/map.png (2.530 MiB)
  │   assets/provinces_map.png (552.626 KiB)
  │   assets/provinces_manifest.json (586.891 KiB)

Rspack compiled with 1 warning in 81 ms
```

The 463 total is up from 440 before T08. Every pre-existing test still passes.
The asset-size warning is the expected one T02 recorded and is not silenced.

### Browser check (Chrome, dev server, 1531 x 803)

Run against the §11 checklist. What was exercised and observed:

1. Left click on land selected province 575. Gold select fill on the map, HUD
   `selected 575`, HUD `scope province`, plaque read `PROVINCE 575 / unassigned —
   right-click to select a country, or paint it in assign mode`.
2. `+ new` created Country 1, `assign: off` -> `on`, a left drag painted 7
   provinces. The assign banner named the country and carried its swatch; the
   gild rail ringed the viewport.
3. With assign mode still ON, the drag PAINTED and `selected` stayed at 575 —
   §2.4 row 2 holds. The plaque switched to `COUNTRY 1` on its own, because 575
   had been painted into it and a province-scoped selection derives its owner
   live.
4. Right click on a province of that country: NO OS menu, HUD `scope country`,
   plaque frame turned gild, the country's tint visibly deepened.
5. All three bar buttons opened their panel; `aria-pressed` was true on exactly
   one at a time.
6. Typing `Alnwick Union` into the country panel's Name propagated within a beat
   to the plaque, the map label, the left country list and the assign banner, and
   `localStorage["civitas.state.v1"].countries[0].name` read back `Alnwick Union`.
   After a reload the country, its 7 provinces and its tint were all still there.
7. Escape with the panel open closed it and moved focus to the `Country` bar
   button (`document.activeElement` was `BUTTON:Country`). A second Escape turned
   assign mode off. Documented order, one listener.
8. Clicking empty sea cleared all three selection signals. The open panel stayed
   open and showed its own empty state.
9. `read_console_messages` with `onlyErrors` reported nothing for the session.

Not exercised in the browser, because file-dialog automation is out of reach:
the flag upload path (checklist items 13-15). The code path is
`ImageUpload` -> `downscaleImage`, which T05 verified in Chrome against
`assets/country-flag.jpg` (735 x 490, 98 KB -> 256 x 171 WebP, 13 KB).

### Left undone, deliberately

- **No `.tsx` is unit tested.** There is no jsdom in the repo and faking one to
  assert on a rendered plaque tests the fake. The logic worth testing was pushed
  into `nextSelection`, `panel-store.ts` and `buildTintWordTable`.
- Real panel content (T09 / T10 / T12), list virtualisation, and the province
  name / lore / image wiring. The field components exist and are exercised by the
  country panel; T10 puts them on a province row.
- No change to `civitas.state.v1`: no new key, no new field, no migration. The
  selection, the open panel and assign mode are all session state.
- Touch. A one-finger drag paints and pan is unreachable on touch in assign mode,
  unchanged from T06. Desktop prototype.
- `README.md` is NOT updated. The docs agent owns that.

---

## Implementation (attempt 2)

Attempt 1 was rejected for one blocking defect: macOS ctrl+click never reached the
country selection (`review-1.md` §BLOCKING 1). Fixed at the source, not repaired
downstream. Nothing else in the task was reworked.

### Why the reviewer's own sketch was not enough

The suggested fix cancelled the accidental gesture from inside `onContextMenu`.
That satisfies three of the four requirements but not "ctrl+click in assign mode
does not paint": `beginStroke` calls `applyStroke([provinceId])` on the pressed
province immediately (`src/state/assign-store.ts:112-115`), so by the time
`contextmenu` fires the province is already assigned and `cancelStroke` does not
take it back — it only skips the border flush. The press has to be declined in
`onPointerDown`, before a stroke ever starts.

### The fix

A ctrl+left press is now a CONTEXT PRESS everywhere, exactly like button 2:

```ts
function isContextPress(event: { button: number; ctrlKey: boolean }): boolean {
  return event.button === 2 || (event.button === 0 && event.ctrlKey);
}
```

- `onPointerDown` declines it (still BEFORE `preventDefault`, so the compatibility
  `mousedown` and the `contextmenu` derived from it still fire). No pan, no paint.
- `onContextMenu` therefore finds an IDLE gesture for a ctrl+click and selects the
  country. Its `kind !== "idle"` guard now only turns away what it was written for:
  a genuine right press made during a left pan or a paint stroke.
- `onPointerUp` gained a `button === 0 && ctrlKey && gesture.kind === "idle"` branch.
  Windows and Linux fire no `contextmenu` for a ctrl+click, so without it the press
  would be dead there. On macOS both handlers run and the second call is the
  identical intent on the identical pixel, which `sameSelection` swallows. One rule
  on every platform, no `navigator` sniffing.
- The three screen-to-province conversions collapsed into one local
  `provinceAtClient(host, clientX, clientY)`.

### Files changed (attempt 2)

| Path | Change |
|---|---|
| `src/ui/MapCanvas.tsx` | `isContextPress`; `onPointerDown` declines a ctrl+left press; `onPointerUp` gained the ctrl+click branch; `provinceAtClient` helper; the comments at the three sites now describe what the code does. |
| `src/ui/Shell.tsx` | `aria-controls` is set only on the button whose panel is open. `review-1.md` non-blocking item 2. |
| `.plan/T08/DESIGN.md` | §2.4 gains the ctrl+click rule, §2.5 is rewritten, §8 item 2 now describes actual behaviour, §11 gains checklist items 6a, 6b and 8a. |

Not changed: the two remaining non-blocking items (plaque/panel-dock overlap
between ~900 and 1200 px, `.hud`'s `max-width` below ~760 px). Both are layout
work the reviewer assigned to T09, and both are cosmetic.

### Verification

```
$ yarn typecheck
typecheck exit=0
(no output)

$ yarn test
ℹ tests 463
ℹ suites 0
ℹ pass 463
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 787.8375

$ yarn build
WARNING in ⚠ asset size limit: The following asset(s) exceed the recommended size limit (300.000 KiB). This can impact web performance.
  │ Assets:
  │   assets/map.png (2.530 MiB)
  │   assets/provinces_map.png (552.626 KiB)
  │   assets/provinces_manifest.json (586.891 KiB)

Rspack compiled with 1 warning in 83 ms
```

463 tests, unchanged from attempt 1: the fix is in a `.tsx` file and nothing in the
suite covers one. The asset-size warning is the expected one from T02.

### Browser check (Chrome, dev server, 1531 x 803) — the case that was missed

Every ctrl+click and right click below is a REAL native click through the browser
tool, not a dispatched event. A `contextmenu` probe on `window` recorded
`button`, `ctrlKey` and `defaultPrevented` for each one. Setup: `+ new` created
Country 1, assign mode on, a left drag painted 10 provinces (`10 prov · 19,791 px`).

1. **Ctrl+click a province OF Country 1, assign mode ON.** HUD went
   `selected 637 · scope country`, plaque `COUNTRY 1 / Province 637 · 10 provinces`.
   Country 1 stayed at `10 prov · 19,791 px` — a paint stroke would have ERASED that
   province, because clicking a province already in the active country erases it.
   Probe: `{button: 0, ctrlKey: true, defaultPrevented: true}`.
2. **Ctrl+click an UNOWNED province, assign mode ON.** `selected 582 · scope
   province`, plaque `Province 582 / unassigned — …` (§2.2: a right click with no
   owner degrades to a province selection). Country 1 still `10 prov`, so the press
   assigned nothing. Probe: `{button: 0, ctrlKey: true, defaultPrevented: true}`.
3. **Ctrl+click a province of Country 1, assign mode OFF**, from a starting state of
   `selected 252 · scope province`. Went to `selected 379 · scope country`, plaque
   `Country 1 / Province 379 · 10 provinces`. Probe:
   `{button: 0, ctrlKey: true, defaultPrevented: true}`.
4. **Genuine right click, assign mode OFF**, from `selected 252 · scope province`:
   `selected 379 · scope country`. Probe:
   `{button: 2, ctrlKey: false, defaultPrevented: true}`. Unaffected by the change.
5. **`localStorage["civitas.state.v1"].countries` read back `[{id: 1, n: 10}]`** after
   all four — no ctrl+click ever wrote to the world store.
6. **Left click still selects** (`selected 252`, `scope province`) and **a left click
   on the sea with assign mode off clears** (`selected — · scope none`, plaque
   `no selection`). With assign mode ON the same sea click changes nothing, which is
   §2.4 row 2: the paint tool owns the left button.
7. **`aria-controls`**: the open button carries `civ-panel`, which resolves to a live
   `SECTION[role=region]`; the two closed buttons carry none.
8. `read_console_messages` with `onlyErrors` reported nothing.

**Right press DURING a left pan** (checklist 8a) could not be driven natively — the
browser tool has no "press and hold". It was exercised with a dispatched sequence
instead, and this is the one item below that is synthetic: `pointerdown` (button 0)
on the map host to open the pan, then `contextmenu` (button 2) over a province of
Country 1. `Element.prototype.setPointerCapture` was stubbed for the dispatch,
because it rejects a `pointerId` that names no live pointer. Result: the selection
stayed at `selected 252 · scope province` — the right press selected nothing — and
the probe reported `defaultPrevented: true`, so the menu was still suppressed.

### Left undone, deliberately

- The two non-blocking layout items from `review-1.md`, left to T09 as the reviewer
  assigned them.
- Still no `.tsx` unit test: there is no jsdom in the repo. The ctrl+click rule lives
  in `isContextPress`, which is a pure two-line predicate exercised by the browser
  run above; extracting and testing it in isolation would assert the operator table
  of `||` and not the behaviour that broke.
- `README.md` is NOT updated. The docs agent owns that.

---

## Tests

30 tests added on top of the 463 the implementation agent left. **493 total, 493
pass, 0 fail.** No existing assertion was weakened, deleted or reworded, and no
source file was changed — every test here passes against the code as the
implementation agent shipped it.

### What is covered

`src/state/selection-store.test.ts` (+11, 25 total)

- The one row of the §2.2 table nobody had covered: a `country` intent with
  nothing selected takes the country alone.
- The §8.7 guard, stated as a property: re-picking what is already picked
  produces a state `sameSelection` calls equal, for a province intent, a
  `countryOfProvince` intent and a `clear`.
- A `country` intent for a country the current province is NOT in switches the
  country and drops the province.
- Selecting a country that no longer exists reports `selectedCountryId` null,
  `selectedCountry` null and scope `"none"` — the §2.3 downgrade, reached from
  the list-row path rather than from a delete.
- An unassigned province selection reports no country (the plaque's second
  empty state).
- `selectedCountry` carries the record and follows a rename through
  `updateCountry`.
- Deleting a DIFFERENT country leaves the selection alone.
- `assignProvinces(null, [id])` — the erase stroke — drops the derived country
  of a province-scoped selection while keeping the province.
- `clearSelection` from a country scope.
- §8.21 / §8.22 together: `selectedProvince` is null with no manifest,
  `provinceDisplayName(1318)` falls back to `"Province 1318"` (1318 is one of
  the two ids the manifest lacks) and 1650 is pinned as the highest id, not
  1648.
- Hover is independent of selection and an unchanged `setHoveredProvince` write
  changes nothing.

`src/state/panel-store.test.ts` (+5, 9 total)

- `togglePanel` from a closed dock opens.
- All three `PanelId`s are reachable and the list is exactly three long.
- `PANEL_DOM_ID` is pinned to `"civ-panel"` — the `aria-controls` target.
- **The open panel never reaches `civitas.state.v1`.** Opens a panel, adds a
  country, flushes, and asserts the persisted document's top-level keys are
  exactly `countries`, `economics`, `nextCountryId`, `provinceOverrides`,
  `version`. This is the §12 "T08 adds no key, no field, no migration" claim
  turned into a test.

`src/state/country-store.test.ts` (+3, emphasis edge cases)

- An `emphasisCountryId` that names no country produces a table identical to
  the no-emphasis one.
- Leaving `emphasisAlpha` off defaults to `SELECTED_TINT_ALPHA`.
- Emphasis changes ONLY the alpha byte: r, g and b are bit-identical and the
  alpha strictly rises. A country must not appear to change identity when it is
  selected.

`src/state/world-store.test.ts` (+2)

- The §9 `provinceIds` identity holds on EVERY branch of `updateCountry`, not
  only the rename branch the existing test takes: slogan, lore, flag and colour
  each keep the same array.
- A patch that changes nothing does not replace the countries array — a
  same-value name and a patch that fails validation both return without a
  write. The 200 ms field debounce assumes this; without it every commit of an
  untouched field would invalidate five computeds and re-run the label layout.

`src/ui/use-field-commit.test.ts` (NEW, 10 tests)

The §5.1 algorithm, all eight numbered rules. No DOM, no component, no jsdom:
the file drives the hook on a hand-written React dispatcher (`useState`,
`useRef`, `useEffect`) and a fake global `setTimeout`, so every assertion is
deterministic and nothing renders.

- The field shows the store value until it is typed into; the draft then wins.
- **The window is FIXED, not restarting.** Three keystrokes at t=0, 150 and 190
  produce ONE commit at t=200 carrying the latest text. Mutation-checked: making
  the debounce restart turns this test red and leaves the other nine green.
- A commit clears the draft, so a value the store CLAMPED visibly snaps back.
- Blur commits immediately and disarms the pending timer, and does not commit
  twice.
- Blur with nothing pending commits nothing.
- Unmount flushes the last keystroke and cancels the timer.
- The unmount flush calls the CURRENT `onCommit`, not the one captured on the
  first render — the stale-closure bug that would write into the previously
  selected country.
- Unmount with nothing pending commits nothing.
- `FIELD_COMMIT_MS` is 200 and is the default window (asserted at the boundary:
  nothing at 199 ms, committed at 200 ms).
- A changed `delayMs` prop is picked up by the next window.

How fragile this file is, stated plainly: it reads React's internal dispatcher
slot `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H`.
`reactInternals()` throws a named error if that slot ever disappears, so a React
upgrade fails with a legible message rather than an undefined-property crash.
React is pinned exactly in `package.json`, so the slot cannot move without
someone editing that file.

### What is NOT covered, and why

- **Every `.tsx` file in T08.** `Shell`, `CountryPlaque`, `Panel`, `PanelHost`,
  the three placeholder bodies, `EditableText`, `EditableTextArea` and
  `ImageUpload`. There is no jsdom in the repo. Unchanged from the
  implementation agent's position.
- **`MapCanvas`'s pointer semantics** — `isContextPress`, the `onPointerDown`
  decline, the `onContextMenu` idle guard, the `onPointerUp` ctrl+click branch.
  They live inside a 28 KB `.tsx` with no exported seam, and asserting on them
  would mean asserting on a fake event system. The browser run recorded above
  (attempt 2, four native ctrl+clicks and right clicks with a `contextmenu`
  probe) is the evidence for these. **If a later task extracts the gesture rule
  into a pure predicate the way `nextSelection` was extracted, test it there.**
- **`countryTintWords` end to end.** In Node the manifest never loads, so
  `maxProvinceId` is 0 and the computed can only ever produce a length-1 array.
  `buildTintWordTable` is exported for exactly this reason and is tested
  directly instead.
- **The Escape ordering in `Shell.tsx`** (panel first, assign mode second) and
  the focus restore to the bar button. Both are DOM listener behaviour. The two
  stores they drive — `panel-store` and `assign-store` — are covered.
- **`downscaleImage`'s browser path.** T05 owns it; it needs `createImageBitmap`.
- **The theme tokens.** CSS, and no test can say whether a colour is right.

### Real `yarn test` output

```
$ yarn typecheck
typecheck exit=0
(no output)

$ yarn test
ℹ tests 493
ℹ suites 0
ℹ pass 493
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 652.575333
```

Mutation check on the one new harness, to prove it is not a tautology — the
fixed-window debounce turned into a restarting one:

```
$ npx tsx --test src/ui/use-field-commit.test.ts
✔ the field shows the store value until it is typed into
✖ the commit window is FIXED, not restarting
✔ a commit clears the draft so the field falls back to the clamped store value
✔ blur commits immediately and disarms the window
✔ blur with nothing pending commits nothing
✔ unmount flushes the last keystroke
✔ the unmount flush calls the CURRENT callback, not the first render's
✔ an unmount with nothing pending commits nothing
✔ the default window is FIELD_COMMIT_MS
✔ a later delay argument is picked up by the next window
ℹ tests 10
ℹ pass 9
ℹ fail 1
```

`src/ui/use-field-commit.ts` was restored immediately afterwards and the suite
is back at 493 / 493.

---

## Docs & commit

Commit: `f56a66f3e473461e9edbcdf64932bc9c03ba1b62` — "civitas interactive map — T08
selection interaction and UI shell". 40 files, all under the package.

### Verification before committing

All three green on the first run. Nothing needed fixing.

```
yarn typecheck   exit 0 (no output)
yarn test        exit 0, tests 493, pass 493, fail 0
yarn build       exit 0, the same three asset-size warnings T02 recorded (not silenced)
```

### README

Appended a `## Selection and the UI shell` section. No earlier section was
rewritten. It covers:

- The files table, and the explicit list of what was NOT touched
  (`render.ts`, `OverlayInput`, `src/map/`, `borders-store`, `label-store`,
  `assign-store`), so T09's reviewer can see the byte-identical assertion still
  holds.
- The selection model: three slots in one signal, the pure `nextSelection`, the
  two easy-to-get-wrong rows of the transition table, the `sameSelection` guard,
  and the reason `selectedCountryId` is a computed and never stored.
- Click semantics: `isContextPress`, the `onPointerDown` decline before its
  `preventDefault`, why declining in `onPointerDown` is what stops a ctrl+click
  from painting, the `onContextMenu` idle guard, and the `onPointerUp` branch for
  the platforms that fire no `contextmenu`.
- The tint-alpha emphasis, the byte-identity of the no-emphasis table, and why
  `diffTintWords` makes it cheap.
- The shell: the sibling-of-the-host rule, the pointer-events rule on the plaque
  rail, the one Escape listener and its order, and the focus restore.
- The theme: the token block, the legacy-alias re-point, and the three
  constraints (`--bg-sunken`, `color-scheme`, `--font` vs `LABEL_FONT_STACK`).
- The panels: `role="region"` not `dialog`, `PANEL_DOM_ID`, the conditional
  `aria-controls`, and the read-only chip.
- The fields: the fixed 200 ms window, why it exists at all when `markDirty`
  already debounces, the per-render `commitRef`, and the `key`-per-target rule.
- The `updateCountry` `provinceIds` identity change and the label-anchor cost it
  removes.
- Seven traps, including the corrected claim about the HUD: earlier README
  sections say T08 replaces it, and T08 kept it instead.

No new storage key, no schema field and no migration, so there was no persistence
contract to document. The new contracts are `PanelId`, `PANEL_DOM_ID`, the
selection signal set, `SELECTED_TINT_ALPHA` and `FIELD_COMMIT_MS`.

### Files committed

40 files. `git add` was used for the untracked ones, then `git commit -- <paths>`
in partial-commit mode, because the index already held a large set of unrelated
staged changes (`javascript/.yarn/cache`, other packages). A path-limited commit
leaves that index untouched. This is the same procedure T07 used.

```
.plan/T07/memory.md            (T07's own "Docs & commit" addendum, left uncommitted by T07)
.plan/T08/DESIGN.md
.plan/T08/memory.md
.plan/T08/review-1.md
.plan/T08/review-2.md
README.md
src/App.tsx
src/app.module.css
src/main.tsx
src/state/country-store.ts
src/state/country-store.test.ts
src/state/panel-store.ts
src/state/panel-store.test.ts
src/state/selection-store.ts
src/state/selection-store.test.ts
src/state/world-store.ts
src/state/world-store.test.ts
src/ui/CountryOverviewPanel.tsx
src/ui/CountryPanel.tsx
src/ui/CountryPlaque.tsx
src/ui/EconomicsPanel.tsx
src/ui/EditableText.tsx
src/ui/EditableTextArea.tsx
src/ui/ImageUpload.tsx
src/ui/MapCanvas.tsx
src/ui/Panel.tsx
src/ui/PanelHost.tsx
src/ui/ProvincesOverviewPanel.tsx
src/ui/Shell.tsx
src/ui/tint-layer.ts
src/ui/use-field-commit.ts
src/ui/use-field-commit.test.ts
src/ui/country-panel.module.css
src/ui/country-plaque.module.css
src/ui/fields.module.css
src/ui/map-canvas.module.css
src/ui/panel-bodies.module.css
src/ui/panel.module.css
src/ui/shell.module.css
src/ui/theme.css
```

### Deliberately NOT committed

- `.plan/PLAN.md` and the untracked `.plan/T11/` tree. Those are T11 rulebook prep
  written outside this task, and T07 left them for the same reason. They stay in
  the working tree for whoever owns T11.
- Everything under `javascript/.yarn/cache` and every other package's changes.
- `../civitas-map` is untouched: `git status --porcelain` over it prints nothing.
- Nothing was pushed.

### Left for T09

- The plaque and the panel dock overlap between roughly 900 and 1200 px.
- `.hud`'s `max-width` is wrong below roughly 760 px.

Both were raised in `review-1.md` as non-blocking and assigned to T09 there.
