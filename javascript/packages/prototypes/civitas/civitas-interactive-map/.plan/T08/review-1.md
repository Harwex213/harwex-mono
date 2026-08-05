# T08 review 1 — adversarial

Reviewer ran every command itself. Nothing below is copied from `memory.md`.

## Commands, regenerated

| Command | Result |
|---|---|
| `yarn typecheck` | PASS. No output, exit 0. |
| `yarn test` | PASS. `tests 463 / pass 463 / fail 0`, duration 825.9 ms. |
| `yarn build` | PASS. One warning, the expected asset-size one for `map.png`, `provinces_map.png` and `provinces_manifest.json`. `Rspack compiled with 1 warning in 82 ms`. |

## Hard-failure checks

- **`civitas-map` untouched.** `git status --porcelain -- .../civitas-map/` is empty. PASS.
- **No test weakened or deleted.** `git diff` on `country-store.test.ts` and `world-store.test.ts` is
  additive only: +2 tests and +1 test respectively, zero removed lines inside a test body. Two new
  test files added. 463 tests up from 440. PASS.
- **`src/ui/render.ts`, `src/map/*`, `borders-store.ts`, `label-store.ts`, `assign-store.ts`
  untouched.** Confirmed against `git diff --stat -- src/`. PASS.

## Style compliance (`javascript/CLAUDE.md`)

- Inline `export` keywords: `grep -rn -E "^export (const|function|type|class|interface|default)"`
  over `src/**/*.ts{,x}` returns **nothing**. Every new file ends in one grouped named export. PASS.
- Single-quoted strings: every `'` hit in `src/**/*.ts{,x}` is an apostrophe inside a comment. No
  single-quoted literal. PASS.
- Semicolons and braced `if`/loops: all 19 new `.ts`/`.tsx` files read in full. No single-line `if`,
  no missing terminator. PASS.
- CSS one declaration per line: `grep -rn -E "\{.*:.*;.*\}"` and the two-declarations-per-line
  pattern both return nothing across all `.css`. PASS.

## Brief coverage

Every item of the brief is present and wired, not stubbed:

- Left click -> `selectProvince` at `src/ui/MapCanvas.tsx:639`; sea returns `null` and clears.
- Right click -> `selectCountryOfProvince` at `src/ui/MapCanvas.tsx:714`, with an unconditional
  `event.preventDefault()` first at `:704`, and `onPointerDown` returning for `button === 2` at
  `:495` before its own `preventDefault` at `:504`.
- Hover unchanged, `setHoveredProvince` at `src/ui/MapCanvas.tsx:544`.
- Mode ownership of the left click is explicit: the paint branch returns at
  `src/ui/MapCanvas.tsx:621-627` before the selection branch, and the no-active-country
  fall-through at `:534-537` makes the click a selection. Mode is visible through the banner
  (`src/ui/Shell.tsx:83-99`), the viewport rail (`:139`) and the existing cursor states.
- Plaque with flag/name/slogan and three empty states: `src/ui/CountryPlaque.tsx:30-96`.
- Three real `<button type="button">` in the bar with `aria-pressed` / `aria-controls`:
  `src/ui/Shell.tsx:104-129`; `PanelHost` switch at `src/ui/PanelHost.tsx:15-24`; three placeholder
  bodies each render their own `<Panel>` and their own empty state.
- Panel chrome with title, close control and a scrollable body carrying `min-height: 0`:
  `src/ui/Panel.tsx` + `src/ui/panel.module.css:91-99`.
- Token file `src/ui/theme.css`, imported after `./index.css` at `src/main.tsx:6`. Every new CSS file
  uses `--civ-*` only — checked by grep, no hardcoded colour, radius or font size outside `theme.css`.
- `EditableText`, `EditableTextArea`, `ImageUpload` are controlled and round-trip through
  `updateCountry` at `src/ui/CountryOverviewPanel.tsx:41-78`, each with a `key` containing the
  country id. `ImageUpload` calls `downscaleImage` and nothing else
  (`src/ui/ImageUpload.tsx:64`), with a 20 MB pre-decode reject, a request counter, a mounted guard
  and an `onError` fallback.
- A11y: real buttons throughout, `role="region"` not `dialog`, one window Escape listener in
  `src/ui/Shell.tsx:44-70` with `CountryPanel`'s duplicate removed, focus restored only when it was
  inside the closing panel, never trapped.

## Correctness sweep — clean

- No import cycle. `country-store -> selection-store -> world-store -> map-store`; neither
  `world-store` nor `map-store` imports `country-store` or `selection-store`. Verified by reading
  every import line under `src/state/` and `src/ui/`.
- `useSignals()` is present in exactly the components that read a signal (`Shell`, `CountryPlaque`,
  `Panel`, `PanelHost`, all three panel bodies, `Hud`) and absent from the three field components,
  which read none.
