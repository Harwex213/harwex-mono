# T05 — think agent handoff

Design: `.plan/T05/DESIGN.md`. The algorithms are written out; follow them literally.

## Decided, with reasons

- **The `v1` in `civitas.state.v1` is a namespace and never changes.** The schema
  version is the `version` field INSIDE the document. Two "v1"s next to each other
  invite the wrong edit; bumping the key would orphan every user's data, which is
  the exact thing the migration chain exists to prevent.
- **`normalizeState` repairs, `parseManifest` throws.** Opposite policies on
  purpose. The manifest is a build artefact where a mismatch is a bug. The state
  document is user data a browser or a previous build may have damaged, and losing
  one malformed override must not lose the other 40.
- **Exported signals are `ReadonlySignal` computeds over private writable
  signals.** An action is then the only way to change state, so no mutation can
  bypass `markDirty()`. The alternative — an `effect` subscribing to everything —
  fires on creation and on hydration and needs a skip-first flag.
- **Fixed-window trailing debounce, not a restarting one.** A restarting debounce
  starves: lore typed at a keystroke every 300 ms postpones the write forever. A
  fixed 400 ms window bounds write latency no matter what the user does.
- **A `Map` for province overrides and economics, an ARRAY for countries.**
  Overrides are sparse and unordered and keyed by an id the caller already holds.
  Countries are an ordered user-built list and the order is user-visible in T06.
- **Three explicit province setters, not one patch object.** A patch needs
  `undefined` to mean "leave" and `null` to mean "clear", and that tri-state is
  what a panel gets wrong.
- **A future-version document puts the store in read-only mode.** The user opened
  an older build in a second tab; wiping their data is the worst possible
  response. `writable: false`, warning, nothing overwritten.
- **`writeState` returns a result and never throws, never retries, never evicts.**
  Silently dropping the image the user just uploaded is worse than telling them
  the save failed. In-memory state survives either way.
- **`utf16Bytes = length * 2`, not `new Blob([text]).size`.** Browsers account
  localStorage in UTF-16 code units; the Blob measurement is UTF-8 and understates
  a base64 payload by up to half.
- **`downscaleImage` always re-encodes, even when it does not resize.** A
  200 x 200 PNG can be 700 KB. Re-encoding bounds the bytes; the resize does not.
- **WebP first with a JPEG fallback**, probed by checking the returned data URL's
  prefix (`toDataURL` silently returns PNG for an unsupported type). WebP keeps
  alpha — a flag with a transparent background turns black under JPEG.

## Constraints inherited from T02-T04 that shaped the shapes

- **Country ids must fit a `Uint16Array`.** `buildCountryOf` in `src/map/borders.ts`
  returns one, so `MAX_COUNTRY_ID = 65535` and id 0 is reserved — index 0 is
  `NO_PROVINCE`. Country ids are therefore small integers, not UUIDs.
- **Province ids run 1..1650 over 1648 provinces; 1318 and 1458 do not exist.**
  Never validate an override id against a contiguous range.
- **`normalizeState` must not read the manifest.** State is read synchronously at
  startup and the map load is async, so `provinceById` returns `null` then. An
  override for a non-existent province id is kept and simply never looked up.
- **T05 does not call `setCountryAssignment`.** It ships
  `buildCountryAssignment(maxProvinceId)`; T06 owns the effect that pushes the
  array to the border worker.

## Traps

- `src/scaffold.test.ts` matches `/^export\s+(const|let|...|type|...)\b/m`. A line
  starting `export type { Foo };` **fails** it. Write `export { type Foo };`.
- `@types/node` is in the program (tsconfig sets no `types` array), so
  `setTimeout` can resolve to the Node overload. Type the handle as
  `ReturnType<typeof setTimeout>`, never `number`.
- Keep every DOM call inside a function body in `image.ts` and `persistence.ts`.
  The test files import both in Node, where `document` and `localStorage` do not
  exist.
- `Array.isArray` must be checked in `normalizeState`. An array is
  `typeof "object"`, and `"[]"` is the payload a half-written document leaves.
- Iterate stored records with `Object.keys` and rebuild every object field by
  field. A spread of the payload carries `__proto__` and `constructor` through.
- A `Map` mutated in place is `Object.is`-equal to itself and no subscriber
  re-renders. Every action replaces the container.
- `defaultStorage` must wrap the **property access** to `globalThis.localStorage`,
  not just `setItem`. Safari with cookies blocked throws on the access itself.
