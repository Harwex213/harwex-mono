# T02 — think agent handoff

Design: `.plan/T02/DESIGN.md`. Follow it literally; the algorithms are written out.

## Decided, with reasons

- **`UNPAINTED = 0xffffffff`, not 0.** No province in this map is black, but the
  format allows one, and a black province packed as `0x000000` would be
  indistinguishable from bare canvas. A sentinel above the 24-bit range costs
  nothing and removes the whole class of bug.
- **Pack from bytes, never from a `Uint32Array` view over `ImageData.data`.**
  `ImageData` is R,G,B,A byte order on every platform; a u32 view is not. The
  reference (`../civitas-map/src/map/colors.ts`) probes endianness at startup and
  `import-provinces.ts` there takes such a view. We do not copy that. Byte reads
  give `0x00RRGGBB` everywhere with no probe and no branch.
- **`alpha !== 255` means unpainted**, not "snap to opaque". Canvas stores
  premultiplied pixels, so a part-transparent one cannot be read back at its
  original colour, and a province is identified by an exact colour.
- **Duplicate-colour detection lives in `buildColorIndex`, not in the parser.**
  A collision only matters where the lookup table is built. Keeps `manifest.ts`
  free of packing knowledge. Duplicate *ids* stay in the parser.
- **`CopyRspackPlugin`, not `asset/resource`.** Stable `assets/<name>` URL in dev
  and prod, no content hash, nothing inlined. Verified `rspack.CopyRspackPlugin`
  exists in the pinned 2.1.4.
- **Asset URLs are relative (`assets/map.png`, no leading slash).** The app has no
  router, so the document URL is always `/`; relative also survives a subdirectory
  deploy.
- **Big objects are plain module variables, not signals.** Only status, map size
  and counts go in signals. Same rule as the reference's `editor-state.ts`.
- **`ensureMapLoaded` never rejects.** Failures land in `loadError`/`loadPhase`,
  so an effect that ignores the promise cannot raise an unhandled rejection.

## Surprises found by measuring the assets

I decoded `provinces_map.png` in Node (zlib + PNG unfilter) and cross-checked it.

- **Alpha is only ever 0 or 255.** Cleared pixels are fully zero rgb. So the
  premultiplication trap cannot actually fire on this asset — the guard is for a
  re-exported one.
- **`provinces_map.png` has no `sRGB`/`gAMA`/`iCCP` chunk** (`map.png` has `sRGB`).
  Untagged, so no browser will colour-convert it. Good news, but the failure mode
  is silent if it ever changes, so `sampleIntegrity` guards it at load.
- **14 of 1648 centroids do not lie inside their own province.** Centroid is a
  centre of mass. So the integrity check must be a ratio test (threshold 0.9),
  never all-must-match. Over the first 200 provinces, 3 miss.
- Image and manifest agree perfectly otherwise: 1648 distinct opaque colours, no
  colour in one and not the other, 2 756 578 opaque pixels = `painted.pixelCount`.
- **Verified probe pixels** (use these, they are measured, not guessed):
  (598,391)→1, (1496,395)→2, (1382,1329)→1000, (1513,2744)→1650,
  (0,0)→null, (3652,2854)→null.

## Traps

- **`src/scaffold.test.ts` asserts `config.plugins.length === 1`.** Adding the copy
  plugin breaks it. Update it in the same change — section 6 of the design.
- **Province ids run 1..1650 for 1648 entries; 1318 and 1458 are missing.** Never
  `provinces[id - 1]`. T01 already flagged this; it bites here.
- `tsx --test "src/**/*.test.ts"` **does** recurse into `src/map/`. I verified it
  with a throwaway nested test (count went 29 → 30). If your new tests do not show
  up, they are misnamed, not un-globbed.
- Keep every DOM call inside a function body in `province-index.ts`. The test file
  imports that module in Node, where `document` does not exist.
- Do not transfer `index.pixels` to the T04 worker. Transfer detaches the buffer
  and every later `provinceAt` reads zeroes.
- `noUnusedLocals` + `noUnusedParameters` are on. A leftover import fails typecheck.

