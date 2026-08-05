# T09 — think agent handoff

Design: `.plan/T09/DESIGN.md`. §4 and §5 are written to be implemented literally.
T09 is completion, not new plumbing: T08 already wired the four fields to the
store to prove the contract. Reuse `EditableText`, `EditableTextArea`,
`ImageUpload`, `useFieldCommit`, `Panel`, `updateCountry`, `downscaleImage` and
`countryAggregates`. Build no second version of any of them.

## Decided, with reasons

- **One shared `countryDisplayName(id, name)` in `schema.ts`**, next to
  `createCountry` so the `"Country N"` string exists once. An empty name is
  reachable through `updateCountry` and today it blanks the plaque, **deletes the
  map label** (`label-store.ts:117` skips a country whose name trims to empty) and
  is silently rewritten on the next reload by `normalizeState`. One function fixes
  all three and makes memory agree with disk.
- **`FLAG_MAX_EDGE` 256 -> 384.** The largest surface is the 288 px panel preview;
  at DPR 2 that is 576 device px, which 256 cannot cover. Cost from T05's measured
  data point: about 70 KB of localStorage per flag against a 4 MB budget, so ~57
  flags. `IMAGE_TARGET_BYTES` still caps the pathological case. No test pins 256.
- **`flushState()` after a flag commit or removal, never after a keystroke.** A
  quota failure is only discovered inside `writeNow`; without the flush it lands
  400 ms later and reads as "it worked, then a banner appeared".
- **Read the store back after a flag commit.** `updateCountry` rejects a data URL
  over `IMAGE_DATA_URL_MAX` **silently** — no return value, no warning. Comparing
  `countryById.peek().get(id).flagDataUrl` to the committed URL is the only way to
  know. Use `.peek()`: this is an event handler and must not subscribe.
- **The save notice is panel-level, at the top of the body — not inside the flag
  field.** A quota failure caused by lore should not appear under a flag picker.
  So `ImageUpload` needs no `notice` prop.
- **The pure logic lives in `src/ui/country-overview.ts`.** There is no jsdom in
  the repo, so a `.tsx` cannot be tested. `saveNoticeFor`'s warning-to-sentence
  table and the number formatting move out of the component to become testable.
- **Hand-rolled digit grouping, not `toLocaleString()`.** A test asserting
  `"18,687"` against `toLocaleString` asserts whatever ICU the runner shipped
  with. The comma matches `CountryPanel`'s existing `18,687 px` row.
- **`previewClassName` REPLACES `styles.preview`, never adds to it.** Two
  single-class selectors from two CSS modules have equal specificity, so the
  winner is whatever order rspack emits — a coin flip that looks fine until a
  rebuild.
- **Flag-message state is tagged with the country id and derived, not reset in an
  effect.** The panel does not remount on a selection change; only the keyed
  children do.
- **Plaque `.flagImage` moves to `object-fit: contain` with the country colour
  behind it.** `cover` crops a 2:1 flag's left and right ends, which is where the
  charge usually is.
- **The panel imports only its own CSS module.** `panel-bodies.module.css` stays
  for T10 and T12; twenty repeated lines beat three panels overriding one sheet.

## Traps found in the existing code

- `src/scaffold.test.ts:155` rejects any inline `export` keyword and any
  `export type { … }`. Write `export { type Foo };` at the end of the file.
- `updateCountry` deliberately does **not** copy `provinceIds` — `label-store`
  validates its anchor cache on that array's identity. Do not "fix" it.
- `useFieldCommit`'s window is FIXED, not restarting, and `use-field-commit.test.ts`
  fails if it is made restarting. Do not change 200 ms or 400 ms.
- Every field call site must keep `key={"<field>-" + country.id}`.
- `image.test.ts:10` passes `FLAG_MAX_EDGE` a 100x80 input; it holds at 384.
- `countryAggregates` is already the cache. Never call `aggregateCountry` from a
  component.

## Not done here, still open

- Province fields and the virtualised list (T10); economics (T11/T12).
- Country colour, creation, deletion and assignment stay in the left panel.
- No new storage key, schema field or migration.
- **Left open from T08's review:** the plaque/panel-dock overlap between roughly
  900 and 1200 px, and `.hud`'s `max-width` below roughly 760 px. Both are shell
  chrome shared by all three panels, so §12 keeps them out of T09.
- The resize ratchet in `VISUAL-CHECK-PHASE2.md` §3.1 — a view-store policy call.
- `README.md` — the docs agent owns it.

---

## Implementation (attempt 1)

Followed `DESIGN.md` literally. No deviation from §1's file list except one HTML-validity
fix noted below.

### Files created

- `src/ui/country-overview.ts` — the panel's pure half: `groupDigits`, `formatArea`,
  `formatProvinceCount`, `formatBytes`, `loreCounterText`, `saveNoticeFor`, `LORE_COUNTER_AT`.
- `src/ui/country-overview.test.ts` — 13 tests over the above, including every row of the
  §4.4 warning table.
- `src/ui/country-overview.module.css` — `.empty`, `.notice`, `.flagPreview`, `.counter`,
  `.facts`, `.factList`, `.factsTitle`, `.fact`, `.factTerm`, `.factValue`. Tokens only.