- `isQuotaExceeded` must be duck-typed. `DOMException` is absent in some runtimes
  and Firefox uses `NS_ERROR_DOM_QUOTA_REACHED` / `code: 1014`.
- `fitDownscale` needs `Math.max(1, ...)` per axis. A 1 x 4000 strip rounds its
  short edge to 0 and `drawImage` then throws.
- `noUnusedLocals` + `noUnusedParameters` are on. `App.tsx` gains four imports;
  none may be left unused.

## Highest-value checks

1. **The sparse test.** A state with 2 overrides out of 1648 provinces must
   serialise to exactly 2 keys and under 1 KB. That is the brief's own condition
   and the one a lazy implementation fails.
2. **`normalizeState(serializeState(state))` deep-equals the original**, with
   every field populated including a data URL and nested economics. It pins the
   two functions against each other in one assertion.
3. **The future-version test** must assert the stored payload is byte-identical
   after a `flushState()`. A store that clobbers a newer document loses data
   silently and no other test catches it.

---

## Implementation (attempt 1)

Design followed literally. Two deliberate departures, both noted below.

### Files created

| File | What it is |
|---|---|
| `src/state/schema.ts` | Types, caps, `createEmptyState`, `createCountry`, `defaultCountryColor`, `serializeState`, `normalizeState`, `sanitizeJson` / `sanitizeRecord`. Pure. |
| `src/state/migrations.ts` | `Migration`, empty `MIGRATIONS`, `assertChain`, `runMigrations`. Pure. |
| `src/state/persistence.ts` | `StateStorage`, `createMemoryStorage`, `defaultStorage`, `readState`, `writeState`, `isQuotaExceeded`, `utf16Bytes`, `createStateWriter`. |
| `src/state/world-store.ts` | Signals, actions, the mutation-to-write wiring, `buildCountryAssignment`. |
| `src/state/image.ts` | `fitDownscale`, `dataUrlBytes` (pure), `downscaleImage` (DOM inside the body). |
| `src/state/schema.test.ts` | 16 tests. |
| `src/state/migrations.test.ts` | 6 tests. |
| `src/state/persistence.test.ts` | 15 tests. |
| `src/state/world-store.test.ts` | 16 tests. |
| `src/state/image.test.ts` | 6 tests. |

### Files changed

| File | Change |
|---|---|
| `src/App.tsx` | `initWorldStore()` + `installStateFlush()` in the mount effect; the warning banner with a dismiss button. 22 added lines, nothing removed. |
| `src/app.module.css` | `.warning`, `.warning[data-kind=...]`, `.warningText`, `.warningDismiss`. |
| `README.md` | A "Persistent state" section and five rows in the file table. |

Nothing else touched. No dependency added. `../civitas-map` untouched.

### Departures from the design

1. **`readState` takes an optional `targetVersion`** (default `STATE_VERSION`).
   Without it the migration branch is UNREACHABLE: `STATE_VERSION` is 1 and
   `readState` already rejects any `version < 1` as corrupt, so no stored document
   can legally be older than the target. The design's persistence tests 7 and 8
   ("an older document is migrated", "an unmigratable version") could not be
   written at all. The parameter is the same kind of seam as `chain`, production
   never passes it, and both tests now exist and both kill mutants.
2. **`addCountry` past `MAX_COUNTRY_ID` raises a `quota` warning**, not a new
   warning kind. The design fixes the `WarningKind` union and none of the seven
   members names a capacity limit; `quota` is the closest in meaning and adding a
   member would have widened a type the design pinned.

### Verification — real output

```
$ yarn typecheck
(no output, exit 0)

$ yarn test
i tests 245
i suites 0
i pass 245
i fail 0
i cancelled 0
i skipped 0
i todo 0
i duration_ms 497.282875

$ yarn build
WARNING in (warn) asset size limit: The following asset(s) exceed the recommended size limit (300.000 KiB).
  | Assets:
  |   assets/map.png (2.530 MiB)
  |   assets/provinces_map.png (552.626 KiB)
  |   assets/provinces_manifest.json (586.891 KiB)

Rspack compiled with 1 warning in 79 ms
```

Baseline before T05 was 245 - 59 = 186 pass / 0 fail. Every one of the 186 still
passes. The build warning is the pre-existing asset-size one, unchanged. `dist/`
still carries the separate worker chunk (`dist/84.37e5f932b7b1a078.js` beside
`dist/main.d93619941fa3d7c8.js`).

Style self-check:

