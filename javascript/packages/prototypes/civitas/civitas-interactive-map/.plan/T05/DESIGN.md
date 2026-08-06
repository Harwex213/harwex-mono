# T05 — persistent state store — DESIGN

Read `javascript/CLAUDE.md` before writing a line. Statements end with `;`. `if`,
`else` and loops always take braces with the body on its own line. Double quotes
only. One grouped named export at the END of each file — and write it as
`export { type Foo };`, never `export type { Foo };`, because
`src/scaffold.test.ts` matches `/^export\s+(const|let|var|function|class|interface|type|enum|async)\b/m`
and a line beginning `export type` fails it.

`noUnusedLocals` and `noUnusedParameters` are on. A leftover import fails
`yarn typecheck`.

---

## 0. What this task is

The state layer under every panel T06 and T09-T12 will build. Four concerns:

1. **Shape.** Sparse province overrides, a country list, a per-country economics
   slot. Pure types plus a repairing normaliser.
2. **Persistence.** One versioned JSON document in one `localStorage` key,
   written on a debounce and flushed on `pagehide`.
3. **Recovery.** Corrupt payload, unknown version, quota exceeded and an
   unavailable `localStorage` must all leave the app running and set a warning
   signal.
4. **Images.** Uploads are downscaled and re-encoded before they enter the
   document, because the whole document has to fit inside ~5 MB.

Everything except two named functions is pure and testable in Node with a fake
storage and a fake timer.

---

## 1. Files

### Created

| File | Responsibility |
|---|---|
| `src/state/schema.ts` | The types, the limits, `createEmptyState`, `serializeState`, and `normalizeState` — the repairing parser. Pure. No DOM, no signals, no storage. |
| `src/state/migrations.ts` | `Migration`, the shipped (empty) `MIGRATIONS` chain, `assertChain`, `runMigrations`. Pure. |
| `src/state/persistence.ts` | `StateStorage`, `createMemoryStorage`, `defaultStorage`, `readState`, `writeState`, `isQuotaExceeded`, `utf16Bytes`, `createStateWriter` (the debounce). Pure apart from one guarded `globalThis.localStorage` read inside `defaultStorage`. |
| `src/state/world-store.ts` | The signals, the actions, and the wiring that turns a mutation into a debounced write. The only file here that imports `@preact/signals-react`. |
| `src/state/image.ts` | `fitDownscale` and `dataUrlBytes` (pure), `downscaleImage` (DOM, all DOM calls inside the function body). |
| `src/state/schema.test.ts` | ~16 tests. |
| `src/state/migrations.test.ts` | ~6 tests. |
| `src/state/persistence.test.ts` | ~15 tests. |
| `src/state/world-store.test.ts` | ~16 tests. |
| `src/state/image.test.ts` | ~6 tests, pure helpers only. |

### Changed

| File | Change |
|---|---|
| `src/App.tsx` | `initWorldStore()` and `installStateFlush()` in the existing mount effect; a one-line warning banner reading `stateWarning` with a dismiss button. Nothing else. |
| `src/app.module.css` | `.warning`, `.warningText`, `.warningDismiss`. One declaration per line. |

Nothing else is touched. `rspack.config.mjs`, `package.json`, `tsconfig.json`,
`index.html`, `assets/`, every T02-T04 module and `../civitas-map` stay as they
are. **No dependency is added.**

### Why one store file and not three

`provinces`, `countries` and `economics` share one document, one dirty flag and
one writer. Splitting them into three files means either three copies of the
persistence wiring or a fourth file they all import, and countries and economics
already reference each other (deleting a country drops its economics slot). One
file, ~330 lines, sectioned by comment.

---

## 2. `src/state/schema.ts`

### Constants

```ts
const STATE_VERSION = 1;

// A country id indexes a Uint16Array in `buildCountryOf` (src/map/borders.ts),
// so 65535 is a hard ceiling, not a style choice.
const MAX_COUNTRY_ID = 65535;

const NAME_MAX = 120;
const SLOGAN_MAX = 160;
const LORE_MAX = 8000;
// Characters, not bytes. 600 000 chars of base64 is ~440 KB of image.
const IMAGE_DATA_URL_MAX = 600000;
const MAX_JSON_DEPTH = 8;

const DEFAULT_COUNTRY_COLORS: readonly string[] = [
  "#c0563f", "#4f7fb5", "#6f9e57", "#b58b3f",
  "#8a5fa8", "#3f9e96", "#b5566f", "#7a8496",
  "#a3572f", "#3f6f9e", "#8fa03f", "#9e6f3f",
  "#6f5fa8", "#3f8f6f", "#a83f5f", "#5f6f7a",
];
```

### Types

```ts
type ProvinceOverride = {
  name?: string;
  lore?: string;
  imageDataUrl?: string;
};

type Country = {
  id: number;
  name: string;
  slogan: string;
  lore: string;
  flagDataUrl: string | null;
  provinceIds: number[];
  colorHex: string;
};

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// Loose on purpose. T11 defines the real field set; T12 renders it. Until then
// anything JSON-safe survives a round trip untouched.
type CountryEconomics = {
  version: number;
  data: { [key: string]: JsonValue };
};

// In memory. Maps for sparse keyed data, an array for the ordered country list.
type CivitasState = {
  provinceOverrides: Map<number, ProvinceOverride>;
  countries: Country[];
  economics: Map<number, CountryEconomics>;
  nextCountryId: number;
};

// On disk. The `Map`s become records keyed by the decimal id, because JSON has
// no map. `version` is the SCHEMA version and is what migrations read.
type StateDoc = {
  version: number;
  provinceOverrides: { [id: string]: ProvinceOverride };
  countries: Country[];
  economics: { [id: string]: CountryEconomics };
  nextCountryId: number;
};

type NormalizeResult = {
  state: CivitasState;
  repairs: string[];
};
```

**Why a Map for overrides and an array for countries.** Overrides are sparse,
unordered and keyed by an id the app already has in hand — a `Map` gives the
numeric key back without `Number(key)` at every read site. Countries are an
ordered list the user builds, and the order is user-visible in T06's panel; an
array is the order. Economics follows overrides: sparse, keyed, unordered.

### Functions

```ts
function createEmptyState(): CivitasState;
```
Fresh containers every call — no shared module-level empty Map. `nextCountryId`
starts at 1. Country id 0 is never allocated; index 0 of the `countryOf` array
is `NO_PROVINCE` (see `src/map/borders.ts`).