---

## Implementation (attempt 1)

Followed `.plan/T02/DESIGN.md`. No deviation from its algorithms. **No new dependency.**

### Files created

| File | One line |
|---|---|
| `src/map/manifest.ts` | Types mirroring PLAN section 2, strict `parseManifest`/`parseManifestText`, and `indexProvincesById`. Pure, no DOM. |
| `src/map/manifest.test.ts` | 17 tests: field-by-field survival, new-object copying, every rejection in DESIGN section 8, and the real shipped manifest. |
| `src/map/province-index.ts` | `packRgb`/`unpackRgb`/`packPixels`/`buildColorIndex`/`sampleIntegrity`, class `ProvinceIndex` with `packedAt`+`provinceAt`, and the single DOM function `decodeProvincePixels`. |
| `src/map/province-index.test.ts` | 14 tests: byte order, the alpha rule, the anti-u32-view guard, index building on the real manifest, and `provinceAt` on a 3x2 grid. |
| `src/map/map-assets.ts` | Asset URLs, `fetchBitmap`, private `fetchManifest`, and `loadMapAssets` with the three parallel requests and both size checks. |
| `src/state/map-store.ts` | Signal load state (`loadPhase`/`loadStep`/`loadError`/`mapSize`/`provinceCount`/`loadProgress`) plus `ensureMapLoaded`, `getMapAssets`, `provinceAt`, `provinceById`. |

### Files changed

| File | Change |
|---|---|
| `rspack.config.mjs` | Added `rspack.CopyRspackPlugin` copying `assets` -> `assets`. Nothing else touched. |
| `src/scaffold.test.ts` | `plugins.length` 1 -> 2 plus an assertion that a Copy plugin is present. Expected, per DESIGN section 6. |
| `src/App.tsx` | `useSignals()`, `ensureMapLoaded()` on mount, status line, facts block, the six-pixel probe table, a `console.info` of the same rows once when ready, and live x/y number inputs reporting `provinceAt` + the province name. |
| `src/app.module.css` | Styles for the status block, facts list, probe table and lookup row. One declaration per line. |

Nothing else. `assets/` is unmodified (`git diff --stat -- assets/` is empty), `../civitas-map`
is untouched by me (its four modified files carry mtimes of 20:03-20:07, well before this
session), and `index.html` / `tsconfig.json` / `package.json` / `src/env.d.ts` / `src/main.tsx` /
`src/index.css` / `src/assets.test.ts` were not touched.

### Verification — real output

`yarn typecheck` from `PKG`:

```
$ yarn typecheck
typecheck exit: 0
```

(`tsc --noEmit` prints nothing on success.)

`yarn build` from `PKG`:

```
$ yarn build
build exit: 0
WARNING in ⚠ asset size limit: The following asset(s) exceed the recommended size limit (300.000 KiB). This can impact web performance.
  │ Assets:
  │   assets/map.png (2.530 MiB)
  │   assets/provinces_map.png (552.626 KiB)
  │   assets/provinces_manifest.json (586.891 KiB)

WARNING in ⚠ Rspack performance recommendations:
  │ You can limit the size of your bundles by using import() to lazy load some parts of your application.
  │ For more info visit https://rspack.rs/guide/optimization/code-splitting

Rspack compiled with 2 warnings in 68 ms
```

Two warnings, exit 0. They are rspack's default 300 KiB asset-size hint firing on the three
copied files. That is exactly the outcome DESIGN section 6 predicted, so I did **not** silence
it with a `performance` block — that would be an undesigned config change, and the warning is
honest. See "left undone" below.

```
$ ls -la dist dist/assets
dist:
drwxr-xr-x   assets
-rw-r--r--   337     index.html
-rw-r--r--   2697    main.68eb29e6a0dde159.css
-rw-r--r--   204897  main.9d597495fbcaca02.js

dist/assets:
-rw-r--r--   100307   country-flag.jpg
-rw-r--r--   2653014  map.png
-rw-r--r--   600976   provinces_manifest.json
-rw-r--r--   565889   provinces_map.png

$ du -sh dist
4.0M	dist
```