```
$ grep -rn "'" src/state/ src/App.tsx src/app.module.css
(18 hits, every one an apostrophe inside a comment or a double-quoted string)

$ grep -rn "^export type" src/state/
(nothing)
```

### Mutation check

Each mutant applied to the source alone, `yarn test` run, source restored, and a
`shasum -a 256` before/after proving every file is byte-identical again. Script:
`scratchpad/t05-mutate.py`.

```
sort dropped                     OK       fail=1
empty override kept              OK       fail=1
http image accepted              OK       fail=3
one-owner strip removed          OK       fail=1
future version cleared           OK       fail=2
quota name-only                  OK       fail=1
restarting debounce              OK       fail=1
markDirty ignores persistent     OK       fail=1
fitDownscale without max(1)      OK       fail=1
--- restored ---
src/state/schema.ts      be14a3cb8f553bcac181191ca493c11e4399a31f01a3cb79ab68fefc5536cf7b same
src/state/persistence.ts 6a92379c231fc9ca2af4ecda636f1068717b58da165662c97a2f9baaf9cada5d same
src/state/world-store.ts 23f6135233f78fa10bc97ae07d12d998e62f7c32c1181d9646a7c5b74b6dec24 same
src/state/image.ts       5bc24daf1bcb8ab69c465b09a050847e1df9a5b6bd349da90248989db0ec6f07 same
```

`restarting debounce` SURVIVED on the first run, exactly as the design predicted.
`armed()` cannot tell a fixed window from a restarting one, because both leave one
timer armed. Fixed by adding `setCalls()` to the fake timers and asserting that
five `schedule()` calls arm exactly ONE timer. The mutant then died.

### Browser checks — both ran, in Chrome, against `yarn dev`

A temporary probe in `App.tsx` exposed the store on `window.t05`. Reverted after;
`shasum -a 256 src/App.tsx` is `09a36d49d866e526784677ff95351fa296c1ea7c5e3ac91eb0630c630e51776a`
before the probe and after the revert, and `git diff --stat src/App.tsx` shows the
22 T05 lines only.

1. **Persistence survives a reload, and stays sparse.**
   `setProvinceName(1, "Verified")` + `addCountry("Testland")`:
   ```
   {"writtenBeforeDebounce":"nothing (correct)","bytes":212,"version":1,
    "overrideKeys":["1"],"overrideCount":1,"province1":{"name":"Verified"},
    "countries":[{"id":1,"name":"Testland","slogan":"","lore":"","flagDataUrl":null,
                  "provinceIds":[],"colorHex":"#c0563f"}],"nextCountryId":2}
   ```
   212 characters, ONE province key, not 1648. Nothing written before the 400 ms
   window closed. After a reload:
   ```
   {"hydratedOverrides":[[1,{"name":"Verified"}]],
    "hydratedCountries":[{"id":1,"name":"Testland","colorHex":"#c0563f"}],
    "warningBannerText":null}
   ```

2. **`downscaleImage` on the real asset.** `assets/country-flag.jpg`, 100 307 bytes,
   735 x 490:
   ```
   {"mime":"data:image/webp","decodedBytes":13066,"decodedKB":13,"urlChars":17447}
   {"dimensions":"256x171","storedFlagMatches":true,"documentBytes":17657,
    "documentKB":34,"warningBanner":null}
   ```
   WebP was accepted, so the JPEG fallback did not fire. 98 KB -> 13 KB, 256 x 171
   as predicted. The whole document with the flag is 34 KB and raised no warning.

3. **Extra, not asked for: the corrupt path end to end.** Seeded `"{not json"` and
   reloaded:
   ```
   {"bannerKind":"corrupt",
    "bannerText":"the saved state could not be parsed (Expected property name or '}' in JSON at position 1 ...)dismiss",
    "quarantined":"{not json","appStillRendersCanvas":2,"afterDismiss":"gone"}
   ```
   The app rendered both canvases, the payload was quarantined, and dismiss cleared
   the banner. localStorage was cleaned up afterwards.

### Left undone, on purpose

- `setCountryAssignment` is NOT wired. T06 owns the effect;
  `buildCountryAssignment(maxProvinceId)` is what it calls.
- `applyDemoCountries` / `clearDemoCountries` in `borders-store.ts` are untouched.
  T04's HUD still needs them; T06 deletes them.
- `MIGRATIONS` ships empty. The runner is exercised by a synthetic chain in both
  `migrations.test.ts` and `persistence.test.ts`.