```ts
function createCountry(id: number, name?: string): Country;
```
`name` defaults to `"Country " + id`. `slogan` and `lore` are `""`,
`flagDataUrl` is `null`, `provinceIds` is `[]`, `colorHex` is
`defaultCountryColor(id)`.

```ts
function defaultCountryColor(id: number): string;
```
`DEFAULT_COUNTRY_COLORS[(id - 1) % DEFAULT_COUNTRY_COLORS.length]`, with a
`Math.abs` guard so a hostile id cannot produce a negative index.

```ts
function serializeState(state: CivitasState): StateDoc;
```
**This is where sparsity is enforced.** Algorithm:

1. `version: STATE_VERSION`.
2. `provinceOverrides`: iterate the Map. For each entry build a fresh object
   holding only the fields that are present AND non-empty (`name !== ""`,
   `lore !== ""`, `imageDataUrl` a non-empty string). If the resulting object has
   no keys, **omit the province entirely**. Key is `String(id)`.
3. `countries`: map each `Country` to a fresh object with `provinceIds` copied
   and sorted ascending. Sorting is not cosmetic — it makes the serialised
   document stable, so two runs that reach the same state produce byte-identical
   JSON, which is what makes the round-trip test an equality test.
4. `economics`: iterate the Map, key `String(countryId)`, value copied field by
   field with `data` passed through `sanitizeJson`.
5. `nextCountryId`.

Never returns a reference into `state`. A later mutation of the state must not
change a document already handed to `JSON.stringify`.

```ts
function normalizeState(raw: unknown): NormalizeResult;
```
**Never throws.** Repairs rather than rejects, and reports what it repaired. This
is the opposite policy from `parseManifest`, and deliberately so: the manifest is
a build artefact where a mismatch is a bug, while this document is user data that
a browser, an extension or a previous buggy build may have damaged. Losing one
malformed province override must not lose the other 40.

Order of work:

1. If `raw` is not a plain object (null, array, string, number), return
   `createEmptyState()` with one repair note. `Array.isArray` counts as not an
   object.
2. `provinceOverrides`: for each **own enumerable** key (`Object.keys`, so an
   inherited or `__proto__` key cannot reach the loop):
   - key must match `/^[1-9][0-9]*$/` and parse to a safe integer, else skip + note.
   - value must be a plain object, else skip + note.
   - `name`: a string, trimmed of trailing whitespace only? No — keep the string
     verbatim, but truncate to `NAME_MAX` chars. A non-string field is dropped.
     An empty string is dropped (it means "no override").
   - `lore`: same, `LORE_MAX`.
   - `imageDataUrl`: a string starting with `"data:image/"` and at most
     `IMAGE_DATA_URL_MAX` chars. Anything else is dropped + noted. A URL to a
     remote host is dropped: the app has no backend and an `http:` URL in a
     stored document is either corruption or an injection attempt.
   - If nothing survived, the province is not added.
3. `countries`: `raw.countries` must be an array, else `[]` + note. For each entry:
   - a plain object with an integer `id` in `1..MAX_COUNTRY_ID`, else skip + note.
   - a duplicate id: keep the FIRST, skip + note the rest.
   - `name`: string truncated to `NAME_MAX`; a missing or non-string name becomes
     `"Country " + id`.
   - `slogan`, `lore`: strings truncated to `SLOGAN_MAX` / `LORE_MAX`, default `""`.
   - `flagDataUrl`: the same rule as `imageDataUrl`, but `null` when absent or bad.
   - `colorHex`: `/^#[0-9a-f]{6}$/i`, else `defaultCountryColor(id)` + note.
   - `provinceIds`: an array; keep integers `>= 1`; dedupe; **drop any id already
     claimed by an earlier country** + note. Sort ascending. One province has at
     most one owner, and that invariant is enforced here so no consumer has to
     check it.
4. `economics`: `raw.economics` must be a plain object. For each own key:
   - key parses as a positive integer that names a country **kept in step 3**,
     else skip + note. An economics slot without a country is unreachable data.
   - `version`: integer `>= 1`, default 1.
   - `data`: `sanitizeJson(value, MAX_JSON_DEPTH)`; a non-object becomes `{}`.
5. `nextCountryId`: an integer `>= 1`, default 1, then raised to
   `max(nextCountryId, maxKeptCountryId + 1)`. Two countries must never receive
   the same id after a repaired load.

Repairs are short strings for the warning message, e.g.
`"dropped 3 malformed province overrides"`. Aggregate by category rather than one
note per bad record — a document with 1000 bad keys must not build a 1000-entry
array.

**`normalizeState` must not read the manifest.** State is read at startup and the
map load is async, so `provinceById` returns `null` at that moment. An override
for province 1318 (an id the real manifest does not have) is therefore kept. It
is harmless: nothing ever looks it up.

```ts
function sanitizeJson(value: unknown, depth: number): JsonValue | undefined;
```
Returns `undefined` for anything that cannot survive `JSON.stringify` →
`JSON.parse` unchanged: `undefined`, a function, a symbol, a bigint, `NaN`,
`Infinity`, `-Infinity`, and anything at all past `depth` 0. Objects and arrays
are rebuilt with their `undefined` members removed. Own keys only.

---

## 3. `src/state/migrations.ts`

```ts
type MigrationDoc = { [key: string]: unknown };

type Migration = {
  from: number;
  to: number;
  migrate(doc: MigrationDoc): MigrationDoc;
};

// Empty on purpose: version 1 is the first shipped schema. When T11 adds a real
// economics shape and needs to reshape stored documents, bump STATE_VERSION to 2
// and push { from: 1, to: 2, migrate } here.
const MIGRATIONS: readonly Migration[] = [];

function assertChain(chain: readonly Migration[]): void;
function runMigrations(
  doc: MigrationDoc,
  fromVersion: number,
  targetVersion: number,
  chain?: readonly Migration[],
): { doc: MigrationDoc; applied: number[] };
```

`assertChain` throws when a step has `to !== from + 1`, when the steps are not in
ascending `from` order, or when a `from` repeats. It is called at the top of
`runMigrations`, so a malformed chain is a loud programmer error rather than a
silent skip.

`runMigrations` algorithm:

1. `assertChain(chain)`.
2. If `fromVersion === targetVersion`, return `{ doc, applied: [] }`.
3. If `fromVersion > targetVersion`, throw
   `"state version N is newer than this build's M"`. `readState` handles the
   newer-document case before calling, so this is a guard, not a path.
