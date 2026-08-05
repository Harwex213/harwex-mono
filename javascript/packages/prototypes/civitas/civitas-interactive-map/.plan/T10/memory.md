# T10 — think agent handoff

Design: `.plan/T10/DESIGN.md`. Sections 3, 4 and 5 are written to be implemented
literally. T10 is a panel body plus ~40 lines of pure arithmetic. Reuse
`ImageUpload`, `EditableText`, `EditableTextArea`, `useFieldCommit`, `Panel`,
`setProvinceName`, `setProvinceLore`, `setProvinceImage`, `provinceDisplayName`,
`downscaleImage` and T09's `saveNoticeFor`. Build no second version of any of them.

## Decided, with reasons

- **Uniform fixed-height rows, `PROVINCE_ROW_HEIGHT = 196`.** A uniform height
  makes index-to-offset arithmetic O(1) both ways, so there is no offset table, no
  per-row measurement and no per-row `ResizeObserver`. The constant is applied as
  an inline `height` and the CSS sets none, so the two cannot disagree. §3.1 has
  the internal pixel budget that fixes 196.
- **State is one integer, `first`.** The scroll handler calls
  `windowStart(scrollTop, …)`; React bails when the integer is unchanged, so
  scrolling inside one row costs zero renders. The window is one translated block
  of contiguous rows, not one absolute position per row.
- **`windowGeometry` re-clamps `first` to `rowCount - visible - overscan`.** That
  value equals what a real scroll to the bottom produces, so the clamp never
  fights the user — and it removes the blank frame between a filter shrinking the
  list and the browser's own `scrollTop` clamp firing a `scroll` event.
- **Sparseness is inherited, not re-implemented.** `writeOverrideField` already
  skips an unchanged value and deletes an override once its last field is emptied.
  T10's only duty is to call a setter from a commit handler and never from render.
  `useFieldCommit`'s unmount flush is safe: `flush()` returns early when
  `latest.current === null`, which only `onChange` assigns.
- **Rows are keyed by the province id**, so a sliding window unmounts the leaving
  key and mounts the entering one fresh. The inner fields then need no keys of
  their own, and a buffered draft can never land on the wrong province.
- **`<ProvinceList key={country.id}>`** resets the query and the scroll on a
  country change with no effect and no cleanup. `country.id` does not change when
  provinces are painted into that same country, so painting never resets the list.
- **The map-to-list scroll is guarded on the selection id in a ref, not on a
  render.** Hand-scrolling never re-scrolls, a row click never jumps the list
  (`scrollTopForIndex` returns `null` for a visible row), and the
  `scrollTop` write cannot loop. A row filtered out is deliberately NOT recorded as
  synced, so clearing the query scrolls to it then.
- **Search matches the display name (substring, case-insensitive) and the id
  (prefix).** Not the lore: 8000 characters per province makes prose matching
  unpredictable. No debounce — it is one `includes` over a few hundred short
  strings.
- **`selectProvince` from a row does not empty the panel.** It sets scope
  `"province"`, and `selectedCountryId` at any non-country scope reads
  `countryOfProvince` live, so `selectedCountry` returns the same country. Looks
  like a bug waiting to happen; it is not.
- **`PROVINCE_IMAGE_MAX_EDGE` stays 320.** The row preview is 96 CSS px = 192
  device px at DPR 2, with headroom for a larger preview later. T09 pinned 320 in
  `image.test.ts` and left the constant to T10; raising it multiplies storage by
  the square of the ratio for a surface nothing draws.
- **Budget, stated as the brief asks.** `localStorage` is UTF-16, so a character
  costs 2 bytes. A 320-edge WebP is ~24 000 base64 chars ≈ **48 KB stored**. Against
  `STORAGE_BUDGET_BYTES` 4 000 000 that is **about 80 province images** before the
  `budget` warning, and about 100 before the real quota throws. Worst case:
  `IMAGE_TARGET_BYTES` caps one image at 256 KB decoded ≈ 700 KB stored, so five
  such images exhaust the budget. 250 maxed-out lores would too.
- **Quota is surfaced exactly as T09 does it**: `flushState()` after an image write
  or removal (never after a keystroke), the notice at the top of the panel body
  (never inside a row), and the message tagged with the province id and derived
  rather than reset in an effect.