- No upload UI, no panels, no export/import, no cross-tab sync, no undo.
- `downscaleImage` has no Node test — no jsdom, no `createImageBitmap`. Browser
  check 2 above is its only gate, and it ran.

### For the next agent

- Reset the store in any new test with
  `initWorldStore({ storage: fakeStorage(), timers: fakeTimers() })`. It is a
  module singleton; there is no other reset.
- `provinceOverrides`, `countries`, `economics`, `countryById`, `countryOfProvince`
  are `ReadonlySignal`s. Assigning to them is a type error, which is the point —
  go through an action so `markDirty()` runs.
- An action skips its signal write when the value is unchanged. Do not add a
  second guard at the call site.
- Country id 0 is never allocated and province id 0 is `NO_PROVINCE`. Both are
  rejected by every setter.

---

## Tests

No production code was changed. Every existing assertion is untouched — the
implement agent's 59 tests all still pass, and the three sources come back
byte-identical after the mutation run (hashes below match the ones recorded
above).

### Added: 26 tests in 3 new files

The implement agent's five test files cover the design's own list. These three
cover what that list states in prose but never pins: the exact character at which
a cap bites, the exact nesting level at which the depth budget runs out, the
recovery paths that need a failing storage, and the lifecycle window before
`initWorldStore` has ever run.

| File | Tests | What it pins |
|---|---|---|
| `src/state/schema-limits.test.ts` | 9 | Cap and depth boundaries, palette wraparound, ids the manifest lacks. |
| `src/state/persistence-recovery.test.ts` | 8 | Quarantine guards, the repair-note cap, a serialisation that throws, both localStorage refusals. |
| `src/state/world-store-lifecycle.test.ts` | 9 | Pre-init, no-localStorage boot, re-init, the budget and country ceilings. |

`world-store-lifecycle.test.ts` is a SEPARATE file on purpose. The store is a
module singleton and `tsx --test` gives each file its own process, so this is the
only way to observe a store that has never been initialised. **Its first test
must stay first**; a comment in the file says so.

### Covered

**Boundaries (`schema-limits.test.ts`).**
- `defaultCountryColor` cycles with period 16; id 17 wraps to the first colour;
  the `Math.abs` guard answers a hostile 0, -5 or -0.5 instead of `undefined`.
- `createCountry` names an unnamed or empty-named country `"Country N"` and
  clamps an over-long one.
- `clampText` leaves a string of exactly `NAME_MAX` alone and cuts at `MAX + 1`.
- `isImageDataUrl` accepts exactly `IMAGE_DATA_URL_MAX` chars and refuses one
  more; refuses `data:text/html`, `http:`, `""`, `null` and a number.
- Country `slogan` and `lore` are capped on load, not just a province's.
- A hostile `nextCountryId` (9e15, negative, fractional) is clamped to
  `MAX_COUNTRY_ID + 1` — an id past 65535 truncates inside the `Uint16Array`.
- `sanitizeJson` carries **exactly 8** object levels and empties the 9th, stated
  as a shape equality rather than a substring grep, so an off-by-one in either
  direction fails. A primitive still survives at depth 0; an object does not.
- `serializeState` sanitises economics at write time: NaN, +/-Infinity and an
  over-deep branch never reach the document, and a NaN inside an array is removed
  rather than turned into a null hole.
- An override for province **1318, 1458 or 1650** survives. 1648 provinces span
  ids 1..1650 and two of those ids do not exist, but state is read before the
  manifest loads, so `normalizeState` must not check — and this test fails if a
  later agent "fixes" that.

**Recovery (`persistence-recovery.test.ts`).**
- The quarantine size guard, asserted on both sides: a corrupt payload of exactly
  524288 chars is copied to `civitas.state.v1.corrupt`, one character more is not.
- A quarantine whose own `setItem` throws still returns a `corrupt` read and
  never raises.
- Corrupt stays `writable: true` — the app replaces the garbage on the next edit.
  That is the opposite of the `future` path and the pair is asserted together.
- All six repair categories fire at once, one aggregated note each (never one per
  record), and `readState` cuts the joined note at 200 chars with a trailing
  `"..."`. The test proves the joined length exceeds 200 first, so the cap
  assertion cannot pass vacuously.
- `readState` honours an injected clock and a custom key, and still quarantines
  to the FIXED corrupt key.
- `writeState`'s reported bytes include the key's own characters: four more key
  characters is exactly eight more bytes.
- A `serializeState` that throws (a throwing getter on an override) returns
  `{ ok: false, reason: "unavailable" }` and leaves the key untouched.
