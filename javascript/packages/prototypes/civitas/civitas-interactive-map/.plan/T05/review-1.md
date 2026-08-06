# T05 review 1 — persistent state store

Verdict: **ACCEPTED**. Zero blocking items.

Reviewer ran every command itself. Nothing below is taken from `memory.md`.

## Commands, regenerated

Run from `javascript/packages/prototypes/civitas/civitas-interactive-map`:

| Command | Exit | Result |
|---|---|---|
| `yarn typecheck` | 0 | no output |
| `yarn test` | 0 | `tests 245  pass 245  fail 0` (duration 516 ms) |
| `yarn build` | 0 | the 2 pre-existing asset-size warnings only; `dist/84.37e5f932b7b1a078.js` (T04 worker chunk) still emitted beside `dist/main.d93619941fa3d7c8.js` |

Test arithmetic checks out. New files carry 16 + 6 + 15 + 16 + 6 = 59 `test(` calls
(`schema`, `migrations`, `persistence`, `world-store`, `image`), and 245 - 59 = 186,
which is the pre-T05 baseline.

## Hard-failure checks

**`../civitas-map` untouched.** `git status --porcelain -- .../civitas-map/` prints nothing.

**No existing test was weakened or deleted.**
`git diff --name-only -- '.../src/**/*.test.ts'` prints nothing. Every T05 test file is
new and untracked. The only tracked source files changed are `src/App.tsx` (+22 lines,
nothing removed) and `src/app.module.css` (+46 lines, nothing removed). `.plan/PLAN.md`
and `.plan/T04/memory.md` also carry diffs, but both are T11-rulebook edits from the
orchestrator, not T05's work.

**Style — `javascript/CLAUDE.md`.** All clean.
- `grep -rn "^export type" src/` → nothing.
- `grep -rn "^export (const|let|var|function|class|interface|type|enum|async|default)" src/` → nothing.
  Every new file ends with one grouped named export (`schema.ts:465`, `migrations.ts:82`,
  `persistence.ts:381`, `world-store.ts:593`, `image.ts:152`), and types are written
  `type Foo` inside the group, which is what `src/scaffold.test.ts` requires.
- `grep -rn "'" src/state/ src/App.tsx src/app.module.css` → every hit is an apostrophe
  inside a comment or a double-quoted string.
- No single-line `if`/`else`/loop anywhere in the new files; every body is braced on its
  own line.
- CSS: one declaration per line throughout the new `.warning`, `.warningText`,
  `.warningDismiss` rules. Every custom property used (`--accent-dim`, `--border-strong`,
  `--danger`, `--bg-panel`, `--mono`, `--radius`, `--text`, `--text-dim`, `--border`)
  exists in `src/index.css:1-16`.

## Brief coverage

| Brief clause | Where | Verified |
|---|---|---|
| Sparse province overrides | `schema.ts:192-208` | An override with no surviving field is omitted entirely. Probed directly: 1648 empty overrides serialise to **0** keys. |
| Country shape `{name, slogan, lore, flagDataUrl, provinceIds[], colorHex}` | `schema.ts:41-49` | Exact. |
| Per-country economics slot, loose shape | `schema.ts:57-60` | `{ version, data: JsonRecord }`, opaque JSON bag. |
| Single versioned key + schema version inside | `persistence.ts:14`, `schema.ts:10` | `civitas.state.v1` is a namespace; `version` lives in the document. |
| Debounced writes | `persistence.ts:329-379` | Fixed-window trailing debounce, 400 ms. |
| Flush on pagehide | `world-store.ts:240-268`, `App.tsx:33,36` | `pagehide` + `visibilitychange`, listeners removed by the effect cleanup — no leak. |
| Migration hook, chain shipped empty but exercised | `migrations.ts:22`, `migrations.test.ts:36-51`, `persistence.test.ts:165-183` | Two-step synthetic chain runs in order and feeds each step the previous output. |
| Corrupt payload never crashes | `persistence.ts:170-193` | Parse throw, non-object and bad `version` all return an empty state + `corrupt` warning. |
| Warning signal the UI renders | `world-store.ts:76-78`, `App.tsx:48-55` | Banner with a dismiss button; `App` already calls `useSignals()` at `App.tsx:26`. |
| `downscaleImage(file, maxEdge, quality)` | `image.ts:90` | Present, all DOM calls inside the body. |
| QuotaExceededError caught, state kept, warning set, never throws into render | `persistence.ts:288-295`, `world-store.ts:153-162` | Verified by `world-store.test.ts:225-252`. |
| Storage injected, tests pass a fake | `persistence.ts:29-33`, `world-store.ts:185-229` | Every persistence function takes storage as its first argument; only `defaultStorage` reads a global, inside a `try`. |
| Round-trip / sparse / migration / corrupt / quota all unit tested | see above | All five present and non-vacuous. |