- **`isImageDataUrl` is called before `setProvinceImage`,** not after. The store
  rejects an over-cap data URL silently — no return value, no warning, no timer.
  Running the store's own predicate first turns the silent drop into a sentence
  with no read-back and no `.peek()` question.
- **`imageSaveNoticeFor` delegates to T09's `saveNoticeFor`** and overrides one
  branch (quota after an image write). The warning-to-sentence table stays in one
  place; a new `WarningKind` still has one home.
- **`Panel` needs no change.** `.body` is already a flex column with
  `min-height: 0`, so a `flex: 1; min-height: 0; overflow-y: auto` child becomes
  the scroller and the body never scrolls. Every sibling of the viewport must be
  `flex: none`.
- **One shared-component change: `areaClassName` on `EditableTextArea`,** which
  REPLACES `styles.area` and never adds to it — the same specificity rule and the
  same wording T09 wrote for `previewClassName`. It is needed because `.area` sets
  `min-height: 6em` and `resize: vertical`, and both break a fixed row height.
- **`ImageUpload` needs no new prop.** `chooseLabel="add…"` / `replaceLabel="change…"`
  are short enough to sit beside `remove` in the 136 px image column;
  `choose file…` is not. That is the whole reason for the short labels.

## Traps found in the existing code

- `scaffold.test.ts:155` rejects any inline `export` keyword and any
  `export type { … }`. Write `export { type Foo };` at the end of the file.
- `getMapAssets()` is a plain module variable and notifies nobody.
  `ProvinceList` must read `loadPhase.value` in the component body, or names stay
  `"Province N"` for the whole session.
- Read every signal in the **component body**, never only inside a `useMemo`. A
  render where the memo does not re-execute would unsubscribe the component.
- `country.provinceIds` is stable by identity — `updateCountry` deliberately does
  not copy it. Do not "fix" that; `label-store` and this list both depend on it.
- `useFieldCommit`'s window is fixed at 200 ms and not restarting;
  `use-field-commit.test.ts` fails if it is made restarting. Do not touch 200 ms or
  the store's 400 ms.
- `ImageUpload` drops an in-flight upload when its row unmounts (`mountedRef`).
  Known limitation, recorded not fixed — fixing it changes a component three panels
  share. `OVERSCAN_ROWS = 4` widens the safe band.
- `.rows` must carry no `gap`. Any gap adds height the geometry does not know
  about and the window drifts from the scrollbar.
- Province ids are 1..1650 for 1648 provinces. A phantom row stays listed and
  editable; hiding it would make its override unreachable.
- The baseline is **547 tests**, from `.plan/T09/memory.md`. The brief's 493 is
  stale.

## Not done here, still open

- No new storage key, schema field or migration. No export/import.
- No camera move on selection — that needs a new `view-store` action and would
  reopen the fitted policy.
- No assignment, reordering, multi-select or bulk edit from this panel.
- No "all provinces" (unassigned) view. No lore full-text search.
- No jsdom, so no `.tsx` unit test. The wiring jsdom cannot reach is pinned by
  source assertions, the precedent being `scaffold.test.ts` and
  `country-overview.test.ts`.
- Still open from T08/T09: the plaque and panel dock overlap between roughly 900
  and 1200 px, and `.hud`'s `max-width` below roughly 760 px.
- `README.md` — the docs agent owns it.

## Implementation (attempt 1)

Design followed literally except for the four deviations recorded under
"Deviations" below.

### Files

Created:

- `src/ui/province-list.ts` — the pure half: `PROVINCE_ROW_HEIGHT` 196,
  `OVERSCAN_ROWS` 4, `PROVINCE_LORE_ROWS` 3, `PROVINCE_IMAGE_STORE_BYTES` 48000,
  `windowStart`, `windowGeometry`, `scrollTopForIndex`, `normalizeQuery`,
  `matchesQuery`, `filterRows`, `indexOfProvince`, `buildProvinceRows`,
  `overrideSummary`, `imagesRemaining`, `budgetText`, `imageSaveNoticeFor`.
- `src/ui/province-list.test.ts` — 21 cases: the arithmetic, the search
  predicate, the row assembly, the budget, the notice table, plus five source
  assertions for the wiring jsdom cannot reach.
- `src/ui/province-list.module.css` — the panel's styles. Tokens only. `.row`
  declares no `height` and `.rows` no `gap`, both pinned by a test.