- `defaultStorage` in Node, plus BOTH browser refusals, simulated by installing a
  fake `globalThis.localStorage`: one that throws on the probe write (Safari
  private mode) and one that throws on the **property access** (Safari with
  cookies blocked). The global is restored and the restoration is asserted.

**Lifecycle (`world-store-lifecycle.test.ts`).**
- A mutation before `initWorldStore` is kept in memory, writes nothing and throws
  nothing; `flushState()` is a no-op with no writer; `installStateFlush()`
  returns a callable no-op outside a browser.
- A boot with no injected storage takes the no-localStorage path: `unavailable`
  warning, `statePersistent` false, and a mutation arms NO debounce timer.
- A re-init cancels the previous document's pending write — the old timers fire
  and neither the old nor the new storage receives anything.
- The `budget` warning fires past `STORAGE_BUDGET_BYTES` (four capped images),
  nothing is auto-deleted, and a later write back under the line clears it.
- The country ceiling: `nextCountryId` at 65536 makes `addCountry` warn and hand
  back the last country rather than grow the list or crash.
- `assignProvinces` arms no timer for an empty list, an all-invalid list
  (0, -1, 1.5, NaN, Infinity) or the same set in a different order; an id naming
  no country still strips the province from its owner, so the one-owner invariant
  holds even for a bad call.
- `deleteCountry`, `clearProvinceOverride` and a rejected image on absent data all
  write nothing.
- An economics slot keeps its OWN version (3) across `setCountryEconomics` and
  `patchCountryEconomics`. A reset to 1 would make a future T11 economics
  migration run twice or not at all.
- `updateCountry` clamps name and lore, skips a patch that changes nothing after
  clamping, and can clear a flag with `null`.

### NOT covered, and why

- **`downscaleImage`.** It needs `createImageBitmap`, `document` and
  `canvas.toDataURL`. There is no jsdom and PLAN section 4 forbids DOM tests. Its
  only gate is the implement agent's browser check, which ran (98 KB JPEG ->
  13 KB WebP at 256x171).
- **The warning banner in `App.tsx`.** A React component; no renderer in this
  repo. The signal it reads is covered; the markup is not.
- **`installStateFlush`'s real listeners.** Only the Node branch (the no-op) is
  reachable here. `pagehide` / `visibilitychange` need a browser.
- **Two tabs.** DESIGN section 9 case 12 declares cross-tab sync out of scope, so
  there is nothing to regress against.
- **A real `localStorage` quota.** Simulated by a throwing `setItem`; the real
  ~5 MB limit is a browser property, not a testable one.
- **The 400 ms wall clock.** Timers are injected everywhere. `DEBOUNCE_MS` itself
  is a constant no test asserts a real delay on.

### Mutation check — 18 mutants, all killed

Each applied to the source alone, `yarn test` run, source restored. Script:
`scratchpad/t05-tests-mutate.py`. Every one of these is killed by a test added in
this pass, not by a pre-existing one.

```
abs guard dropped                    OK        fail=1
clampText off by one                 OK        fail=5
image cap inclusive                  OK        fail=2
depth off by one                     OK        fail=1
nextCountryId unclamped              OK        fail=1
economics unsanitised on write       OK        fail=1
quarantine size guard dropped        OK        fail=1
quarantine unguarded                 OK        fail=1
repair note untruncated              OK        fail=1
write bytes exclude the key          OK        fail=1
no probe write                       OK        fail=1
localStorage read outside try        OK        fail=1
re-init keeps the old writer         OK        fail=1
no budget warning                    OK        fail=1
country ceiling ignored              OK        fail=1
unknown owner does not unassign      OK        fail=1
economics version reset              OK        fail=1
markDirty without the writer guard   OK        fail=1
--- restored ---
src/state/schema.ts          be14a3cb8f553bca same
src/state/persistence.ts     6a92379c231fc9ca same
src/state/world-store.ts     23f6135233f78fa1 same
```

`markDirty without the writer guard` is the one that proves the pre-init test
earns its own file: with the guard removed the very first test throws, and no
other file in the suite can reach that state.

### Verification — real output

```
$ yarn typecheck
(no output, exit 0)

$ yarn test
i tests 271
i suites 0
i pass 271
i fail 0
i cancelled 0
i skipped 0
i todo 0
i duration_ms 544.857

$ yarn build
WARNING in (warn) asset size limit: The following asset(s) exceed the recommended size limit (300.000 KiB).
  | Assets:
  |   assets/map.png (2.530 MiB)
  |   assets/provinces_map.png (552.626 KiB)
  |   assets/provinces_manifest.json (586.891 KiB)

Rspack compiled with 1 warning in 78 ms
```

