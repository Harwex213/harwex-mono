# T10 — review 1 (adversarial)

Verdict: **ACCEPTED. Zero blocking items.**

## Commands, regenerated from scratch

Run from `javascript/packages/prototypes/civitas/civitas-interactive-map`.

| Command | Result |
|---|---|
| `yarn typecheck` | exit 0, no output |
| `yarn test` | `tests 568 / pass 568 / fail 0`, duration 666 ms |
| `yarn build` | exit 0, one warning, the three known asset-size entries only |

`git status --porcelain -- ../civitas-map` prints nothing. `../civitas-map`'s last
commit is `4b639b4`, untouched.

`git diff HEAD -- "src/**/*.test.ts"` is empty and `git diff HEAD --diff-filter=D`
is empty. **No existing test was edited, weakened or deleted.** 547 baseline + 21
new = 568, which matches the run.

## What was checked

### 1. Brief and design coverage

Every brief item lands.

- Image per row through `downscaleImage`: `ProvinceRow.tsx:89-97` passes
  `maxEdge={PROVINCE_IMAGE_MAX_EDGE}` to `ImageUpload`, whose only image path is
  `downscaleImage` (`ImageUpload.tsx:77`). `province-list.test.ts:334` pins that
  `ProvinceRow.tsx` contains no `FileReader`, `toDataURL` or `createObjectURL`.
- Name defaulting to the manifest placeholder: `EditableText` is controlled on
  `row.rawName` with `placeholder={row.name}` (`ProvinceRow.tsx:105-113`), and
  `row.name` comes from the injected `provinceDisplayName`
  (`ProvinceList.tsx:74`), which falls back to `"Province " + id`
  (`world-store.ts:355-365`).
- Multiline lore: `ProvinceRow.tsx:115-125`.
- Sparseness: the only setter calls are inside commit handlers
  (`ProvinceRow.tsx:46`, `111`, `123`). Nothing writes on render.
  `writeOverrideField` returns before any signal write when the value is
  unchanged (`world-store.ts:289-291`) and deletes the whole override once its
  last field is emptied (`world-store.ts:303-305`). `useFieldCommit`'s unmount
  flush returns early when `latest.current === null`
  (`use-field-commit.ts:47-54`), and `latest` is only assigned in `onChange`, so
  a row that scrolls past untouched writes nothing.
- Virtualisation: `ProvinceList.tsx:149` renders
  `visible.slice(geometry.first, geometry.last)` only.
- Two-way selection: row to map at `ProvinceRow.tsx:66-75` via `onSelect` bound
  to `selectProvince` (`ProvinceList.tsx:236`); map to list at
  `ProvinceList.tsx:110-140`, and the mark is `data-selected` +
  `.row[data-selected="true"]` (`province-list.module.css:127`).
- Search: `ProvinceList.tsx:167-184`, predicate in `province-list.ts:189-208`.
- Preview max edge and the budget are stated in `.plan/T10/memory.md` and in
  `province-list.ts:35-39`: 320 edge, ~48 KB stored per image, ~80 images before
  the `budget` warning and ~100 before a real quota throw.
- Quota surfaced as T09 does: `flushState()` immediately after an image write
  (`ProvinceRow.tsx:50`), the notice rendered at panel level
  (`ProvincesOverviewPanel.tsx:98-102`), never inside a row, and non-fatal — the
  image stays in memory and the next edit retries (`world-store.ts:152-160`).

Nothing is stubbed. `ROW_CAP` and the `panel-bodies.module.css` import are gone
from the panel; `panel-bodies.module.css` stays on disk for `EconomicsPanel`.

### 2. Style compliance with `javascript/CLAUDE.md`

No violations. Every new and changed file ends in exactly one grouped named
export (`province-list.ts:300`, `ProvinceList.tsx:251`, `ProvinceRow.tsx:132`,
`ProvincesOverviewPanel.tsx:114`, `EditableTextArea.tsx:48`), with types written
`type Foo` inside the group. No inline `export`, no default export. No
single-quoted string outside a prose comment. Every `if` is braced with its body
on its own line. `province-list.module.css` has one declaration per line and no
single-line rule; it uses tokens throughout, the only literals being the four
pixel sizes the fixed row height is built from.

### 3. Bug hunt

- `useSignals()`: present in `ProvinceList.tsx:49` and
  `ProvincesOverviewPanel.tsx:27`. All three signal reads in `ProvinceList` are
  in the component body, not inside a `useMemo` (lines 61, 62, 66), including
  the `loadPhase.value` read that is the only thing making names re-resolve when
  the manifest lands late. `ProvinceRow` reads no signal and does not import
  `@preact/signals-react` at all — correct, and pinned at
  `province-list.test.ts:339`.