### Files changed

- `src/state/schema.ts` — added `countryDisplayName(id, name)`; `createCountry` routes its
  name through it; added to the grouped export.
- `src/state/schema.test.ts` — +2 tests (`countryDisplayName`, `createCountry` fallback).
- `src/state/image.ts` — `FLAG_MAX_EDGE` 256 -> 384, with the reason in a comment.
- `src/state/label-store.ts` — label text goes through `countryDisplayName`, so clearing a
  name no longer deletes the map label.
- `src/state/world-store.test.ts` — +1 test: a flag write under a throwing storage keeps the
  flag in memory, and removing it saves and clears the warning.
- `src/ui/ImageUpload.tsx` — four optional props (`chooseLabel`, `replaceLabel`, `hint`,
  `previewClassName`); `hasImage` extracted; hint paragraph before the error paragraph.
  No restructuring of the request counter, `mountedRef`, `MAX_UPLOAD_BYTES` or `onError`.
- `src/ui/fields.module.css` — `.status[data-kind="warn"]` and `.hint`.
- `src/ui/CountryOverviewPanel.tsx` — rewritten body: notice, flag, name, slogan, lore,
  lore counter, Territory facts. Tagged `FlagState`, store read-back after a flag commit,
  `flushState()` on flag commit and removal only.
- `src/ui/CountryPlaque.tsx` — name through `countryDisplayName`; the country colour is now
  behind the flag box unconditionally.
- `src/ui/country-plaque.module.css` — `.flagImage` `object-fit: cover` -> `contain`.
- `src/ui/CountryPanel.tsx` — the row's name input gains
  `placeholder={countryDisplayName(props.countryId, "")}`.

### One deviation from the design

§5.5 draws the facts as a `<dl>` whose first child is `<p class="factsTitle">`. A `<dl>` may
only contain `dt`, `dd` and `div`, so the heading moved outside: a `<section class="facts">`
now wraps the `<p>` and a `<dl class="factList">`. Same visual result, valid markup, one
extra class.

### Verification — real output

`yarn typecheck` — exit 0, no output.

`yarn test`:

```
ℹ tests 537
ℹ suites 0
ℹ pass 537
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 663.304084
```

The brief's "493 existing tests" figure is stale. The measured baseline on this branch,
with every T09 change stashed and the new test file moved aside, is:

```
ℹ tests 521
ℹ pass 521
ℹ fail 0
```

521 + 13 (country-overview) + 2 (schema) + 1 (world-store) = 537. No existing assertion was
weakened, reworded or deleted.

`npx tsx --test src/ui/country-overview.test.ts src/state/schema.test.ts src/state/world-store.test.ts`:

```
ℹ tests 51
ℹ pass 51
ℹ fail 0
ℹ duration_ms 126.869
```

`yarn build` — exit 0, only the three known asset-size warnings:

```
WARNING in ⚠ asset size limit: The following asset(s) exceed the recommended size limit (300.000 KiB).
  │   assets/map.png (2.530 MiB)
  │   assets/provinces_map.png (552.626 KiB)
  │   assets/provinces_manifest.json (586.891 KiB)
Rspack compiled with 1 warning in 84 ms
```

`git status --porcelain` shows nothing under `civitas/civitas-map/`.

### Browser checklist — run in Chrome, foreground tab, `yarn dev` on :54457

1. Created a country, painted 10 provinces, opened `COUNTRY`. Panel renders flag box,
   name, slogan, lore, Territory (`10 provinces`, `23,818 px`).
2. Uploaded `assets/country-flag.jpg`. Preview fills the 3:2 box, the button reads
   `REPLACE…`, `REMOVE` appears, the plaque shows the whole flag.
3. `JSON.parse(localStorage["civitas.state.v1"]).countries[0].flagDataUrl` →
   `{"prefix":"data:image/webp;base","chars":35359,"kb":26}`. Under `IMAGE_DATA_URL_MAX`
   (600 000) by 17x. The panel's `flag` fact read `26 KB` — it agrees.
4. Reloaded. Flag, name, slogan and lore all came back; the plaque showed the flag.
5. Typed in Name: the plaque, the map label, the left list and the assign-mode chip all
   followed within a beat.
6. Cleared Name: the field showed `Country 1` greyed, the plaque read `COUNTRY 1`, and the
   **map label was still on the map**, reading `COUNTRY 1`.
7. Picked a `.md` file: `the file is not a readable image` in danger colour under the hint;
   the existing flag stayed on screen and the `flag` fact still read `26 KB`.
8. Quota: filled the origin with ballast until `setItem` threw, removed the flag, then
   uploaded again. The panel notice appeared **immediately**, reading "storage is full, so
   the flag was not saved. it is still shown here; remove it or a province image, and the
   next change will save." The top banner also reported it and the flag stayed on screen.
   Pressing `REMOVE` cleared both, and the stored document then held
   `flagDataUrl: null` with the name, slogan and lore intact. Ballast deleted afterwards.
9. Set Lore to 8000 characters: the counter read `the lore is full at 8,000 characters`.
10. `read_console_messages` with `onlyErrors`: nothing from the app.