245 before, 271 after: +26, 0 failures. The build warning is the pre-existing
asset-size one, unchanged.

Style self-check:

```
$ grep -rn "^export type" src/state/
(nothing)

$ grep -n "'" src/state/schema-limits.test.ts src/state/persistence-recovery.test.ts src/state/world-store-lifecycle.test.ts
(7 hits, every one an apostrophe inside a comment or a double-quoted string)
```

### For the next agent

- The store singleton means test ORDER matters inside a file. Anything that needs
  a store which has never been initialised goes in
  `world-store-lifecycle.test.ts`, first, or in a new file of its own.
- `QUARANTINE_MAX_CHARS` is not exported from `persistence.ts`. Its value (524288)
  is restated as a constant at the top of `persistence-recovery.test.ts`. Change
  one and the boundary test fails, which is the intent.
- `persistence-recovery.test.ts` installs and then deletes a fake
  `globalThis.localStorage`. Any test added after it in that file inherits a clean
  global, and the test asserts as much before finishing.

---

## Docs & commit

Commit: `0823beb0b015e0fda947a6639b205a46501091a4` — "civitas interactive map — T05 persistent state store".

### Verification before committing

All three green on the first run. Nothing needed fixing.

```
yarn typecheck   exit 0 (no output)
yarn test        271 pass, 0 fail
yarn build       exit 0, the same asset-size warning T02 recorded (not silenced)
```

### README

Appended, not rewritten. The implement agent had already written the
`## Persistent state` section. This pass added the parts a consumer needs and
that section stated only in prose:

- The stored `civitas.state.v1` document as a `jsonc` block, with the note that
  an economics slot carries its own `version` separate from the document's.
- A caps table: `NAME_MAX` 120, `SLOGAN_MAX` 160, `LORE_MAX` 8000,
  `IMAGE_DATA_URL_MAX` 600 000, `MAX_JSON_DEPTH` 8, `MAX_COUNTRY_ID` 65535,
  `STORAGE_BUDGET_BYTES` 4 000 000.
- The public surface: 12 signals and 13 actions, named.
- A new `### Warnings` subsection. All seven `WarningKind`s, their cause, and
  what each leaves `statePersistent` at. `quota` keeps persistence on and
  `unavailable` turns it off, and the table says why.
- Three traps: the store is a module singleton reset only by `initWorldStore`,
  and `world-store-lifecycle.test.ts` needs its own process, so its first test
  must stay first.

### Files committed

20 files, all under the package.

```
.plan/T04/memory.md          (T04's own "Docs & commit" addendum, left uncommitted by T04)
.plan/T05/DESIGN.md
.plan/T05/memory.md
.plan/T05/review-1.md
README.md
src/App.tsx
src/app.module.css
src/state/image.test.ts
src/state/image.ts
src/state/migrations.test.ts
src/state/migrations.ts
src/state/persistence-recovery.test.ts
src/state/persistence.test.ts
src/state/persistence.ts
src/state/schema-limits.test.ts
src/state/schema.test.ts
src/state/schema.ts
src/state/world-store-lifecycle.test.ts
src/state/world-store.test.ts
src/state/world-store.ts
```

### Four things a later agent should know

- **The repo index still holds pre-existing staged changes from outside this
  package** (`.yarn/cache` deletions, a skills edit, other prototypes), exactly as
  T04 recorded. The commit was therefore `git commit -F <file> -- <paths>`, a
  path-scoped partial commit. A plain `git commit` would sweep all of it in. Use
  the same form next time.
- **`javascript/yarn.lock` is modified and was NOT committed.** The diff adds a
  `@hw/react-di` workspace entry from `packages/prototypes/ai-slop/`, unrelated to
  this package. T05 added no dependency.
- **`.plan/PLAN.md` and `.plan/T11/` are uncommitted on purpose.** Both are T11
  preparation: the plan's expanded economics decisions, and the rulebook digest,
  the screenshot transcriptions and 40-odd images. They belong to T11's own
  commit, not to a persistence commit.
- **This "Docs & commit" section is itself uncommitted**, because the hash it
  records did not exist when the commit was made. T03 and T04 left theirs the same
  way. Stage `.plan/T05/memory.md` with the next task's commit.