4. Loop while `current < targetVersion`: find the step with `from === current`.
   None → throw `"no migration from state version " + current`. Otherwise
   `doc = step.migrate(doc)`, push `step.from` onto `applied`, `current = step.to`.
5. Return.

`chain` defaults to `MIGRATIONS`. It is a parameter so the test can exercise the
loop with a synthetic two-step chain without shipping a fake migration.

---

## 4. `src/state/persistence.ts`

### The key

```ts
const STATE_KEY = "civitas.state.v1";
const CORRUPT_KEY = "civitas.state.v1.corrupt";
```

**The `v1` in the key is a namespace, not the schema version, and it never
changes.** The schema version lives in the document's `version` field and is what
migrations read. Bumping the key would orphan every user's data — which is the
exact thing the migration chain exists to avoid. This is written in a comment in
the file because the two "v1"s next to each other invite the wrong edit.

### Storage injection

```ts
type StateStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
```

A structural subset of the DOM `Storage` interface, so `window.localStorage`
satisfies it with no adapter and a fake is three methods. Every function here
takes the storage as its first argument; nothing in this file reaches for a
global except `defaultStorage`.

```ts
function createMemoryStorage(): StateStorage;
```
A `Map<string, string>` behind the three methods. Two production uses: the
fallback when `localStorage` is unreachable, and the base every test fake builds
on.

```ts
function defaultStorage(): { storage: StateStorage; available: boolean };
```
`globalThis.localStorage` inside a `try`/`catch`, plus a probe write and remove
of a throwaway key. Safari with cookies blocked **throws on property access**,
and Safari private mode used to accept `setItem` and throw. Both fall back to
`createMemoryStorage()` with `available: false`. In Node `localStorage` is
`undefined`, so the same path runs and the store is testable with no options.

### Reading

```ts
type WarningKind =
  | "corrupt" | "unmigratable" | "future" | "repaired"
  | "quota" | "unavailable" | "budget";

type StateWarning = { kind: WarningKind; message: string; at: number };

type ReadResult = {
  state: CivitasState;
  warning: StateWarning | null;
  // false when a document from a NEWER build was found. The store must not
  // overwrite it.
  writable: boolean;
  bytes: number;
};

function readState(
  storage: StateStorage,
  options?: { key?: string; now?: () => number; chain?: readonly Migration[] },
): ReadResult;
```

Algorithm, and every step returns rather than throws:

1. `raw = storage.getItem(key)` inside `try`/`catch`. A throw →
   empty state, `unavailable` warning, `writable: false`.
2. `raw === null` → empty state, no warning, `writable: true`. A first run is
   not a problem and must not show a banner.
3. `bytes = utf16Bytes(raw)`.
4. `JSON.parse` inside `try`/`catch`. A throw → `quarantine(storage, raw)`,
   then empty state + `corrupt` warning naming the parse error.
5. Not a plain object, or `version` not a positive integer → `quarantine`, empty
   state + `corrupt` warning.
6. `version > STATE_VERSION` → empty state, `future` warning,
   **`writable: false`**. Do not quarantine and do not clear. The user opened an
   older build in a second tab; wiping their data would be the worst possible
   response. The store runs in memory only until they explicitly discard.
7. `version < STATE_VERSION` → `runMigrations(doc, version, STATE_VERSION, chain)`
   inside `try`/`catch`. A throw → `quarantine`, empty state + `unmigratable`
   warning naming the version.
8. `normalizeState(migrated)`. `repairs.length > 0` → `repaired` warning listing
   the notes (joined, capped at ~200 chars). Still `writable: true` — the whole
   point of repairing is to keep going and then write the repaired document back.
9. Return.

```ts
function quarantine(storage: StateStorage, raw: string): void;   // private
```
Best-effort copy of the unparseable payload to `CORRUPT_KEY` so a user can
recover it by hand, wrapped in `try`/`catch` and skipped when
`raw.length > 524288`. Skipping the large case matters: quarantining a 4 MB
payload doubles usage and then the very next write hits quota.

### Writing

```ts
type WriteResult =
  | { ok: true; bytes: number }
  | { ok: false; reason: "quota" | "unavailable"; bytes: number; message: string };

function writeState(
  storage: StateStorage,
  state: CivitasState,
  options?: { key?: string },
): WriteResult;
```

1. `text = JSON.stringify(serializeState(state))` inside `try`/`catch`. A throw
   here means a value slipped past `sanitizeJson` (a cycle) →
   `{ ok: false, reason: "unavailable" }` with the message. It must not escape
   into React.
2. `bytes = utf16Bytes(text) + utf16Bytes(key)`.
3. `storage.setItem(key, text)` inside `try`/`catch`.
   - `isQuotaExceeded(error)` → `{ ok: false, reason: "quota", bytes, message }`.
   - anything else → `{ ok: false, reason: "unavailable", bytes, message }`.
4. `{ ok: true, bytes }`.

**`writeState` never throws and never retries.** It does not drop images to make
room. Silently discarding what the user just uploaded is worse than telling them
the save failed, and the in-memory state stays intact either way.

```ts
function isQuotaExceeded(error: unknown): boolean;
```
Duck-typed, never `instanceof DOMException` — `DOMException` is absent in some
runtimes and the test builds plain objects. True when the value is an object and
any of:
- `name === "QuotaExceededError"` (the standard, Chrome and modern Safari),
- `name === "NS_ERROR_DOM_QUOTA_REACHED"` (Firefox),
- `code === 22` (legacy) or `code === 1014` (legacy Firefox).

```ts
function utf16Bytes(text: string): number;   // text.length * 2
```
Browsers account `localStorage` in UTF-16 code units, so a 5 MB quota is ~2.5 M
characters. `new Blob([text]).size` would report UTF-8 and understate usage by up
to half for a base64 payload. Two bytes per character is the honest estimate and
it needs no DOM.

```ts
const STORAGE_BUDGET_BYTES = 4000000;
```
80 % of a 5 MB quota. The store raises a `budget` warning when a successful write
crosses it, so the user hears about it before an upload fails outright.

### The debounce