All four assets copied. 196K -> 4.0M is the expected growth, not a regression.

`yarn test` from `PKG` — **29 -> 60**, and the new names from `src/map/` do appear:

```
✔ the fixture parses and every field survives intact (0.718208ms)
✔ the parser returns new objects, so unvalidated keys cannot leak through (0.0725ms)
✔ a payload that is not a JSON object is rejected (0.168833ms)
✔ a wrong or missing format is rejected and the message quotes what it found (0.076833ms)
✔ a wrong or missing version is rejected, and the string "1" is not the number 1 (0.089334ms)
✔ a missing or malformed map block is rejected (0.091917ms)
✔ a missing or non-array provinces list is rejected (0.052333ms)
✔ a duplicate or non-positive province id is rejected (0.065708ms)
✔ a bad name or kind is rejected (0.060417ms)
✔ rgb must be exactly three integers in 0..255 (0.125ms)
✔ hex must be #rrggbb and must agree with rgb (0.092625ms)
✔ pixelCount, bounds and centroid must be non-negative integers (0.109ms)
✔ a missing or malformed painted summary is rejected (0.186625ms)
✔ parseManifestText reports broken JSON as such (0.107584ms)
✔ the real shipped manifest parses (2.628583ms)
✔ indexProvincesById keys on the id, and the id is not the array position (2.202667ms)
✔ packRgb lays the channels out as 0x00RRGGBB (0.352709ms)
✔ packRgb agrees with the manifest's own hex notation (2.667917ms)
✔ unpackRgb round-trips packRgb (0.261458ms)
✔ packPixels reads ImageData byte order and applies the alpha rule (0.063ms)
✔ packPixels never takes a Uint32Array view, so alpha stays out of the high byte (0.066084ms)
✔ packPixels rejects a buffer that is not four bytes per pixel (0.165792ms)
✔ buildColorIndex maps a packed colour to its province id (0.079166ms)
✔ buildColorIndex throws on a shared colour and names both provinces (0.050542ms)
✔ buildColorIndex on the real manifest holds exactly 1648 entries (2.453833ms)
✔ provinceAt reads the grid row-major (0.167834ms)
✔ provinceAt returns null for unpainted and for an unregistered colour (0.045333ms)
✔ provinceAt returns null outside the grid (0.041ms)
✔ fractional coordinates are floored, not rounded (0.057125ms)
✔ the ProvinceIndex constructor rejects a bitmap of the wrong length (0.049334ms)
✔ sampleIntegrity is a ratio, because a centroid can miss its own province (0.082209ms)
✔ rspack config keeps the settings CSS modules and JSX depend on (69.422834ms)
ℹ tests 60
ℹ suites 0
ℹ pass 60
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 183.5315
```

Single-quote self-check:

```
$ grep -rn "'" src/
src/App.tsx:63:    // The task's stated done-condition is a log of the province id under a known
src/scaffold.test.ts:143:  // DESIGN 13.6: the production asset mechanism is T02's decision. An import of
src/state/map-store.ts:36:// Idempotent: two components may both ask, and the second gets the first's
src/map/province-index.ts:95:  // 41.7 MB for the real map, alive for the app's lifetime.
src/map/province-index.ts:143:  // throwing. The manifest's `unregisteredColors` is empty today, so this cannot
src/map/province-index.test.ts:69:test("packRgb agrees with the manifest's own hex notation", () => {
```

Every hit is an apostrophe inside a comment or a double-quoted string. **Zero single-quoted
string literals.**

### The real pixels, proven twice

DESIGN section 8 says a Node-side PNG decode is out of scope for the shipped tests, and it
still is. But "the app can report the province id under a given pixel" needed real evidence,
so I proved it two independent ways.

**1. Node, against the real PNG bytes.** A throwaway script in the scratchpad (`probe.ts`,
**not** added to the package, no dependency) inflates `provinces_map.png` with `node:zlib`,
runs the PNG unfilter, and then feeds the result through the *actual shipped*
`packPixels` -> `buildColorIndex` -> `ProvinceIndex.provinceAt`:

```
png: 3653x2855 manifest: 3653x2855
colour index size: 1648
provinceAt(598, 391) = 1 expected 1 OK
provinceAt(1496, 395) = 2 expected 2 OK
provinceAt(1382, 1329) = 1000 expected 1000 OK
provinceAt(1513, 2744) = 1650 expected 1650 OK
provinceAt(0, 0) = null expected null OK
provinceAt(3652, 2854) = null expected null OK
painted pixels: 2756578 manifest says 2756578
centroid hits: 1634/1648 ratio 0.9915
ALL PROBES PASS
```

`1634/1648` reproduces the think agent's measurement exactly (14 centroids miss their own
province), which confirms the 0.9 threshold in `loadMapAssets` is correctly placed.
`painted pixels` matching `painted.pixelCount` to the pixel confirms the alpha rule.

**2. A real browser, against the production build.** Served `dist/` with `http-server`
(the copy plugin's output, **not** `devServer.static`) and loaded it in Chrome. Page text:

```
CIVITAS INTERACTIVE MAP
ready
map           3653 x 2855
provinces     1648
colour index  1648
pixel          expected  provinceAt
(598, 391)     1         1
(1496, 395)    2         2
(1382, 1329)   1000      1000
(1513, 2744)   1650      1650
(0, 0)         null      null
(3652, 2854)   null      null
x  y  1 — Province 1
```

Console, filtered on `provinceAt|error|Error|rejection|warn` — six INFO rows and **nothing
else**, so there is no unhandled rejection:

```
[INFO] provinceAt(598, 391) = 1 (expected 1)
[INFO] provinceAt(1496, 395) = 2 (expected 2)
[INFO] provinceAt(1382, 1329) = 1000 (expected 1000)
[INFO] provinceAt(1513, 2744) = 1650 (expected 1650)
[INFO] provinceAt(0, 0) = null (expected null)
[INFO] provinceAt(3652, 2854) = null (expected null)
```

Network — all three fetched, none inlined into the bundle:

```
1. http://127.0.0.1:8853/assets/provinces_manifest.json  GET  200
2. http://127.0.0.1:8853/assets/provinces_map.png        GET  200
3. http://127.0.0.1:8853/assets/map.png                  GET  200
```

**Dev server** (`yarn dev`, port 58959) renders the identical table, so both paths work.

**Error path.** Rather than editing `MANIFEST_URL` and having to remember to revert it, I
copied `dist/` to the scratchpad, set `"version": 2` in the copy's manifest, and served that.
The page shows exactly the designed message and nothing crashes:

```
failed: assets/provinces_manifest.json: manifest version is 2, expected 1
```

**Nothing needed reverting** — no source file and no asset was edited for that test. The
scratch copy is deleted, all servers are killed, and the browser tab is closed.

### Deliberately left undone

- **The two `yarn build` warnings are not silenced.** Adding `performance: { hints: false }`
  to `rspack.config.mjs` would remove them, but that is a config change DESIGN did not ask
  for and `src/scaffold.test.ts` does not pin. The assets are large on purpose and copied on
  purpose, so the warning is accurate. Flagging it for the reviewer to decide.
- **No tests for `map-assets.ts`, `map-store.ts` or `decodeProvincePixels`.** PLAN section 4
  forbids DOM, canvas and signal tests; these are all three. The browser run above is their
  gate, as DESIGN section 8 specifies.
- **No Node-side PNG decoder in the package.** The scratch `probe.ts` above is not committed
  and adds no dependency. DESIGN section 11 forbids one.
- **No rendering, no view transform, no borders, no hover/selection.** T03, T04, T08.
- **`assets/country-flag.jpg` is copied into `dist` but read by nothing.** T09.
- **`README.md` not updated.** The docs agent owns it.

### Notes for the next agent

- `ProvinceIndex.pixels` is 41.7 MB and lives for the app's lifetime. **Do not transfer that
  buffer to the T04 worker** — a transfer detaches it and every later `provinceAt` reads
  zeroes. There is a comment on the field saying so.
- `provinceAt(x, y)` **floors** its arguments. T03's screen->map floats can be passed straight
  in; do not round them first.
- `UNPAINTED` is `0xffffffff`, not 0. `0x000000` is a legal province colour.
- `ensureMapLoaded()` never rejects and is idempotent. Call it freely from any effect.
- `getMapAssets()` returns `null` until `loadPhase.value === "ready"`. T03 should render off
  `loadPhase`, not off a truthy check of the art bitmap.
- The `App.tsx` probe table and the x/y inputs are T02 scaffolding. T03 replaces the body of
  `App` with the map canvas; the probe UI can go then, but keep `ensureMapLoaded()` on mount.

---

## Tests

Test count **60 -> 81**, all passing. `tsx` and the `test` script were already in place
(T01); **no dependency was added**. One source defect was found and fixed — see below.

| File | Tests | New here |
|---|---|---|
| `src/map/manifest.test.ts` | 18 | +2 |
| `src/map/province-index.test.ts` | 21 | +6 |
| `src/map/province-pixels.test.ts` | 8 | new file |
| `src/map/map-assets.test.ts` | 5 | new file |

### Source change — `src/map/province-index.ts`

`packedAt` is declared `: number` but returned `undefined` for a NaN coordinate.
NaN fails every comparison, so `px < 0 || px >= this.width` let it through and
`pixels[NaN]` read back `undefined`. `provinceAt` survived it by luck (`undefined`
is not `UNPAINTED`, and `colorIndex.get(undefined)` is `undefined`, so it still
returned `null`), but any direct `packedAt` caller — the T04 border worker compares
neighbouring packed values — would have seen a value the type says cannot exist and
emitted a spurious edge. A degenerate T03 view transform (a zero scale) produces
exactly that coordinate. Fixed with an explicit `Number.isFinite` guard and a
comment. Nothing was weakened to make a test pass.

### `src/map/province-pixels.test.ts` — the real bitmap, decoded in Node

DESIGN section 8 left the six probe pixels to a manual browser check. They are now
automated. The file carries a **test-only** PNG decoder built on `node:zlib` —
inflate plus the five row filters — exactly the precedent `src/assets.test.ts` set
with its private `readPngSize`. **No dependency was added and `province-index.ts`
still knows nothing about PNG.** The decoded bytes go through the *shipped*
`packPixels` -> `buildColorIndex` -> `ProvinceIndex.provinceAt` path, so this tests
the real code rather than a copy of it. The whole file costs ~400 ms; the decode is
memoised so it happens once, not once per test.

The decoder itself is proven first: a hand-built 3x2 RGBA image is encoded with each
of the five PNG row filters and round-tripped. Without that, a failing probe could be
blamed on the decoder instead of the lookup.

Pinned against the real asset:

- `provinces_map.png` decodes to **3653 x 2855**, matching `manifest.map`.
- All six verified probe pixels: (598,391)->1, (1496,395)->2, (1382,1329)->1000,
  (1513,2744)->1650, (0,0)->null, (3652,2854)->null.
- Non-`UNPAINTED` pixel count is **2 756 578**, equal to `painted.pixelCount`.
- Distinct opaque colours: **1648**, every one registered in the colour index.
- No packed value exceeds `0xffffff` — the anti-`Uint32Array`-view guard, now proven
  on 10.4 M real pixels rather than a 3-pixel fixture.
- `sampleIntegrity` over all 1648 centroids scores **1634**, asserted exactly. That
  reproduces the think agent's measurement, proves the 0.9 threshold in
  `loadMapAssets` is correctly placed, and is asserted as `!== 1648` so nobody
  "tightens" the ratio test into an all-must-match test.

### `src/map/province-index.test.ts` — the edge cases DESIGN section 10 named

- **A black province** (case 4). `0x000000` is a legal key: an opaque black pixel
  resolves to its province and a transparent one is empty canvas. This is the only
  test that fails if `UNPAINTED` is changed to 0.
- **Alpha below 255 is unpainted** (case 3), tested at 254, 128 and 1 — 254 is the
  value a `=== 0` test wrongly accepts.
- **NaN and infinite coordinates** read as `UNPAINTED` / `null` (the fix above).
- **`createProvinceIndex` rejects a bitmap that disagrees with the manifest**
  (case 9). Runnable in Node precisely because the size check runs before the
  decode; reaching `decodeProvincePixels` would fail on `document` instead.
- `sampleIntegrity` with a sample size of 0 or negative returns `checked: 0`, so the
  division in `loadMapAssets` cannot produce NaN.
- `packPixels` accepts an empty buffer.

### `src/map/manifest.test.ts`

- **The centroid is the centre of mass, not the bbox centre** (PLAN section 2).
  Every parsed centroid is compared field by field against the raw JSON, so a parser
  that ever "helpfully" derived it from `bounds` fails. 1314 of 1648 sit more than a
  pixel from their bbox centre (my metric is `bounds.x + width / 2`;
  `src/assets.test.ts` counts 1277 with a different formula — both are valid pins).
- **The parser does not police colours.** A manifest with two provinces sharing a
  colour parses, and `buildColorIndex` is what throws. This pins the layering split
  DESIGN section 2 chose; moving the check into the parser fails the test.

### `src/map/map-assets.test.ts`

Only what survives without `createImageBitmap` or a canvas. A stubbed `globalThis.fetch`
(restored in a `finally`) reaches two failure paths:

- **Non-2xx names the URL and the status** (case 10).
- **HTML served for the manifest path** fails as
  `assets/provinces_manifest.json: manifest is not valid JSON` (case 11), and a
  `version: 2` manifest surfaces the parser's message with the URL prefixed. The
  `onStep` callback is asserted to have reported `["manifest"]` before the failure.
- The three URLs are relative, under `assets/`, with no leading slash.
- `LOAD_STEPS` holds each step once, in order, ending at `done` — `loadProgress`
  divides by `length - 1`, so a duplicate or missing entry breaks the progress bar.

### Mutation check — the tests were proven to bite

Six deliberate defects introduced one at a time into `src/map/province-index.ts`,
each reverted afterwards (`src/map/*.test.ts` only, 52 tests):

| Mutant | Failures |
|---|---|
| `UNPAINTED = 0x000000` | 1 |
| `packRgb` swaps R and B | 7 |
| `packedAt` transposed to `x * height + y` | 6 |
| alpha test loosened to `=== 0` | 2 |
| NaN guard removed | 1 |
| `Math.round` instead of `Math.floor` | 1 |
| control (restored) | **0** |

The source file is byte-identical to its pre-mutation state (`diff` is empty).

### Deliberately NOT covered

- **`src/state/map-store.ts`.** Signals, and PLAN section 4 rules signal tests out.
  `ensureMapLoaded` is `loadMapAssets` plus signal writes; both halves are covered
  elsewhere, and the idempotence guard is module-global state that a second test in
  the same process could not reset.
- **`decodeProvincePixels`, `fetchBitmap`'s success path, `loadMapAssets` past the
  manifest await.** All need a canvas or `createImageBitmap`. There is no jsdom in
  this repo and the plan forbids adding one. The browser run recorded above is their
  gate.
- **`App.tsx`, `main.tsx`, the CSS.** DOM and React.
- **The 1-pixel `map.png` width tolerance in `loadMapAssets`.** Reaching it needs two
  decoded bitmaps. `src/assets.test.ts` already pins the fact it guards
  (`MAP_WIDTH - art.width === 1`) straight from the PNG headers.
- **The build output.** `src/scaffold.test.ts` pins the copy plugin's presence; a
  test that asserted on `dist/` would need a prior `yarn build`.

### Real `yarn test` output

```
✔ the fixture parses and every field survives intact (0.895375ms)
✔ the parser returns new objects, so unvalidated keys cannot leak through (0.090125ms)
✔ a payload that is not a JSON object is rejected (0.17675ms)
✔ a wrong or missing format is rejected and the message quotes what it found (0.093042ms)
✔ a wrong or missing version is rejected, and the string "1" is not the number 1 (0.089584ms)
✔ a missing or malformed map block is rejected (0.097208ms)
✔ a missing or non-array provinces list is rejected (0.057209ms)
✔ a duplicate or non-positive province id is rejected (0.065083ms)
✔ a bad name or kind is rejected (0.060458ms)
✔ rgb must be exactly three integers in 0..255 (0.132ms)
✔ hex must be #rrggbb and must agree with rgb (0.094625ms)
✔ pixelCount, bounds and centroid must be non-negative integers (0.119459ms)
✔ a missing or malformed painted summary is rejected (0.209791ms)
✔ parseManifestText reports broken JSON as such (0.100916ms)
✔ the real shipped manifest parses (2.882708ms)
✔ the parser copies the centre of mass through and never recomputes it (3.557959ms)
✔ the parser does not police colours — that is buildColorIndex's job (0.129667ms)
✔ indexProvincesById keys on the id, and the id is not the array position (1.9275ms)
✔ the asset URLs are relative, so a subdirectory deploy still resolves them (0.348ms)
✔ LOAD_STEPS lists every step once, in order, ending at done (0.286ms)
✔ a non-2xx response names both the URL and the status (8.822583ms)
✔ a dev server answering the manifest path with HTML fails with the URL attached (1.070834ms)
✔ a manifest the parser rejects surfaces the parser's own message, prefixed (0.356084ms)
✔ packRgb lays the channels out as 0x00RRGGBB (0.393792ms)
✔ packRgb agrees with the manifest's own hex notation (2.981ms)
✔ unpackRgb round-trips packRgb (0.361458ms)
✔ packPixels reads ImageData byte order and applies the alpha rule (0.082292ms)
✔ packPixels never takes a Uint32Array view, so alpha stays out of the high byte (0.089833ms)
✔ packPixels rejects a buffer that is not four bytes per pixel (0.184667ms)
✔ buildColorIndex maps a packed colour to its province id (0.091833ms)
✔ buildColorIndex throws on a shared colour and names both provinces (0.056ms)
✔ buildColorIndex on the real manifest holds exactly 1648 entries (2.882791ms)
✔ provinceAt reads the grid row-major (0.177917ms)
✔ provinceAt returns null for unpainted and for an unregistered colour (0.054666ms)
✔ provinceAt returns null outside the grid (0.040708ms)
✔ fractional coordinates are floored, not rounded (0.048625ms)
✔ the ProvinceIndex constructor rejects a bitmap of the wrong length (0.058375ms)
✔ sampleIntegrity is a ratio, because a centroid can miss its own province (0.095584ms)
✔ sampleIntegrity checks nothing when the sample size is zero or negative (0.044875ms)
✔ a black province is a legal colour, so UNPAINTED must stay outside the packable range (0.049042ms)
✔ packPixels treats every alpha below 255 as unpainted, not as opaque (0.042334ms)
✔ packPixels accepts an empty buffer (0.029292ms)
✔ a NaN coordinate reads as unpainted rather than off the end of the array (0.042917ms)
✔ createProvinceIndex rejects a bitmap whose size disagrees with the manifest (0.065167ms)
✔ the test PNG decoder round-trips every row filter (1.349833ms)
✔ the test PNG decoder rejects a payload that is not an 8-bit RGBA PNG (0.163458ms)
✔ provinces_map.png decodes to the 3653x2855 surface the manifest declares (169.864375ms)
✔ every verified probe pixel resolves to its province through the shipped lookup (0.091792ms)
✔ a fractional probe coordinate lands in the same pixel as its floor (0.040875ms)
✔ the packed bitmap holds exactly the painted pixel count the manifest declares (62.310625ms)
✔ the bitmap holds exactly the 1648 colours the manifest registers, and no others (66.641708ms)
✔ sampleIntegrity on the real asset clears the 0.9 load threshold but is not 1 (0.472458ms)
✔ package.json identifies the workspace exactly as the plan requires (0.418375ms)
✔ every dependency version is exact — no caret, tilde or range (0.265292ms)
✔ the versions pinned to ../civitas-map have not drifted (0.080375ms)
✔ the test script keeps its quoted glob so the shell cannot expand it (0.060959ms)
✔ tsconfig stays standalone and strict (0.336584ms)
✔ tsconfig include covers src, so env.d.ts is type-checked (0.114125ms)
✔ index.html keeps both the id and the class the app mounts on (0.09975ms)
✔ no source file imports a map asset into the bundle (0.675041ms)
✔ source files obey the grouped-named-export convention (0.5585ms)
✔ rspack config keeps the settings CSS modules and JSX depend on (73.621875ms)
ℹ tests 81
ℹ suites 0
ℹ pass 81
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 419.579625
```

(The 19 tests from `src/assets.test.ts` are in the run — 18 + 5 + 21 + 8 + 19 + 10 = 81 —
but scrolled off the captured tail; the totals are the run's own.)

`yarn typecheck` exit 0 (no output). `yarn build` exit 0, with the same two pre-existing
asset-size warnings the implement agent recorded. `grep -rn "'" src/map/*.test.ts` finds
only apostrophes inside double-quoted test names — no single-quoted string literals.

### Notes for the next agent

- `src/map/province-pixels.test.ts` decodes the real 3653x2855 PNG on every run. It costs
  ~300 ms and ~40 MB. If T04 wants the same bytes, import nothing from it — it is a test
  file; copy the decoder or decode in the worker.
- `packedAt` now returns `UNPAINTED` for NaN and for either infinity. T04's border scan can
  rely on it never returning `undefined`.
- The 1634/1648 centroid-hit count is asserted exactly. If T06 or a regenerated manifest
  moves centroids, that assertion is the one that will fail, and it is a real signal.

---

## Docs & commit

Commit: `ba81adf1b813be5a6f334035a0a5da2aeb12a234` — "civitas interactive map — T02 manifest and asset loading".

### Verification before committing

All three green. Nothing needed fixing.

```
yarn typecheck   exit 0 (no output)
yarn build       exit 0, 2 asset-size warnings (expected, not silenced)
yarn test        81 pass, 0 fail, exit 0
```

### README

Appended, not rewritten. Two edits to T01's text and one new section:

- The `Assets` section said the production build does not carry the assets. That
  is now false, so the line names `rspack.CopyRspackPlugin` and `dist/assets`.
- The `Files so far` table gained the four new modules. `src/App.tsx` is no longer
  described as a placeholder.
- New `## Asset loading` section at the end: the parser, the packing rules
  (`0x00RRGGBB`, `UNPAINTED = 0xffffffff`, alpha below 255 is unpainted), the
  three-request load and its two guards, the `map-store` surface, and four traps
  for later tasks.

### Files committed (16)

```
.plan/T01/memory.md          (T01's own docs section, left uncommitted by T01)
.plan/T02/DESIGN.md
.plan/T02/memory.md
README.md
rspack.config.mjs
src/App.tsx
src/app.module.css
src/scaffold.test.ts
src/map/manifest.ts
src/map/manifest.test.ts
src/map/map-assets.ts
src/map/map-assets.test.ts
src/map/province-index.ts
src/map/province-index.test.ts
src/map/province-pixels.test.ts
src/state/map-store.ts
```

`javascript/package.json` and `javascript/yarn.lock` were **not** committed. T02
added no dependency. The only diff in `yarn.lock` is the unrelated
`@hw/civitas-beautiful-map` workspace entry that T01 already flagged. It still sits
in the working tree, and it belongs to that other package's commit.

### Trap the next docs agent must repeat

The repo index holds ~120 pre-existing staged files from unrelated work
(`.yarn/cache` zips, a skill file). Always commit with an explicit pathspec:
`git commit -F <msg> -- <PKG>`. A bare `git commit` sweeps them all in.

This section itself is appended after the commit, so `.plan/T02/memory.md` shows as
modified until T03 sweeps it in. Same pattern as T01.