`localStorage.clear()` afterwards, so the next agent starts from an empty document.

### Deliberately left undone

- Province name, lore and image, and the virtualised list — T10.
- Anything economic — T11/T12.
- Country colour, creation, deletion and assignment stay in the left `CountryPanel`.
- No new storage key, schema field or migration. `serializeState`'s shape is unchanged.
- The two shell layout defects T08's review left open (plaque/dock overlap around
  900-1200 px; `.hud`'s `max-width` below ~760 px). Both live in `shell.module.css` and
  `map-canvas.module.css` and affect all three panels equally.
- The resize ratchet in `VISUAL-CHECK-PHASE2.md` §3.1.
- `README.md` — the docs agent owns it.

---

## Tests

The implementation agent had already written 16 cases (13 in `country-overview.test.ts`,
2 in `schema.test.ts`, 1 in `world-store.test.ts`). The tests agent added **10 more**,
all regressions for behaviour T09 introduced and none of it re-testing what was covered.
No existing assertion was weakened, reworded or deleted; no source file was changed.

### Added

`src/ui/country-overview.test.ts` (+5)

- **`saveNoticeFor` decides for every `WarningKind`.** The expectation table is typed
  `Record<WarningKind, SaveNoticeKind | null>`, so adding a kind in `persistence.ts`
  fails `yarn typecheck` in the test. That matters because the switch has no catch-all:
  a new kind would fall through to `null` and the panel would go quiet about a real
  failure. Also asserts the two `quota` texts differ, which is the only branch
  `afterFlagWrite` controls.
- **`formatBytes(dataUrlBytes(url))`.** The two halves were tested apart; the `flag`
  fact is the composition. Pins the sub-kilobyte floor ("1 KB", never "0 KB" for a flag
  that is on screen) and the T05 measured 35 359-char WebP reading `26 KB`.
- **The lore counter is tied to `LORE_MAX`**, not to a copy of 8000: threshold 7200,
  `"800 characters left"` at it, `8,000` in the full message.
- **The largest area the map can produce**: 3653 x 2855 = `"10,429,315 px"`, eight
  digits with no stray leading comma.
- **Panel wiring, by source text.** `flushState()` and `countryById.peek()` are both
  present, `countryById.value` is absent, `maxEdge={FLAG_MAX_EDGE}` is passed, no
  `FileReader`/`toDataURL`/`createObjectURL`, and all four fields keep
  `key={"<field>-" + country.id}`. Every one of these is silent when removed and none
  is reachable without jsdom, which is the only reason a source assertion earns its
  place. Precedent: `src/scaffold.test.ts` already reads source files.

`src/state/world-store.test.ts` (+2)

- **DESIGN 8.3, the silent drop.** A data URL one character over `IMAGE_DATA_URL_MAX`
  leaves the previous flag in place, arms no timer, and is detected only by the
  read-back expression `CountryOverviewPanel.onFlag` runs. A legal URL reads back equal,
  so the check does not cry wolf.
- **DESIGN 8.10, the emptied name.** `""` stays `""` in memory and on disk; a reload
  produces `"Country 1"`, which equals `countryDisplayName(id, "")` — memory and disk
  agree. A whitespace-only name is stored verbatim (no silent edit) and still displays
  as the fallback.

`src/state/image.test.ts` (+2)

- **`FLAG_MAX_EDGE` is 384** and covers the 288 px preview; the 735 x 490 sample flag
  fits to 384 x 256; a 2:1 ensign stays 2:1. Nothing pinned 256 before, so nothing would
  have caught a revert.
- **`PROVINCE_IMAGE_MAX_EDGE` is still 320** — T10's constant, and T09 promised not to
  move it.

`src/state/label-store.test.ts` (+1)

- **A cleared name cannot drop the label off the map.** `loadPhase` never reaches
  `"ready"` in Node, so `countryLabelSources` cannot be exercised; the test asserts the
  source derives its text through `countryDisplayName(country.id, country.name)`, and
  that the fallback is non-empty for every whitespace name a user can type — including
  `U+00A0`, which `trim()` does remove.

### Not covered, and why

- The `.tsx` panels. There is no jsdom in the repo and adding one is a task of its own
  (DESIGN §12). The logic worth testing already lives in `country-overview.ts`.
- `downscaleImage`. It needs `createImageBitmap` and a canvas; the browser checklist in
  §11 is its gate.
- `countryLabelSources` end to end. It needs a loaded manifest, which Node cannot give
  it — the same limit `label-store.test.ts` recorded in T07.

### Known, left alone

`groupDigits` produces garbage for a value large enough that `String(n)` uses exponent
notation (`1e21` -> `"1e,+21"`). Unreachable: the largest number it ever sees is the
map's 10,429,315 pixels, and the lore cap is 8000. Not worth a guard, and not worth a
test that would enshrine the garbage.

### Verification — real output

`yarn typecheck` — exit 0, no output.

`yarn test`:

```
ℹ tests 547
ℹ suites 0
ℹ pass 547
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 668.043792
```

537 before, 547 after: +10, 0 failing.