```ts
type TimerHandle = ReturnType<typeof setTimeout>;

type Timers = {
  set(fn: () => void, ms: number): TimerHandle;
  clear(handle: TimerHandle): void;
};

type StateWriter = {
  schedule(): void;
  flush(): void;
  cancel(): void;
  pending(): boolean;
};

function createStateWriter(options: {
  write: () => void;
  delayMs?: number;
  timers?: Timers;
}): StateWriter;
```

`DEBOUNCE_MS = 400`.

**Fixed-window trailing, not a restarting debounce.** `schedule()` arms a timer
only when none is pending; a further `schedule()` inside the window is absorbed
and does not push the deadline out. A restarting debounce starves: typing lore at
one keystroke every 300 ms would postpone the write for as long as the user
keeps typing, and a crash then loses the lot. A fixed window bounds write latency
at `delayMs` no matter what the user does.

- `schedule()`: `dirty = true`; if no handle, `handle = timers.set(fire, delayMs)`.
- `fire()`: clear the handle, and if `dirty` then `dirty = false; write();`.
- `flush()`: clear the handle and the pending flag, and if `dirty` then
  `dirty = false; write();`. Idempotent — a second `flush()` with nothing dirty
  writes nothing.
- `cancel()`: clear the handle and drop the dirty flag without writing. Used by
  `initWorldStore` when it re-initialises.
- `pending()`: whether a timer is armed. Tests assert on it.

`timers` defaults to `globalThis.setTimeout` / `clearTimeout`. Injected so the
store tests are deterministic and instant: the fake exposes a `run()` that
invokes every armed callback.

The type is `ReturnType<typeof setTimeout>` because `@types/node` is in the
program (tsconfig sets no `types` array) and can win the overload, giving
`NodeJS.Timeout` rather than `number`.

---

## 5. `src/state/image.ts`

### Constants

```ts
const FLAG_MAX_EDGE = 256;
const PROVINCE_IMAGE_MAX_EDGE = 320;
const IMAGE_QUALITY = 0.82;
const IMAGE_TARGET_BYTES = 262144;             // 256 KB per image
const QUALITY_STEPS: readonly number[] = [0.82, 0.7, 0.55, 0.4];
```

The sample flag is 735 x 490, so `FLAG_MAX_EDGE` 256 gives 256 x 171 — roughly
15-25 KB encoded, against ~100 KB for the raw JPEG and far more for a modern
phone photo.

### Pure helpers

```ts
function fitDownscale(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number; scaled: boolean };
```
- Non-finite or `<= 0` input in either dimension, or a `maxEdge <= 0`: return
  `{ width: 0, height: 0, scaled: false }`. The caller treats that as a failure.
- `max(width, height) <= maxEdge`: return the input unchanged, `scaled: false`.
  **Never upscale.**
- Otherwise `ratio = maxEdge / max(width, height)` and each dimension becomes
  `Math.max(1, Math.round(dimension * ratio))`. The `max(1, ...)` matters for a
  1 x 4000 strip, where the short edge rounds to 0 and `drawImage` then throws.

```ts
function dataUrlBytes(dataUrl: string): number;
```
Decoded payload size of a `data:...;base64,...` URL:
`floor(base64Length * 3 / 4) - padding`. Returns 0 for a string that is not a
base64 data URL. Used by the budget warning and by the re-encode loop, and it
avoids decoding the payload just to measure it.

### The DOM function

```ts
async function downscaleImage(
  file: Blob,
  maxEdge: number,
  quality?: number,
): Promise<string>;
```

Every DOM call is inside the body, following `decodeProvincePixels` in
`province-index.ts`, so `image.test.ts` can import the module in Node.

1. `bitmap = await createImageBitmap(file)` in `try`/`catch`; a throw becomes
   `throw new Error("the file is not a readable image")`.
2. `wrap` the rest in `try`/`finally` with `bitmap.close()` in the `finally`.
3. `target = fitDownscale(bitmap.width, bitmap.height, maxEdge)`. A zero result
   throws `"the image has no pixels"`.
4. `canvas = document.createElement("canvas")`, set `width`/`height` from
   `target`, `ctx = canvas.getContext("2d")`; a null context throws.
   `ctx.imageSmoothingEnabled = true`, `ctx.imageSmoothingQuality = "high"`,
   `ctx.drawImage(bitmap, 0, 0, target.width, target.height)`.
5. Pick the encoder once: `canvas.toDataURL("image/webp", q)`. If the result does
   not start with `"data:image/webp"` the browser ignored the type and returned
   PNG, so use `"image/jpeg"` from then on. WebP is preferred because it keeps
   alpha — a flag with a transparent background turns black under JPEG.
6. Re-encode loop. Walk `QUALITY_STEPS` starting at the first entry `<= quality`
   (default `IMAGE_QUALITY`). Keep the first result with
   `dataUrlBytes(url) <= IMAGE_TARGET_BYTES`. If none fits, redraw once at
   `maxEdge / 2` and take the lowest quality step. Return the smallest result
   seen. The loop is bounded at 5 encodes; there is no `while` on size.
7. **Always re-encode, even when `scaled` is false.** A 200 x 200 PNG can still
   be 700 KB. Re-encoding is what bounds the bytes, not the resize.

`downscaleImage` is the only way an image enters the store. `setProvinceImage`
and `updateCountry` take a data URL and validate its prefix and length; they do
not resize. T09 and T10 call `downscaleImage` first.

---

## 6. `src/state/world-store.ts`

### Signals — all exported as `ReadonlySignal`

Private writable signals, public `computed` views:

```ts
const overridesSignal = signal<ReadonlyMap<number, ProvinceOverride>>(new Map());
const provinceOverrides = computed(() => overridesSignal.value);
```

**Why.** The exported signal cannot be assigned, so an action is the only way to
change state, so a change can never bypass `markDirty()`. The alternative — an
`effect` that subscribes to every signal and schedules a write — fires once on
creation, needs a "skip the first run" flag, and re-fires on hydration. Four
`computed`s cost nothing and the type system does the enforcing.

Exported:

| Signal | Type |
|---|---|
| `provinceOverrides` | `ReadonlySignal<ReadonlyMap<number, ProvinceOverride>>` |
| `countries` | `ReadonlySignal<readonly Country[]>` |
| `economics` | `ReadonlySignal<ReadonlyMap<number, CountryEconomics>>` |
| `countryById` | `ReadonlySignal<ReadonlyMap<number, Country>>` (computed from `countries`) |
| `countryOfProvince` | `ReadonlySignal<ReadonlyMap<number, number>>` (computed: province id -> country id) |
| `stateWarning` | `ReadonlySignal<StateWarning \| null>` |
| `stateBytes` | `ReadonlySignal<number>` |
| `statePersistent` | `ReadonlySignal<boolean>` — false in `future` / `unavailable` mode |