- `src/ui/ProvinceList.tsx` — search box, always-mounted scroll viewport, the
  translated window of rows, the `ResizeObserver`, the two-way selection sync.
  The only signal subscription in the list.
- `src/ui/ProvinceRow.tsx` — one row: select strip, `ImageUpload`,
  `EditableText`, `EditableTextArea`. Reads no signal, imports nothing from
  `@preact/signals-react`.

Changed:

- `src/ui/ProvincesOverviewPanel.tsx` — rewritten body. Two empty states, the
  panel-level save notice, `<ProvinceList key={country.id}>`, the footer.
  `ROW_CAP` and the `panel-bodies.module.css` import are gone.
- `src/ui/EditableTextArea.tsx` — one optional prop, `areaClassName`, which
  REPLACES `styles.area`.

Not touched: everything under `src/map/` and `src/state/`, `Panel.tsx`,
`ImageUpload.tsx`, `EditableText.tsx`, `use-field-commit.ts`,
`country-overview.ts`, `fields.module.css`, `panel-bodies.module.css` (still
imported by `EconomicsPanel`), `theme.css`, and `../civitas-map`.

### Deviations from DESIGN.md, and why

1. **The footer is a render prop.** §6 puts `<shown> of <total>` in the panel,
   but `shown` is a function of the query, which the list owns (the query has to
   live under the `key={country.id}` remount). `ProvinceList` therefore takes
   `footer: (shown: number, summary: OverrideSummary) => ReactNode` and calls it
   during render. The sentence and its styling stay in the panel; no effect and
   no extra render.
2. **The viewport is always mounted.** §4.8 renders the "no province matches"
   line instead of the list. Unmounting the viewport drops the `ResizeObserver`
   registered against that element in a `[]`-dependency effect, and
   `viewportHeight` would then be stale for the rest of the session. The empty
   line now renders INSIDE the viewport.
3. **`.rowArea` uses `flex: 1` instead of `height: 100%`.** The textarea's flex
   parent also holds the caption, so a percentage height resolves past the row
   and overflows. `min-height: 0` and `resize: none` are as designed.
4. **The panel filters the notice on membership, not just on the tag.** §6 says a
   notice for another country is "simply not shown", but the panel does not
   remount, so the state survives. It now checks
   `country.provinceIds.includes(notice.provinceId)`.

Also: the row-reads-no-signal source assertion checks for no
`@preact/signals-react` import rather than for no `useSignals`, because the
comment that explains the rule contains the word.

### Commands, actual output

`cd javascript/packages/prototypes/civitas/civitas-interactive-map`

```
$ yarn typecheck
exit=0            (no output)

$ yarn test
ℹ tests 568
ℹ suites 0
ℹ pass 568
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 594.957834

$ npx tsx --test src/ui/province-list.test.ts
ℹ tests 21
ℹ pass 21
ℹ fail 0

$ yarn build
WARNING in ⚠ asset size limit: The following asset(s) exceed the recommended size limit (300.000 KiB). This can impact web performance.
  │ Assets:
  │   assets/map.png (2.530 MiB)
  │   assets/provinces_map.png (552.626 KiB)
  │   assets/provinces_manifest.json (586.891 KiB)
Rspack compiled with 1 warning in 84 ms

$ git status --porcelain -- ../civitas-map
                  (nothing)
```

Baseline was 547 (T09). 568 now, +21, none edited or weakened.

### Browser verification, Chrome, foreground tab, `yarn dev`

Seeded a 400-province country straight into `civitas.state.v1`, selected it, and
opened PROVINCES. Measured, not eyeballed:

- **Virtualisation gate.** `document.querySelectorAll("[data-province-row]").length`
  is **13** at `scrollTop` 0, 20 000 and 40 000, and 9 at the very bottom (the
  clamp puts `first` at 391 of 400). Spacer height `78400px` = 400 × 196. First
  row's measured `getBoundingClientRect().height` is **196**. Viewport is 678 px,
  so `ceil(678/196) + 1 + 2*4 = 13` — matched exactly.
- **Sparseness gate.** After scrolling the whole list twice (once by hand, once
  as 120 programmatic steps),
  `JSON.parse(localStorage["civitas.state.v1"]).provinceOverrides` is `{}` and
  the footer reads `0 edited`.
