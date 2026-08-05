# T08 review 2 — adversarial

Every command below was executed by this reviewer. Nothing is copied from `memory.md`.
A live browser run against `yarn dev` was added on top of the static review; the
interaction results in §Live run are this reviewer's own, driven through native
Chrome input events, not dispatched ones.

## Commands, regenerated

| Command | Result |
|---|---|
| `yarn typecheck` | PASS. No output, exit 0. |
| `yarn test` | PASS. `tests 463 / pass 463 / fail 0`, duration 875.6 ms. |
| `yarn build` | PASS. One warning — the expected asset-size one for `map.png`, `provinces_map.png`, `provinces_manifest.json`. `Rspack compiled with 1 warning in 79 ms`. |

## Hard-failure checks

- **`civitas-map` untouched.** `git status --porcelain -- .../civitas-map/` is empty, before and
  after the review. PASS.
- **No test weakened or deleted.** `git diff` on `country-store.test.ts` (+2 tests) and
  `world-store.test.ts` (+1 test) is additive only — zero removed lines inside any test body, one
  changed import line. Two new test files. 463 tests, up from 440 before T08. PASS.
- **`src/ui/render.ts`, `src/map/*`, `borders-store.ts`, `label-store.ts`, `assign-store.ts`
  untouched.** Confirmed against `git status --porcelain -- src/`. `render.test.ts`'s
  byte-identical overlay assertion therefore still holds unchanged. PASS.
- **No `dist/` or stray file added to the working tree.** PASS.

## Style compliance (`javascript/CLAUDE.md`)

- Inline `export`: `grep -rnE "^[[:space:]]*export[[:space:]]+(const|let|var|function|async|type|interface|class|default|\*)"` over `src/**/*.ts{,x}` returns one hit,
  `src/env.d.ts:5` — an ambient `declare module` block from T01 (`git log` confirms commit
  `7a8b66d`, T01 package scaffold). Not T08. Every T08 file ends in exactly one grouped named
  export; verified file by file. PASS.
- Single-quoted literals: every `'` in `src/**/*.ts{,x}` is an apostrophe inside a comment or a
  test name. PASS.
- Semicolons, braced `if`/loops: all 19 new `.ts`/`.tsx` files read in full. No single-line `if`,
  no missing terminator. PASS.
- CSS one declaration per line: `grep -rnE "\{[^}]*:[^}]*;[^}]*\}"` and
  `grep -rnE ";[[:space:]]*[-a-zA-Z]+[[:space:]]*:"` both return nothing across every `.css`. PASS.
- No `console.*`, `debugger`, `TODO` or `FIXME` in non-test source. PASS.

## Brief coverage

Every item is present and wired, not stubbed.

- Left click selects: `selectProvince` at `src/ui/MapCanvas.tsx:677`, guarded on
  `button === 0 && gesture.kind === "pan" && !gesture.moved`.
- Right click selects the country and suppresses the menu: `onContextMenu` at
  `src/ui/MapCanvas.tsx:742` calls `event.preventDefault()` unconditionally and first (`:745`),
  then `selectCountryOfProvince` (`:752`). `onPointerDown` declines a context press at `:524`
  BEFORE its own `preventDefault` at `:533`.
- macOS ctrl+click — the `review-1.md` blocker — is fixed at the source, not repaired downstream:
  `isContextPress` at `src/ui/MapCanvas.tsx:81` treats `button === 0 && ctrlKey` as a right press,
  so `onPointerDown` starts neither a pan nor a paint stroke, and `onPointerUp:664` runs the same
  selection on platforms that fire no `contextmenu`. Verified live below.
- Hover preview unchanged: `setHoveredProvince` at `src/ui/MapCanvas.tsx:573`, cleared on leave.
- Sea clears: `provinceAtClient` returns `null` for sea and for bare canvas alike
  (`src/ui/MapCanvas.tsx:490-494`), so no separate branch is needed.
- Mode ownership of the left click is explicit and documented at `src/ui/MapCanvas.tsx:635-641`,
  and the mode is visually obvious: banner (`src/ui/Shell.tsx:83-99`), viewport rail (`:142`),
  existing cursor states.
- Plaque with flag, name, slogan, sub-line and three empty states: `src/ui/CountryPlaque.tsx:30-97`.
  Broken flag falls back to a colour swatch via an `onError` that stores the FAILED URL, not a
  boolean (`:24`, `:58`) — so the fallback does not stick when the selection moves.
- Three real `<button type="button">` with `aria-pressed`, and `aria-controls` set only while that
  panel is mounted: `src/ui/Shell.tsx:104-131`. `PanelHost` switch at `src/ui/PanelHost.tsx:15-24`.
- Panel chrome with title, close control and a scrollable body carrying `min-height: 0`:
  `src/ui/Panel.tsx` + `src/ui/panel.module.css:91-99`. `role="region"`, not `dialog`.
- Token file `src/ui/theme.css`, imported after `./index.css` at `src/main.tsx:6`. No new CSS file
  hardcodes a colour, gap, radius or font size — every declaration reads a `--civ-*` token.
- `EditableText` / `EditableTextArea` / `ImageUpload` are controlled and round-trip through
  `updateCountry` (`src/ui/CountryOverviewPanel.tsx:41-78`), each with a `key` containing the
  country id. `ImageUpload` calls `downscaleImage` and nothing else (`src/ui/ImageUpload.tsx:64`),
  with a 20 MB pre-decode reject, a request counter, a mounted guard and an `onError` fallback.
- A11y: real buttons throughout, no focus trap, one window Escape listener at
  `src/ui/Shell.tsx:44-70` with `CountryPanel`'s duplicate removed, focus restored only when it was
  inside the closing panel.