Every mutation replaces the container rather than mutating it. A `Map` mutated in
place is `Object.is`-equal to itself and no subscriber ever re-renders. The
copies are of at most 1648 entries and in practice a handful, so copy-on-write
costs nothing here.

Only the latest warning is kept. A `quota` warning replaces a `repaired` one.

### Initialisation

```ts
type WorldStoreOptions = {
  storage?: StateStorage;
  timers?: Timers;
  debounceMs?: number;
  chain?: readonly Migration[];
};

function initWorldStore(options?: WorldStoreOptions): StateWarning | null;
```

1. `writer?.cancel()` — a re-init must not let the previous document's pending
   write land in the new storage.
2. `storage = options.storage ?? defaultStorage().storage`; when
   `defaultStorage` reports `available: false` and no storage was injected, set
   the `unavailable` warning and `persistent = false`.
3. `result = readState(storage, { chain: options.chain })`.
4. Write the four private signals from `result.state` inside `batch()`, so a
   subscriber sees one update rather than four.
5. `stateBytes = result.bytes`; `persistent = result.writable && available`;
   `stateWarning = result.warning`.
6. Build `writer = createStateWriter({ write: writeNow, delayMs, timers })`.
7. Return the warning, so `App` can log it.

This is the dependency-injection seam the brief asks for. Production calls
`initWorldStore()` with no arguments; every test calls it with a fake storage and
fake timers. It is re-entrant: calling it again replaces everything.

```ts
function installStateFlush(): () => void;
```
Returns immediately with a no-op when `typeof window === "undefined"`. Otherwise
adds `pagehide` and `visibilitychange` listeners that call `flushState()` —
`visibilitychange` because iOS Safari can kill a backgrounded tab without ever
firing `pagehide`. Both handlers are guarded so nothing throws during unload.
Returns the uninstall function for the `useEffect` cleanup.

```ts
function flushState(): void;      // writer.flush()
function dismissStateWarning(): void;
```

### The write path

```ts
function markDirty(): void;       // private
```
Every action ends with this call. It is `writer.schedule()` plus a guard: when
`persistent` is false it does nothing, so a `future`-version document is never
overwritten.

```ts
function writeNow(): void;        // private, the writer's callback
```
1. `result = writeState(storage, currentState())`.
2. `ok` → `stateBytes = result.bytes`; clear a `quota` or `budget` warning if one
   is showing; raise a `budget` warning when `bytes > STORAGE_BUDGET_BYTES`.
3. `reason === "quota"` → warning
   `"the save failed: storage is full (~N KB). Remove a flag or a province image."`
   The in-memory state is untouched, `persistent` stays true, and the next
   `markDirty()` retries — a later delete may free the space.
4. `reason === "unavailable"` → warning + `persistent = false`. Retrying a broken
   storage every 400 ms is pointless noise.

`currentState()` builds a `CivitasState` from the four private signals. It is not
stored as one object because four signals give four independently subscribable
slices.

### Actions

Province overrides — three explicit setters rather than one patch object,
because a patch would need `undefined` to mean "leave alone" and `null` to mean
"clear", and that tri-state is exactly the kind of thing a panel gets wrong:

```ts
function setProvinceName(id: number, name: string): void;
function setProvinceLore(id: number, lore: string): void;
function setProvinceImage(id: number, dataUrl: string | null): void;
function clearProvinceOverride(id: number): void;
function provinceOverrideOf(id: number): ProvinceOverride | null;
function provinceDisplayName(id: number): string;
```

Shared rules for the three setters:

- `id` must be an integer `>= 1`. Id 0 is `NO_PROVINCE` and is silently ignored.
- The value is truncated to its cap, and the data URL is prefix-checked against
  `"data:image/"` and `IMAGE_DATA_URL_MAX`. A rejected image sets no field and
  raises no warning — the caller already validated it via `downscaleImage`.
- An empty string (or `null` for the image) **removes the field**. A user who
  clears the name box gets the manifest name back, not an empty label.
- When the override has no fields left it is deleted from the Map. This is what
  keeps the document sparse over a long session of edit-then-undo.
- Skip the write entirely when the value is unchanged, in the style of
  `setHoveredProvince` in `selection-store.ts`. No signal write, no `markDirty`,
  no debounce timer for a no-op keystroke.

`provinceDisplayName(id)` is the layering function every panel and T07's labels
use: the override name if present, else `provinceById(id)?.name` from
`map-store.ts`, else `"Province " + id` for the pre-load case.

Countries:

```ts
function addCountry(name?: string): Country;
function updateCountry(
  id: number,
  patch: Partial<Pick<Country, "name" | "slogan" | "lore" | "flagDataUrl" | "colorHex">>,
): void;
function deleteCountry(id: number): void;
function assignProvinces(countryId: number | null, provinceIds: readonly number[]): void;
function buildCountryAssignment(maxProvinceId: number): Uint16Array;
```

- `addCountry` takes `nextCountryId`, builds via `createCountry`, appends,
  increments `nextCountryId`, returns the new country. It throws nothing when the
  id would exceed `MAX_COUNTRY_ID`; it raises a warning and returns the last
  country instead — 65 535 countries is not a case worth crashing over.
- `updateCountry` ignores an unknown id. Fields are validated with the same caps
  as `normalizeState`; an invalid `colorHex` is ignored rather than replaced, so
  a half-typed `#ab` in a colour box does not blank the country's colour.
- `deleteCountry` removes the country, deletes its economics slot, and drops its
  province claims with it (they live in `provinceIds`, so removing the country
  removes them). It does **not** touch province overrides — the lore a user wrote
  survives the country being deleted.
- `assignProvinces(countryId, ids)`: filter to integers `>= 1`; remove each id
  from every other country's `provinceIds`; then, when `countryId` is not null
  and names a real country, add them and sort. `countryId === null` unassigns.
  This is the single entry point that keeps the one-owner invariant, and it is
  what T06's paint mode calls.
- `buildCountryAssignment(maxProvinceId)` builds the `ReadonlyMap<province,
  country>` and hands it to `buildCountryOf` from `../map/borders`, returning the
  `Uint16Array` that `setCountryAssignment` in `borders-store.ts` takes. **T05
  does not call `setCountryAssignment`.** T06 owns the effect that recomputes
  borders when the assignment changes; this function exists so T06 does not
  invent a second copy of the conversion.