## Bug hunt

Nothing found that is wrong. Specifically checked and clean:

- **Stale closures over signals.** `writeNow` (`world-store.ts:133`) reads the module-level
  `storage` at call time, so a re-init cannot make the writer target the previous storage.
  `initWorldStore` cancels the old writer first (`world-store.ts:188-191`).
- **Container identity.** Every action replaces its `Map`/array rather than mutating it
  (`world-store.ts:300`, `451`, `471`, `562`, `584`), so subscribers actually re-render.
- **Prototype pollution.** `Object.keys` plus the `/^[1-9][0-9]*$/` key test rejects
  `__proto__`; asserted in `schema.test.ts:131-151` through `JSON.parse`, which is the
  only way to build a real own `__proto__` key.
- **Unserialisable values.** Probed a genuine cycle into an economics slot:
  `writeState` returned `{ok:true,bytes:670}` — `sanitizeRecord` strips it before
  `JSON.stringify` is ever reached. No throw.
- **Read-only mode.** A `{"version":99}` document leaves `persistent = false`, `markDirty`
  returns early (`world-store.ts:176`), and `world-store.test.ts:345-363` asserts the
  stored payload is byte-identical after a `flushState()`.
- **`NaN`/`Infinity` ids.** Rejected by `Number.isInteger` at `world-store.ts:281` and
  `496`; asserted at `world-store.test.ts:188-190`.
- **Off-by-one.** `buildCountryAssignment(1650)` gives a `Uint16Array` of length 1651 with
  index 0 zero and 1318 / 1458 zero — the two ids the manifest does not carry
  (`world-store.test.ts:309-327`). `fitDownscale` keeps `Math.max(1, ...)` per axis
  (`image.ts:42-43`), tested on a 1 x 4000 strip.
- **Performance.** Nothing here touches the 10.4 M province pixels. `countryOfProvince`
  is a `computed` over the country list, recomputed only when the list changes, and it
  walks assigned province ids (at most 1648) — not per frame. `hasCountry` and
  `updateCountry` scan the country array linearly, which is a user-built list of tens.
  No new work runs on the render path.
- **Assumptions against PLAN facts.** `normalizeState` does not read the manifest and does
  not validate override ids against a contiguous range, so 1318 / 1458 and the 1..1650
  spread are handled correctly. Country ids are capped at 65535 for the `Uint16Array`.

## Non-blocking observations, for T06+ to inherit knowingly

1. `defaultStorage` (`persistence.ts:108-121`) probes with a real `setItem`. On an already
   full `localStorage` the probe throws, the store falls back to memory, and the user sees
   an empty session with an `unavailable` warning. Their on-disk document is not destroyed
   (`persistent` is false), but the app looks empty. Design-prescribed; worth a nicer
   message later.
2. A corrupt payload over 512 KB is not quarantined (`persistence.ts:130`) and the read
   returns `writable: true`, so the next write overwrites it. Deliberate — quarantining a
   4 MB payload would double usage — but it is a data-loss path for large corruption.
3. `normalizeState` silently drops a `provinceOverrides` or `economics` container that is
   not a plain object, with no repair note (`schema.ts:249`, `369`). Verified by probe:
   `provinceOverrides: [1,2,3]` yields `repairs: []`. Harmless, slightly under-reported.
4. `downscaleImage` has no Node test — there is no jsdom and no `createImageBitmap`.
   The design accepts this and names the browser check as its gate. T09/T10 own the upload
   path and are what actually make flags and previews downscaled rather than raw.