- **Sparse writes.** Typing a name gives `{"350":{"name":"Alta Verde"}}` —
  one key, one field. Adding lore gives
  `{"350":{"name":"Alta Verde","lore":"salt roads and a broken tower"}}`.
  Clearing the name leaves `{"350":{"lore":"…"}}` and the header strip falls back
  to `Province 350`. Clearing the lore too leaves `{}` and the edited dot goes.
- **List -> map.** Clicking row 206's header marks that row
  (`data-selected="true"`), moves the HUD selection, and leaves `scrollTop`
  at 40000 — the list does not jump.
- **Map -> list.** A real pointerdown/up on province 350's centroid on the map
  canvas scrolled the viewport to **68163**, which is exactly
  `349 * 196 - (678 - 196) / 2`, the centred position, and marked the row.
- **Search.** `41` -> 4 rows (41, 141, 241, 341) and the footer reads
  `4 of 400 shown`; `Province 7` -> 11 rows; `zzzz` -> 0 rows and
  `no province matches “zzzz” — clear filter`. NOTE: with placeholder names the
  NAME substring rule also matches 141/241/341 on the digits `41`. That is the
  name rule, not the id rule; the id rule is a prefix and is unit tested on
  named rows.
- **Selected province filtered out.** The line
  `the selected province is hidden by this filter` appears and `scrollTop` stays 0.
- **Scroll cost.** A `PerformanceObserver` on `longtask` across 120 scroll steps
  over the whole list recorded **zero** long tasks.
- **Budget warning is non-fatal and panel level.** With a 4701 KB document the
  panel shows `the saved state is 4701 KB and is close to the browser limit…`
  with `data-kind="warn"`, the footer reads `room for about 0`, the typed text
  stays on screen and the list keeps working at 13 rows.
- `read_console_messages` with `onlyErrors`: nothing, on first load and after a
  reload.
- `localStorage.clear()` at the end; the tab is closed and the dev server killed.

### Image budget, restated from the measurement

`PROVINCE_IMAGE_MAX_EDGE` stays **320** (unchanged, still pinned by
`image.test.ts`). `localStorage` is UTF-16, so one base64 character costs 2
bytes. A 320-edge WebP is about 24 000 characters ≈ **48 KB stored**
(`PROVINCE_IMAGE_STORE_BYTES`). Against `STORAGE_BUDGET_BYTES` of 4 000 000:
`imagesRemaining(0, …)` is **83**, so **about 80 province images** fit before the
`budget` warning, and roughly 100 before a real 5 MB quota throws. Worst case
`IMAGE_TARGET_BYTES` caps one image at 256 KB decoded ≈ 700 KB stored, so five
such images exhaust the budget. 250 full 8000-character lores would too — the
live budget test above used 300 lores and hit the warning at 4701 KB.

### Left undone, deliberately

- **The hard-quota (`setItem` throws) branch was not reproduced in the browser.**
  Chrome on this machine accepted a 4.7 MB document plus 1.3 MB of ballast
  without throwing. The branch is covered by `imageSaveNoticeFor(quota, true)` in
  the unit tests and renders through the same element the `budget` warning was
  seen rendering through.