Economics:

```ts
function economicsOf(countryId: number): CountryEconomics | null;
function setCountryEconomics(countryId: number, data: { [key: string]: JsonValue }): void;
function patchCountryEconomics(countryId: number, patch: { [key: string]: JsonValue }): void;
```

- Both writers ignore a country id that does not exist. An orphan slot is data
  `normalizeState` would drop on the next load anyway.
- `data` goes through `sanitizeJson`, so a panel that hands over a `NaN` from a
  half-typed number input cannot make the document unserialisable.
- `patchCountryEconomics` shallow-merges into `data` and keeps `version`.
  T11/T12 fill the field set; nothing here knows a single field name.

---

## 7. `src/App.tsx` and `src/app.module.css`

In the existing mount effect, before `ensureMapLoaded()`:

```tsx
useEffect(() => {
  initWorldStore();
  const uninstall = installStateFlush();
  ensureMapLoaded();
  return uninstall;
}, []);
```

`initWorldStore` runs first so a panel mounted in a later task never reads an
un-hydrated store, and it is synchronous, so it cannot delay the map load.

The banner, rendered above the existing status paragraph:

```tsx
{stateWarning.value === null ? null : (
  <div className={styles.warning} data-kind={stateWarning.value.kind}>
    <span className={styles.warningText}>{stateWarning.value.message}</span>
    <button className={styles.warningDismiss} type="button" onClick={dismissStateWarning}>
      dismiss
    </button>
  </div>
)}
```

`App` already calls `useSignals()`. CSS: a top-anchored bar, `--danger` border
for `quota` and `unavailable`, `--accent` otherwise, one declaration per line.
T08 restyles it inside the real shell; this is the minimum that makes the warning
signal visible, which the brief requires.

---

## 8. Integration with T02/T03/T04 — the actual call sites

| From | To | Why |
|---|---|---|
| `world-store.ts` | `provinceById` (`state/map-store.ts`) | `provinceDisplayName` falls back to the manifest name. Returns `null` before the load, and the function handles that. |
| `world-store.ts` | `buildCountryOf` (`map/borders.ts`) | `buildCountryAssignment` converts the country list into the `Uint16Array` the worker takes. Index 0 is forced to 0 by `buildCountryOf` and again by the worker. |
| T06 (not now) | `setCountryAssignment` (`state/borders-store.ts`) | The border recompute. T05 stops at producing the array. |
| `App.tsx` | `initWorldStore`, `installStateFlush`, `stateWarning`, `dismissStateWarning` | Boot and the banner. |
| T09/T10 (not now) | `downscaleImage`, `setProvinceImage`, `updateCountry` | Upload path. |

Constraints inherited from earlier tasks, all of which this design already obeys:

- **Country ids must fit a `Uint16Array`.** `buildCountryOf` returns
  `Uint16Array`, so `MAX_COUNTRY_ID` is 65535 and country id 0 is reserved.
- **Province ids run 1..1650 over 1648 provinces**; 1318 and 1458 do not exist.
  Never index by position, and never validate an override id against a
  contiguous range.