## Correctness sweep — clean

- **No import cycle.** Read every relative import under `src/state/` and `src/ui/`:
  `country-store -> selection-store -> world-store -> map-store`, and `world-store` imports only
  `../map/borders`, `map-store`, `migrations`, `persistence`, `schema`.
- **`useSignals()`** is present in exactly the components that read a signal (`Shell`, `Hud`,
  `MapCanvas`, `CountryPlaque`, `Panel`, `PanelHost`, the three panel bodies) and absent from the
  three field components and `useFieldCommit`, which read none.
- **No stale closure over a signal.** `useFieldCommit` reads its callback through `commitRef`,
  reassigned on every render (`src/ui/use-field-commit.ts:44`), so the unmount flush calls the
  current `onCommit`. `MapCanvas.draw` reads every input fresh.
- **No leaked listener or observer.** Shell's Escape listener, MapCanvas's `L` listener, the wheel
  listener, the `ResizeObserver` and the `resolution` media query all remove in cleanup.
  `useFieldCommit` clears its timer at unmount; `ImageUpload` resets its mounted flag.
- **No hook-order hazard.** Every conditional return in `CountryPlaque`, `CountryOverviewPanel`,
  `ProvincesOverviewPanel` and `EconomicsPanel` sits after all hook calls.
- **CSS-module keys all resolve.** Scripted every `styles.X` in the ten new/changed `.tsx` against
  its module: zero missing classes.
- **localStorage.** No schema change, no new key, no migration — T05's quota, corrupt-payload and
  read-only handling is untouched. `updateCountry` writes the signal BEFORE `markDirty`
  (`src/state/world-store.ts:454-456`), so a read-only document still updates the UI, which is what
  DESIGN §8 item 10 claims.
- **Performance.** Nothing new is O(10.4 M px) or O(1648) per frame. `buildTintWordTable` allocates
  one 1651-entry `Uint32Array` per selection change and `diffTintWords` repaints only the ids whose
  word changed. The provinces placeholder caps at 50 rows. `useFieldCommit`'s fixed 200 ms window
  collapses a keystroke burst into two `updateCountry` calls. `updateCountry` no longer copies
  `provinceIds`, which keeps `label-store`'s anchor cache valid across a rename — pinned by a new
  test.
- **Facts honoured.** No re-derivation of map size, province count or centroid semantics. Province
  ids missing from the manifest are tolerated: `provinceDisplayName` falls back and the province
  list renders the id.

## Live run (this reviewer, `yarn dev`, Chrome, 1531 x 803)

Native input events except where noted. `contextmenu` was probed on `window` in the bubble phase.

1. First paint: plaque `no selection / left-click a province · right-click for its country`; the
   three bar buttons present; no console error.
2. Each bar button opened its own panel (`Country`, `Provinces`, `Economics` headings), exactly one
   `aria-pressed="true"` at a time, the same button again closed it, and Escape closed the open one.
3. `+ new` created a country; the left row click selected it and the Country panel showed the four
   fields. Typing into Name propagated to the plaque immediately and to
   `localStorage["civitas.state.v1"].countries[0].name` = `Alnwick Union` after the two debounces.
   The value survived a full page reload.
4. Left click on land: HUD `selected 568 · scope province`, plaque `Province 568 / unassigned — …`.
5. Assign mode on, left drag painted 10 provinces; the selection did NOT move (`selected 568`), and
   the plaque switched to the country on its own because 568 had been painted into it — the live
   owner derivation in `selectedCountryId`.
6. **Ctrl+click, assign mode ON, on an unowned province**: probe
   `{button: 0, ctrlKey: true, defaultPrevented: true}`, HUD `selected 1045 · scope province`, and
   the country stayed at `10 prov · 30,255 px` — the press painted nothing. This is the
   `review-1.md` blocker, and it is fixed.
7. **Right click on an owned province**: probe `{button: 2, ctrlKey: false, defaultPrevented: true}`,
   HUD `scope country`, plaque frame `data-scope="country"`, province count unchanged.
8. Assign mode off, left click on sea: all three selection readouts cleared, plaque returned to the
   empty state, and the open panel STAYED open showing its own empty state.
9. After reload the Provinces panel listed all 10 rows under `Alnwick Union · 10 provinces`.
10. `read_console_messages` with `onlyErrors` reported nothing for the session.

## BLOCKING

None.

## Non-blocking, recorded for the next agent

- The plaque rail is centred and the panel dock is right-aligned at `min(380px, …)`. Between roughly
  900 and 1200 px of viewport width a wide plaque and an open panel overlap, and the plaque wins on
  `z-index`. Carried over from `review-1.md`; T09 should cap the plaque against the dock.
- `.hud`'s `max-width: calc(50% - 190px)` goes to zero below a ~760 px viewport. Dev-only surface.
- `src/ui/shell.module.css:17-18` says "only the plaque box and the banner inside it set
  `pointer-events: auto`", but `.assignBanner` sets `pointer-events: none` (`:44`). The behaviour is
  right — the banner is decorative — only the comment is wrong.
- A genuine right press made during an in-progress left pan ends that pan: `onPointerUp` for
  button 2 falls through to `endGesture` at `src/ui/MapCanvas.tsx:679` while the left button is
  still down. Pre-existing since T03/T04, unchanged by T08, and it violates no stated criterion —
  the menu is still suppressed and the selection does not change.
- `ImageUpload`'s upload path (checklist items 13-15) is still unexercised end to end; a file dialog
  cannot be driven from the automation tools. The code path is `ImageUpload -> downscaleImage`,
  which T05 verified in Chrome.