- **The in-flight-upload-on-unmount drop** (`ImageUpload`'s `mountedRef`) is
  still there. `OVERSCAN_ROWS = 4` widens the safe band; fixing it means lifting
  the busy flag out of a component three panels share.
- No camera move on selection, no assignment/reorder/multi-select/bulk edit, no
  "all provinces" view, no lore full-text search, no lore counter in a row, no
  new storage key or migration, no new dependency, no jsdom.
- Still open from T08/T09: the plaque/panel-dock overlap between roughly 900 and
  1200 px, and `.hud`'s `max-width` below roughly 760 px.
- `README.md` — the docs agent owns it.

## Tests

Regression pass by the tests agent. **25 new cases**, all in
`src/ui/province-list.test.ts`, appended below a banner comment. No existing case
was edited, weakened or deleted — the only change above the banner is two import
lines (`PROVINCE_LORE_ROWS`, plus `LORE_MAX`, `PROVINCE_IMAGE_MAX_EDGE` and
`utf16Bytes` from the stores) that the new cases need.

Suite: **568 before, 593 after, 0 failing.** `yarn typecheck` exit 0.
No source file was changed: the implementation had no defect the tests could find.

### What the new cases pin

Geometry, beyond the single-point checks that were already there:

- **A full scroll sweep**, `windowStart` -> `windowGeometry` composed the way the
  component composes them, over 6 row counts (1 … 1648), 5 viewport heights
  (including exact multiples of the row height) and every row boundary plus a
  97 px comb. It asserts the window contains every row the browser would paint,
  `last <= rowCount`, `offsetY === first * rowHeight` and the rendered count cap.
  It runs at **overscan 0 as well as 4** — four spare rows on each side hide an
  off-by-one, and at 0 the `+ 1` for a partially scrolled row is load bearing.
- A scroll to the very bottom of a 400-row country reproduces the browser check's
  measured numbers exactly: `first` 391, 9 rows, spacer 78 400 px, 13 rows
  everywhere else at the measured 678 px viewport.
- A zero and a non-finite viewport height still render at least one row — the
  first frame runs before the `ResizeObserver` reports.
- A list shorter than the viewport renders every row and `scrollTopForIndex`
  returns `null` for every index.
- **The map-to-list composite**: `scrollTopForIndex` -> `windowStart` ->
  `windowGeometry` lands the selected index inside `[first, last)` for a far jump,
  a jump backwards, the last row and two near misses. Includes the measured
  `68163` centred position for province 350.

Search, rows and the budget:

- `filterRows(rows, normalizeQuery(" ALTA  verde "))` matches, and a
  whitespace-only query keeps the **same array reference**.
- The id prefix rule at every digit length: `1` -> 1, 13, 1318; `13` -> 13, 1318;
  `318` and `8` -> nothing.
- Neither the lore nor the stored data URL is searchable (`webp`, `base64`).
- `buildProvinceRows` keeps the given order and neither sorts nor dedupes — the
  order is the country's assignment order.
- A bare `{}` override and a `{ name: "" }` override still read as `edited` with
  every field defaulted, so a repaired document's override stays reachable.
- The injected lookups are called **once per id** and the name layering is not
  re-implemented.
- `overrideSummary` over the filtered rows differs from the summary over all
  rows — the footer's `edited` count must not drop when a filter hides the edited
  provinces.
- DESIGN §9 arithmetic tied to the real constants: `utf16Bytes("x" * 24000)`
  equals `PROVINCE_IMAGE_STORE_BYTES`, 83 images at 4 000 000, 5 worst-case
  700 KB images, 250 full `LORE_MAX` lores, and the one-left / none-left edges.
- `budgetText` never prints a fractional or negative count.
- Only `quota` reacts to `afterImageWrite`, over a
  `Record<WarningKind, boolean>` so a new kind must declare itself here.
- The image quota sentence names the province image, says the image is still
  shown, and never says "flag".

Wiring jsdom cannot reach (source assertions, the precedent being
`scaffold.test.ts`):

- The name input is controlled on `row.rawName` with `row.name` as the
  placeholder, all three setters are called with `row.id`, and the row contains
  no `useEffect`/`useSignalEffect` — no setter is reachable from render.
- The lore box passes `areaClassName`, `PROVINCE_LORE_ROWS` and `LORE_MAX`, and
  `.rowArea` has `min-height: 0` / `resize: none` and neither `resize: vertical`
  nor `min-height: 6em`.
- `EditableTextArea` **replaces** `styles.area` (`?? styles.area`, no template
  literal, no `+`) and still defaults `rows` to `DEFAULT_ROWS` for its other two
  callers.
- The list computes the summary from `rows`, filters with the normalized query,
  slices the window out of `visible`, and never maps over `provinceIds`.
- The viewport renders **before** the `visible.length === 0` branch, so the
  `ResizeObserver` is never unmounted; the effect disconnects; no
  `useSignalEffect`.
- `.viewport` is `flex: 1 / min-height: 0 / overflow-y: auto / position: relative`,
  `.search`, `.note`, `.filtered` and `.notice` are all `flex: none`, `.window` is
  absolute at `top: 0`, and `.spacer` declares no height.
- The fixed pixel heights inside a row (2 border + 2 × `--civ-space-3` padding +
  24 head + 8 gap + 72 preview = 122) fit inside `PROVINCE_ROW_HEIGHT`. The row
  clips its overflow, so a preview grown past the budget would silently cut the
  fields off.
- The panel carries no `ROW_CAP`, no `panel-bodies` import and no `slice(`, tags
  the notice by `provinceIds.includes(notice.provinceId)`, and renders the notice
  above `<ProvinceList`.

### Mutation-checked, not just green

Each of these was applied to the source, the suite was run, and the source was
restored (`diff` against a backup confirms all five files are byte-identical to
the implementation agent's version):

| Mutation | Caught by |
|---|---|
| `visible` drops the `+ 1` | the scroll sweep + the bottom-of-list case |
| `last` drops the trailing overscan | the bottom-of-list case |
| `windowStart` ceils instead of flooring | the existing `windowStart` case |
| the panel regains a `ROW_CAP` slice | the panel source case |
| `.rowArea` becomes `resize: vertical` | the lore-box case |
| the name input is controlled on `row.name` | the raw-override case |

`overrideSummary` counting an image as `edited` is NOT caught, deliberately: an
`imageDataUrl` only ever comes from an override, so on real data the two
predicates agree and the mutation is semantically equivalent.

### Commands, actual output

`cd javascript/packages/prototypes/civitas/civitas-interactive-map`

```
$ yarn typecheck
typecheck exit=0            (no output)

$ npx tsx --test src/ui/province-list.test.ts
ℹ tests 46
ℹ pass 46
ℹ fail 0

$ yarn test
ℹ tests 593
ℹ suites 0
ℹ pass 593
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 682.463667

$ yarn build
WARNING in ⚠ asset size limit: ... assets/map.png (2.530 MiB),
  assets/provinces_map.png (552.626 KiB), assets/provinces_manifest.json (586.891 KiB)
Rspack compiled with 1 warning in 85 ms

$ git status --porcelain -- ../civitas-map
                  (nothing)
```

### Left untested, and why

- Anything needing a DOM: the `ResizeObserver`, the `scroll` handler's
  `setFirst` bail-out, the `syncedRef` no-loop property, `onFocusCapture`, and
  the `key={country.id}` remount. There is no jsdom, and the pure halves of all
  five are covered above.
- `ImageUpload`'s in-flight drop on unmount (§8.7) — still a known limitation.
- The hard-quota `setItem` throw in a real browser, as the implementation agent
  recorded. `imageSaveNoticeFor(quota, true)` covers the branch.

---

## Docs & commit

Commit: `bc509e67d5ee56dd27aadda1ac1aa463aad084a6` — "civitas interactive map — T10
provinces overview panel". 11 files, every one inside the package.

### Verification before committing

All three green on the first run. Nothing needed fixing.

```
$ yarn typecheck
exit=0            (no output)

$ yarn test
ℹ tests 593
ℹ pass 593
ℹ fail 0
ℹ duration_ms 570.244541

$ yarn build
WARNING in ⚠ asset size limit: assets/map.png (2.530 MiB),
  assets/provinces_map.png (552.626 KiB), assets/provinces_manifest.json (586.891 KiB)
Rspack compiled with 1 warning in 82 ms
```

### README

One new section, `## Provinces overview panel`, appended after T09's. 286 lines.
No earlier section was rewritten. It covers the files table, the pure half, the
virtual window and the 196 px budget, search, the two-way selection sync,
sparseness, the row, the always-mounted viewport, the footer render prop, the
image budget, quota and the save notice, the tests, and eleven traps.

### Committed, and what was deliberately left out

Committed: `README.md`, the three `.plan/T10/` files, and the seven source files.

**The commit used an explicit pathspec, not the index.** The working tree carried
staged changes from other packages when this agent started — `javascript/.yarn/cache`
(about 120 zips), `javascript/.claude/skills/prototype-manager/SKILL.md`, and files
under `ai-slop/` and `faenwald/`. `git commit -- <paths>` bypasses the index for
everything else, so those entries stayed staged and untouched. A plain `git commit`
would have swept all of them in.

Left uncommitted on purpose, all unrelated to T10:

- `javascript/yarn.lock` — adds the `@hw/react-di` workspace from `ai-slop/`.
- `.plan/PLAN.md` — the T11 economics brief expansion.
- `.plan/T08/memory.md`, `.plan/T08-FIX/memory.md`, `.plan/T09/memory.md` — each is
  its own docs agent's "Docs & commit" section, appended after that task's commit.
  This file follows the same pattern, so it is dirty now too.
- `.plan/T11/` — the rulebook digest, the image transcriptions and the images.

`git status --porcelain -- ../civitas-map` is empty. Nothing under the sibling
package was read-modified or committed.