- **`countryOf[0]` is `NO_PROVINCE`, not a country.** `buildCountryOf` zeroes it.
- **No store action may run inside a `useSignalEffect`** (T03's rule): every one
  of these writes signals that a computed derived from them reads.
- **Reactivity is opt-in.** Any component reading these signals calls
  `useSignals()`.
- Nothing here imports from `assets/` — `src/scaffold.test.ts` enforces that.

---

## 9. Edge cases and failure modes

1. **`localStorage` throws on access.** Safari with cookies blocked. Caught in
   `defaultStorage`; memory storage, `unavailable` warning, `persistent = false`.
   The app is fully usable and forgets on reload.
2. **`JSON.parse` fails.** Truncated write, or another script wrote the key.
   Quarantined to `civitas.state.v1.corrupt`, empty state, `corrupt` warning.
3. **Payload is valid JSON but not an object.** `"null"`, `"[]"`, `"7"`. Same
   path as 2. `Array.isArray` must be checked — an array is `typeof "object"`.
4. **`version` missing or not a positive integer.** Corrupt.
5. **`version` newer than this build.** Read-only mode, nothing overwritten. The
   only way out is `dismissStateWarning` plus an explicit discard action, which
   T08 may add; T05 ships the flag, not the button.
6. **`version` older with no migration.** `unmigratable` warning; the payload is
   quarantined so it is not lost.
7. **Quota exceeded on write.** In-memory state kept, `quota` warning, retried on
   the next dirty mark. Never throws into a React render — this is why
   `writeState` returns a result instead of throwing and why `markDirty` is the
   only caller.
8. **A single huge image.** `downscaleImage` bounds each image at ~256 KB and
   `normalizeState` rejects a data URL over `IMAGE_DATA_URL_MAX` chars on read,
   so a hand-edited document cannot smuggle a 4 MB image in.
9. **Many images.** 15 flags plus 30 province images at 256 KB is 11 MB and will
   hit quota. The `budget` warning at 4 MB gives the user notice before that.
   Nothing is auto-deleted.
10. **A prototype-polluting key** (`__proto__`, `constructor`) in the stored
    record. `Object.keys` plus the `/^[1-9][0-9]*$/` key test rejects them, and
    every object is rebuilt rather than spread from the payload.
11. **A cyclic value reaching economics.** `sanitizeJson` caps depth at 8 and the
    `JSON.stringify` call in `writeState` is inside `try`/`catch`, so a cycle
    surfaces as a warning, not a crash.
12. **Two tabs.** The second tab's write clobbers the first. **Out of scope** —
    there is no `storage` event listener and no merge. Named here so a reviewer
    does not read it as an oversight.
13. **`pagehide` firing while a write is already in flight.** `localStorage` is
    synchronous, so there is no in-flight write. `flush()` is idempotent.
14. **A mutation before `initWorldStore`.** The signals hold empty containers and
    `writer` is null, so `markDirty` returns early. No crash, no write. `App`
    initialises on mount before any panel exists.
15. **A NaN or Infinity id** reaching an action. Every id is checked with
    `Number.isInteger` first, which is false for both.
16. **Setting a value identical to the current one.** Skipped before the signal
    write, so no repaint and no debounce timer.
17. **`fitDownscale` on a 1 x 4000 image.** The short edge would round to 0 and
    `drawImage` would throw; `Math.max(1, ...)` prevents it.
18. **A country deleted while its provinces are selected.** Selection lives in
    `selection-store.ts` and holds province ids, which still exist. Nothing to do.

---

## 10. Tests

`tsx --test "src/**/*.test.ts"`, Node's runner, no jsdom, no new dependency. All
186 existing tests must still pass. Expect roughly **+59, so about 245 total**.

Test doubles, both defined inside the test files that need them (there is no
shared fixture module, because a non-test file under `src/` with no production
use is dead code the export-convention test still has to police):

```ts
// A Map-backed StateStorage whose setItem can be made to throw.
function fakeStorage(onSet?: (key: string, value: string) => void): StateStorage;

// Timers that never touch the clock. `run()` fires every armed callback.
function fakeTimers(): Timers & { run(): void; armed(): number };
```

`createMemoryStorage` from `persistence.ts` is the base for the first.

### `src/state/schema.test.ts` (~16)

Round-trip and sparsity, then normalisation, one test per repair rule:

1. `createEmptyState` returns fresh containers on each call (mutating one must
   not affect the next).
2. `serializeState` of an empty state produces a document under 200 bytes with
   `version === STATE_VERSION`.
3. **Sparse overrides.** A state with 2 overrides out of 1648 provinces
   serialises to exactly 2 keys in `provinceOverrides`, the JSON is under 1 KB,
   and there is no key for an untouched province. This is the brief's
   "1648 provinces must NOT all be written" condition, asserted.
4. `serializeState` omits an empty-string field inside an override, and omits a
   province whose override is empty after that.
5. `serializeState` returns copies — mutating the returned document's
   `provinceIds` does not change the state.
6. `serializeState` sorts `provinceIds`, so two states reaching the same
   assignment stringify identically.
7. `normalizeState(serializeState(state))` deep-equals the original state, with
   every field populated including a data URL and nested economics data.
8. Non-integer / negative / `"__proto__"` province keys are dropped and counted.
9. Over-length name and lore are truncated to the caps.
10. An `imageDataUrl` that is `http://...`, or over `IMAGE_DATA_URL_MAX`, is
    dropped.
11. A bad `colorHex` becomes `defaultCountryColor(id)`; a good one survives.
12. A province claimed by two countries stays with the first; `provinceIds` is
    deduped and sorted.
13. A duplicate country id keeps the first entry; a country id of 0, of 65536 or
    non-integer is dropped.
14. `nextCountryId` is forced above the highest surviving country id.
15. An economics slot for a country that was dropped is itself dropped; a nested
    JSON-safe slot survives verbatim.
16. `sanitizeJson` strips `undefined`, a function, `NaN`, `Infinity` and anything
    past depth 8; `normalizeState` never throws on `null`, `[]`, `"x"`, `7` or a
    deeply nested hostile object.

### `src/state/migrations.test.ts` (~6)

1. The shipped `MIGRATIONS` is empty and `assertChain` accepts it.
2. `runMigrations` on a v1 doc at target 1 returns the same reference and
   `applied: []`.
3. **The chain is exercised.** A synthetic `[1->2, 2->3]` chain runs both steps in
   order, and the second step receives the first step's output — asserted by
   having each step append to an array in the doc.
4. `assertChain` throws for a gap (`1->3`), for a repeat, and for a
   descending order.
5. A doc at version 0 with the empty chain throws `"no migration from state
   version 0"`.
6. A chain longer than the target stops at the target and leaves the extra step
   unapplied.

### `src/state/persistence.test.ts` (~15)

1. **Round trip.** A fully populated state written to a fake storage and read
   back deep-equals the original, warning `null`, `writable: true`.
2. A missing key gives an empty state, `warning === null` — a first run is not a
   warning.
3. **Corrupt.** `"{not json"` gives an empty state, a `corrupt` warning, and the
   payload is present under `civitas.state.v1.corrupt`.
4. `"[]"`, `"null"` and `"7"` all take the corrupt path.
5. A missing or non-integer `version` is corrupt.
6. **Future version.** `{ version: 99 }` gives `writable: false`, a `future`
   warning, and the stored payload is byte-identical afterwards.
7. **Migration.** A `{ version: 1 }` doc read at target 1 with the empty chain is
   normalised, not migrated; a doc read with a synthetic chain comes back
   migrated and normalised in one call.
8. An unmigratable version sets `unmigratable` and quarantines.
9. A payload with 3 broken overrides comes back with the good ones and a
   `repaired` warning naming a count.
10. `getItem` throwing gives `unavailable`, an empty state, `writable: false`.
11. **Quota.** `setItem` throwing `new DOMException("full", "QuotaExceededError")`
    returns `{ ok: false, reason: "quota" }` and does not throw.
12. `isQuotaExceeded` is true for the DOMException, for a plain object with
    `name: "NS_ERROR_DOM_QUOTA_REACHED"`, for `code: 22` and for `code: 1014`;
    false for a plain `Error`, for `null` and for a string.
13. `setItem` throwing a plain `Error` returns `reason: "unavailable"`.
14. **The writer.** Five `schedule()` calls inside one window produce exactly one
    `write`; `flush()` writes immediately and disarms the timer; `flush()` again
    writes nothing; `cancel()` prevents the write; `pending()` tracks the armed
    state.
15. `utf16Bytes` is two bytes per character, and `createMemoryStorage` honours
    `getItem` / `setItem` / `removeItem` including a `null` for a missing key.

### `src/state/world-store.test.ts` (~16)

Every test calls `initWorldStore({ storage: fakeStorage(), timers: fakeTimers() })`
first — that is the reset, and it is why the injection seam exists.

1. Init against a storage holding a valid document hydrates all four signals.
2. Init against an empty storage leaves empty signals and no warning.
3. **Sparse.** `setProvinceName(7, "Aln")` puts exactly one entry in
   `provinceOverrides`; province 8 is absent; the serialised document has one key.
4. Clearing the name to `""` removes the field, and an override with no fields
   left is deleted from the Map entirely.
5. Setting a value identical to the current one writes no signal and arms no
   timer.
6. **Debounce.** Three mutations arm one timer; `timers.run()` produces exactly
   one stored document holding all three changes.
7. `flushState()` writes immediately without the timer firing.
8. **Quota.** A storage whose `setItem` throws `QuotaExceededError` leaves the
   in-memory signals intact, sets a `quota` warning, and a subsequent successful
   write clears it and updates `stateBytes`.
9. `addCountry` allocates 1, 2, 3, persists `nextCountryId`, and a re-init from
   the same storage continues at 4 rather than reusing 1.
10. `assignProvinces` moves a province between countries — the previous owner
    loses it in the same call.
11. `assignProvinces(null, ids)` unassigns, and `countryOfProvince` loses the key.
12. `deleteCountry` drops the country, its economics slot and its province
    claims, and leaves the province's own override untouched.
13. `buildCountryAssignment(1650)` returns a `Uint16Array` of length 1651 with
    index 0 zero, the assigned ids at their province positions, and 0 at 1318 and
    1458 — the two ids the manifest does not have.
14. `patchCountryEconomics` merges into an existing slot, refuses an unknown
    country id, and a `NaN` in the patch is dropped by `sanitizeJson` rather than
    corrupting the document.
15. **Future-version read-only mode.** After init against a `{ version: 99 }`
    document, mutations change the signals but the storage payload is unchanged
    after `flushState()`, and `statePersistent.value` is false.
16. `provinceDisplayName` returns the override, then the manifest name, then
    `"Province N"` — the last two exercised with `map-store`'s `provinceById`
    returning `null` because no map is loaded in Node.

### `src/state/image.test.ts` (~6)

Pure helpers only. `downscaleImage` needs `createImageBitmap` and a canvas; PLAN
section 4 forbids DOM tests and there is no jsdom, so the browser check in
section 11 is its gate.

1. `fitDownscale` never upscales: 100 x 80 at maxEdge 256 comes back unchanged
   with `scaled: false`.
2. Aspect ratio is preserved and the long edge is capped, in both orientations —
   735 x 490 at 256 gives 256 x 171, and 490 x 735 gives 171 x 256.
3. A square image scales both edges equally.
4. A 1 x 4000 strip gives a width of at least 1, never 0.
5. Zero, negative, NaN and Infinity dimensions give `{ 0, 0, false }`.
6. `dataUrlBytes` decodes the base64 length with and without padding, and returns
   0 for `"not a data url"` and for a non-base64 data URL.

### Mutation check

Follow the T02-T04 precedent. Apply each mutant to the source alone, run the
suite, restore, and record the failure counts, with a `shasum` before and after
proving the source is byte-identical. At minimum:

| Mutant | Must fail |
|---|---|
| `serializeState` writes every province instead of only overridden ones | the sparse test |
| `serializeState` skips the `provinceIds` sort | the stable-stringify test |
| `normalizeState` accepts an `http:` image URL | the data-URL test |
| `normalizeState` skips the one-owner strip | the double-claim test |
| `readState` clears the key on a future version | the future-version test |
| `isQuotaExceeded` checks only `name === "QuotaExceededError"` | the Firefox / legacy cases |
| the writer restarts its timer on every `schedule` | the debounce test (needs a test that schedules across the window) |
| `markDirty` ignores `persistent` | the read-only-mode test |
| `fitDownscale` drops the `Math.max(1, ...)` | the 1 x 4000 test |

---

## 11. Verification — run exactly these

From `javascript/packages/prototypes/civitas/civitas-interactive-map`:

```bash
yarn typecheck                       # exit 0, prints nothing on success
yarn test                            # ~245 pass, 0 fail
yarn build                           # exit 0; the 2 pre-existing asset-size warnings only
yarn tsx --test "src/state/*.test.ts"   # the new files alone, for a fast loop
```

Style self-check, and every hit must be an apostrophe inside a comment or a
double-quoted string:

```bash
grep -rn "'" src/state/ src/App.tsx src/app.module.css
grep -rn "^export type" src/state/    # must print nothing
```

`yarn build` must NOT grow beyond its current warnings, and `dist/` must still
contain the separate worker chunk from T04.

### Browser checks

Two things no Node test can reach. Both need temporary edits; revert them and
prove it with `shasum -a 256` before and after, as T04 did.

1. **Persistence survives a reload.** With `yarn dev` running, add a temporary
   button to `App.tsx` calling `setProvinceName(1, "Verified")` and
   `addCountry("Testland")`. Press it, wait past the 400 ms debounce, read
   `localStorage.getItem("civitas.state.v1")` in DevTools and confirm it holds
   exactly one province override and one country. Reload, confirm the signals
   come back populated. Then confirm the document does NOT contain 1648 province
   keys. Remove the button.
2. **`downscaleImage` on the real asset.** A temporary snippet that fetches
   `assets/country-flag.jpg` (735 x 490, ~100 KB) as a Blob, calls
   `downscaleImage(blob, 256, 0.82)`, and logs the resulting data URL's MIME
   type, `dataUrlBytes` and the decoded `<img>` dimensions. Expect 256 x 171 and
   well under 40 KB. Assign it with `updateCountry` and confirm the whole
   document still writes without a quota warning.

If Chrome is not drivable in the session, say so plainly rather than reporting a
check that did not run. That is what the T04 agent did on its first attempt and
it was the honest call.

---

## 12. Explicitly NOT part of T05

- **Any panel or editing UI.** T06 for countries and province assignment, T08 for
  the shell, T09/T10/T12 for the panels. The only UI here is the warning banner.
- **Wiring `setCountryAssignment`.** T05 ships `buildCountryAssignment`; T06 owns
  the effect that pushes it to the border worker and the live recompute.
- **Map tinting by country colour, and country labels.** T06 and T07.
- **Any economics formula, field name, unit or tag.** T11-A authors the spec and
  the user approves it before T11-B writes a line. The economics slot here is an
  opaque JSON bag on purpose.
- **Export and import UI, files, a backend, and any cross-tab sync.** PLAN
  section 3 decision 1 and section 6.
- **Undo/redo and edit history.**
- **Deleting or evicting data to make room after a quota failure.** The store
  warns; the user decides.
- **The upload UI itself.** `downscaleImage` takes a `Blob`; T09/T10 own the
  `<input type="file">` and the drag-and-drop.
- **A second `localStorage` key of any kind.** One document, one key, plus the
  quarantine key which is written only on corruption and never read by the app.
- **Removing `applyDemoCountries` / `clearDemoCountries`** from
  `borders-store.ts`. They are T04 scaffolding and T06 deletes them; touching
  them here would break T04's HUD before its replacement exists.