- No stale closure: `onScroll` and the sync effect read `visible` from the
  current render; the sync effect's guard lives in a ref keyed on the selection
  id, and `scrollTopForIndex` is fed `el.scrollTop` / `el.clientHeight` from the
  DOM rather than from possibly-stale state (`ProvinceList.tsx:129-135`).
- No listener leak: the single `ResizeObserver` is disconnected on cleanup
  (`ProvinceList.tsx:102-104`); everything else is a React prop handler. No
  window or document listener is added.
- No render loop: assigning `el.scrollTop` fires `scroll`, which calls
  `setFirst`; `syncedRef` already holds the id so the effect no-ops on the
  resulting render. React bails out when `windowStart` returns the same integer,
  so scrolling inside one row height costs zero renders.
- Images are never stored raw: `setProvinceImage` is only ever called with the
  output of `downscaleImage`, and `isImageDataUrl` is run first so the store's
  silent rejection becomes a visible sentence (`ProvinceRow.tsx:39-45`).
- Coordinate arithmetic: I brute-forced the geometry rather than trusting the
  test file. For `rowCount` in {1, 2, 5, 13, 50, 300, 900, 1648} and viewport
  heights {0, 100, 400, 678, 1200}, over every scroll position in 37 px steps,
  the rendered window `[first, last)` always covers the visible band — **0
  coverage failures**. And for every index at every scroll position, applying
  `scrollTopForIndex` leaves the row fully inside the viewport and inside
  `[0, total - viewportHeight]` — **0 visibility failures, 0 range failures**.
  No off-by-one.

### 4. Performance

Nothing is proportional to 1648 provinces per frame or per keystroke.

- The brute-force probe reports **max rendered rows = 16**, at a 1200 px
  viewport, and that number is independent of `rowCount` — 16 is exactly
  `ceil(1200 / 196) + 1 + 2 * 4`. At the 678 px viewport the panel actually gets,
  it is 13. The list is genuinely virtualised, not CSS-hidden.
- Per keystroke: `useFieldCommit` holds the draft in local row state, so typing
  does not re-render the parent at all. On commit, `buildProvinceRows` walks the
  country's ids once with `Map.get` and `byId.get` lookups — both O(1)
  (`world-store.ts:356`, `map-store.ts:88-93`) — so a 900-province country costs
  900 map lookups, not a scan.
- Per keystroke in the search box: one `includes` plus one `startsWith` per row,
  no debounce needed at that size. `filterRows` returns the same array reference
  for an empty query, so an unfiltered list rebuilds nothing.
- `props.provinceIds` is stable by identity, so a country rename, a country-lore
  keystroke or a paint stroke on another country rebuilds no rows.

### 5. `../civitas-map`

Untouched. Verified above.

### 6. Tests

Untouched. Verified above. The 21 new cases include the virtualisation gate
(`province-list.test.ts:108-121`), the sparseness instrument
(`:252-264`), the `Record<WarningKind, …>` exhaustiveness guard (`:291-299`), and
source assertions for the wiring jsdom cannot reach (`:329-381`).

## Non-blocking observations, recorded only

1. `ProvincesOverviewPanel.tsx:75` keeps `notice.touched` true after a successful
   image upload. A `quota` warning raised much later by a *lore* write then
   renders the image-flavoured sentence. Misleading wording, correct remedy,
   non-fatal. T09's flag notice has the same shape.
2. `ProvincesOverviewPanel.tsx:72-75` lets `mine.rejected` suppress a concurrent
   store warning. One message at a time is a deliberate panel rule.
3. Clicking into a field of a *partially* visible row focuses it, which fires
   `onFocusCapture` -> `selectProvince` -> the sync effect, which scrolls the row
   fully into view. Browsers scroll a focused element into view anyway, so this
   is not new behaviour.
4. Re-clicking the province that is already selected does not re-scroll the list,
   because `apply` dedupes through `sameSelection` (`selection-store.ts:158-164`)
   so no signal changes.
5. Tab from the last rendered row's textarea skips the unrendered rows below. The
   standard cost of virtualisation, and the brief asked for virtualisation.
6. The row's internal budget in `province-list.ts:16-23` accounts 144 px for
   `.rowBody` where the CSS actually yields 146 px (`--civ-space-3` is 8 px, so
   196 - 2 border - 16 padding - 24 head - 8 gap = 146). Two pixels of slack, and
   `.row` is `overflow: hidden`. Harmless.
7. Duplicate ids inside one `country.provinceIds` would produce duplicate React
   keys. Nothing in T10 can create that state and the assignment store is the
   only writer.