- No leaked listener: the Escape listener is removed in its cleanup; `ImageUpload`'s mounted flag is
  reset in cleanup; `useFieldCommit` clears its timer and flushes on unmount, and reads its callback
  through `commitRef` so the unmount flush is never a stale closure.
- `endGesture` guards `releasePointerCapture` with `hasPointerCapture`, so a right-button
  `pointerup` that never captured does not throw.
- Perf: nothing new is O(10.4 M px) or O(1648) per frame. `buildTintWordTable` allocates one 1651-entry
  `Uint32Array` per selection change, `diffTintWords` then repaints only the changed ids. The
  provinces placeholder caps at 50 rows. `updateCountry` no longer copies `provinceIds`, which is
  pinned by a new test.
- No `localStorage` schema change, so T05's quota and corrupt-payload handling is untouched.
- `--font` / `--mono` re-point to byte-identical stacks, so `LABEL_FONT_STACK` in `label-layer.ts`
  (`"Inter", "Segoe UI", system-ui, sans-serif`) still matches the DOM. Verified against
  `index.css:14-15`.

## BLOCKING

### 1. macOS ctrl+click never reaches the country selection, contrary to the code's own comment

`src/ui/MapCanvas.tsx:698-711`.

The comment states:

```
// macOS ctrl+click fires `pointerdown` with button 0 AND `contextmenu`, so a
// province selection lands first and the country selection replaces it. The
// final state is exactly what a plain right click gives.
```

It does not. `contextmenu` is derived from `mousedown`, and `pointerdown` precedes `mousedown` for
mouse input. So by the time `onContextMenu` runs, `onPointerDown` has already gone down its
`button === 0` path:

- assign mode off -> `startPan(...)` at `src/ui/MapCanvas.tsx:537` set
  `gestureRef.current.kind === "pan"`;
- assign mode on with an active country -> `beginStroke` succeeded at `:523` and
  `gestureRef.current.kind === "paint"`.

Either way the guard at `src/ui/MapCanvas.tsx:709`

```ts
if (gestureRef.current.kind !== "idle") {
  return;
}
```

fires and `selectCountryOfProvince` at `:714` is never called. The observable result on macOS:

- assign mode off — ctrl+click selects the PROVINCE (via `onPointerUp` at `:639`), not its country.
  Scope stays `"province"`, the plaque frame stays `--civ-rule-strong`, the country tint does not
  deepen.
- assign mode on with an active country — ctrl+click PAINTS the province instead of inspecting it,
  which is the exact opposite of the design's stated rule that "the right button is never a paint
  gesture" (DESIGN §2.4).

DESIGN §2.5 and §8 item 2 both promise this case works, and `.plan/T08/memory.md` repeats the claim.
The browser check recorded in `memory.md` exercised button-2 right click only, so the case was never
observed. Button-2 right click is correct and unaffected — this is specific to the ctrl+click
affordance, which is a first-class right click on the platform this repo is developed on.

**Required fix:** let a ctrl+click through the idle guard while still declining a genuine right press
mid-gesture. For example, in `onContextMenu`, before the guard:

```ts
const gesture = gestureRef.current;
const ctrlClick = event.ctrlKey && event.button !== 2;
// A ctrl+click has ALREADY opened a left gesture by the time `contextmenu`
// fires, so the idle guard would reject the very case it is not aimed at.
if (ctrlClick && gesture.kind !== "idle") {
  cancelStroke();
  endGesture(event.currentTarget, ...);
} else if (gesture.kind !== "idle") {
  return;
}
```

Whatever shape it takes, it must satisfy all four of: ctrl+click selects the country in both modes;
ctrl+click in assign mode does not paint; a real right press during a left pan or paint stroke still
selects nothing; and the browser menu is still suppressed in every one of those cases. Then correct
the comment at `:698-700` and DESIGN §8 item 2 to describe what the code actually does, and add the
case to the manual checklist as something that was actually exercised.

## Non-blocking, recorded for the next agent

- The plaque rail is centred and the panel dock is right-aligned at a fixed `min(380px, …)`. Between
  roughly 900 and 1200 px of viewport width a wide plaque and an open panel overlap, and the plaque
  wins on `z-index` (`--civ-z-plaque` 4 vs `--civ-z-panel` 3), covering the panel header. The design's
  own acceptance criterion (§11 item 18, "stay inside the viewport") is met, so this is not a
  blocker, but T09 should cap the plaque against the dock.
- `aria-controls={PANEL_DOM_ID}` points at an element that does not exist while no panel is open.
- `.hud`'s `max-width: calc(50% - 190px)` goes to zero below a ~760 px viewport, collapsing the
  instrumentation readout. Cosmetic, dev-only surface.
