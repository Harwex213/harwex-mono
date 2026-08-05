# T09 review 1 — country overview panel

Adversarial review. Commands re-run by the reviewer, not taken from `memory.md`.

## Verdict

**Accepted. Zero blocking items.**

## Commands, real output

| Command | Result |
|---|---|
| `yarn typecheck` | exit 0, no output |
| `yarn test` | `tests 537 / pass 537 / fail 0`, duration 602 ms |
| `yarn build` | exit 0, one warning — the three known oversized assets (`map.png`, `provinces_map.png`, `provinces_manifest.json`) |
| `git status --porcelain -- .../civitas-map` | empty |

`memory.md`'s 537 figure reproduces exactly.

## Scope

- `civitas-map` is untouched — `git status --porcelain` on that directory prints nothing.
- The changed set matches `DESIGN.md` §1 exactly. Nothing under `src/map/`,
  `src/ui/render.ts`, `border-layer.ts`, `label-layer.ts`, `MapCanvas.tsx`,
  `persistence.ts`, `migrations.ts`, `borders-store.ts`, `assign-store.ts`,
  `selection-store.ts`, `use-field-commit.ts`, `EditableText.tsx` or
  `EditableTextArea.tsx` was modified.
- `.plan/PLAN.md` and `.plan/T11/` carry T11 rulebook work, unrelated to this task.

## Tests

`git diff HEAD -- src/state/schema.test.ts src/state/world-store.test.ts` is additive only:
two new `test()` blocks in `schema.test.ts` and one in `world-store.test.ts`. No existing
assertion was deleted, reworded or loosened. `src/ui/country-overview.test.ts` is new,
13 cases, and covers every row of the §4.4 warning table.

## Brief coverage

| Brief clause | Evidence |
|---|---|
| Flag through `downscaleImage` | `ImageUpload.tsx:77` is the only encoder; the panel never touches `FileReader` / `toDataURL` (`CountryOverviewPanel.tsx:111-120`) |
| Max edge respecting aspect ratio | `image.ts:11` `FLAG_MAX_EDGE = 384`; `fitDownscale` scales the long edge only (`image.ts:36-48`) |
| Show / replace / remove | `ImageUpload.tsx:106-153` |
| Non-image file | `image.ts:96-99` throws, `ImageUpload.tsx:84-92` shows it and keeps the previous value |
| Oversized file | `ImageUpload.tsx:64-69`, checked before any decode |
| Name with a readable fallback | `schema.ts:133-138`, used at `CountryOverviewPanel.tsx:128`, `CountryPlaque.tsx:60`, `label-store.ts:122`, `CountryPanel.tsx:81` |
| Slogan, lore | `CountryOverviewPanel.tsx:135-156`, lore `rows={12}` |
| Read-only province count and pixel area | `CountryOverviewPanel.tsx:161-179`, read from the T06 `countryAggregates` cache — `aggregateCountry` is never called from a component |
| Live plaque and map label | `updateCountry` replaces `countriesSignal` (`world-store.ts:459-461`) without copying `provinceIds` (`world-store.ts:405-411`), so the label anchor cache stays valid and `countryLabelSources` re-derives text only |
| Debounced writes | `flushState()` appears only in `onFlag` (`CountryOverviewPanel.tsx:81`); the three text fields commit through `useFieldCommit` and `markDirty` |
| Quota visible and non-fatal | `saveNoticeFor` `quota` branch (`country-overview.ts:83-96`) plus the new `world-store.test.ts` case: warning `quota`, flag still in `countryById`, `statePersistent` still `true`, nothing written; removal heals it |
| Tokens, no hardcoded colours | every `var(--civ-…)` in `country-overview.module.css` resolves in `src/ui/theme.css` — checked by name, none missing |

## Bug hunt — nothing found that blocks

- `useSignals()` is present at `CountryOverviewPanel.tsx:44`, and both hooks run before the
  `country === null` early return (`:46`, `:52`), so hook order is stable.
- `ImageUpload`, `EditableText` and `EditableTextArea` correctly do **not** call `useSignals()`.
- No stale closure: `onFlag` uses `country.id` only, and `ImageUpload` carries
  `key={"flag-" + country.id}`, so an in-flight upload cannot land on another country.
  The `mountedRef` unmount guard and the `requestRef` counter (`ImageUpload.tsx:78`, `:85`)
  discard superseded results.
- The flag message is tagged with the country id and derived, not reset in an effect
  (`CountryOverviewPanel.tsx:65`), so no message crosses a selection change.
- The silent-rejection read-back uses `.peek()` (`:76`), so the handler does not subscribe.
- No listener is added or leaked by this task.
- No per-render work scales with 1648 provinces or 10.4M pixels. The panel renders no
  province list. The heaviest per-render call is `dataUrlBytes` on a ~35 000-char string
  (`:88`) — a regex test and one slice.
- Keystrokes do not re-render the panel: `useFieldCommit` holds the draft locally and
  commits on the fixed 200 ms window.

## Non-blocking observations, for the record

1. `CountryOverviewPanel.tsx:41` — the hint advertises `svg`, but `createImageBitmap` on an
   SVG blob is rejected by Chrome and Safari, so an SVG pick surfaces
   "the file is not a readable image". Degrades gracefully; the wording overpromises.
2. `CountryOverviewPanel.tsx:88` — `dataUrlBytes` returns *decoded* bytes. The real
   localStorage cost is about 2.7x that, because the base64 payload is stored as UTF-16.
   The `flag` fact therefore understates the number the quota notice asks the user to reduce.
3. `country-overview.ts:67` — `loreCounterText(max - 1, max)` reads "1 characters left".
4. `fields.module.css` `.status[data-kind="warn"]` is dead: no caller sets that attribute
   on `.status`. The live warn styling is `.notice[data-kind="warn"]` in the panel's module.
5. `CountryOverviewPanel.tsx:97` — `flag.touched` stays true after a *successful* flag
   upload, so a later quota failure caused by a lore keystroke would still read
   "the flag was not saved" until the selection moves.
6. `country-overview.ts:116` — the trailing `return null` after the switch defeats the
   exhaustiveness check the comment claims: a new `WarningKind` will compile and return null
   silently rather than failing the build.
7. `country-overview.module.css:18` — `1px solid var(--civ-danger)` writes the width
   literally where `--civ-border-hair` / `--civ-border-strong` are the established shape.
   The colour is tokenised, so the brief's rule holds.
