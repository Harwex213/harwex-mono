# T02 — Manifest and asset loading — DESIGN

`PKG` = `javascript/packages/prototypes/civitas/civitas-interactive-map`.
All paths below are relative to `PKG` unless stated otherwise.

Read `javascript/CLAUDE.md` and `.plan/PLAN.md` sections 2-4 before writing code.
Read `.plan/T01/memory.md` — it names two traps this task walks straight into.

---

## 0. Facts verified for this task

I decoded `assets/provinces_map.png` in Node (zlib inflate + PNG unfilter) and
cross-checked it against the manifest. These are measurements, not assumptions.

| Fact | Value |
|---|---|
| `provinces_map.png` IHDR | 3653 x 2855, bit depth 8, **colour type 6 (RGBA)**, non-interlaced |
| Chunks in `provinces_map.png` | `IHDR`, 139 x `IDAT`, `IEND` — **no `sRGB`, no `gAMA`, no `iCCP`** |
| Chunks in `map.png` | `IHDR`, `sRGB`, 324 x `IDAT`, `IEND` |
| Alpha histogram | **exactly two values**: 0 (7 672 737 px) and 255 (2 756 578 px). No partial alpha anywhere. |
| Alpha-0 pixels | all have rgb `(0, 0, 0)`. Cleared means fully zero. |
| Distinct opaque colours | **1648**, exactly the manifest's 1648 colours. Zero colours in the image are absent from the manifest, and zero manifest colours are absent from the image. |
| Opaque pixel count | 2 756 578 — equals `painted.pixelCount`. |
| Is any province black? | **No.** Min packed RGB is 1 645 512, max is 16 184 922. |
| Province ids | 1..1650, **1648 entries; ids 1318 and 1458 do not exist**. |
| Centroid lands on its own province | 1634 of 1648. **14 do not** (concave shapes). |

Consequences that drive the design:

- No colour-profile chunk on the province bitmap, so no browser will colour-convert
  it on decode. The pixels are identity data and survive `drawImage` unchanged.
- Alpha is strictly 0 or 255, so canvas premultiplication cannot damage any colour.
- No black province, so `0x000000` is a legal province key. The unpainted sentinel
  must therefore be a value outside the 24-bit range — see section 3.

Pixels verified by direct decode; use these as the smoke probe:

| Map pixel | Expected `provinceAt` |
|---|---|
| (598, 391) | `1` |
| (1496, 395) | `2` |
| (1382, 1329) | `1000` |
| (1513, 2744) | `1650` |
| (0, 0) | `null` |
| (3652, 2854) | `null` |

---

## 1. Files

### Created

| File | Responsibility |
|---|---|
| `src/map/manifest.ts` | Manifest types mirroring PLAN section 2, a strict parser, and an id -> province lookup builder. Pure. No DOM. |
| `src/map/manifest.test.ts` | Parser tests, including rejection of a bad `format`/`version`, run against both synthetic fixtures and the real asset on disk. |
| `src/map/province-index.ts` | RGB packing primitives, `packPixels`, `buildColorIndex`, the `ProvinceIndex` class with `provinceAt`, `sampleIntegrity`, and the one DOM-touching function `decodeProvincePixels`. |
| `src/map/province-index.test.ts` | Packing byte-order tests, index-build tests, `provinceAt` tests on synthetic bitmaps. |
| `src/map/map-assets.ts` | Asset URLs, `fetch` helpers, and `loadMapAssets` — the async orchestration. DOM only. Not unit tested. |
| `src/state/map-store.ts` | Signal-backed load state and the loaded-asset holder. `ensureMapLoaded`, `provinceAt`, `provinceById`. |

### Changed

| File | Change |
|---|---|
| `rspack.config.mjs` | Add `rspack.CopyRspackPlugin` copying `assets/` -> `dist/assets/`. |
| `src/scaffold.test.ts` | `assert.equal(config.plugins.length, 1)` becomes `2`, plus an assertion on the copy pattern. **This test fails the moment the plugin is added. It is not a regression.** |
| `src/App.tsx` | Kick off the load on mount, show progress from the signals, run the smoke probe, and offer an x/y input reporting the province id under that pixel. |
| `src/app.module.css` | Styles for the status block and probe table. |

Nothing else. Do not touch `index.html`, `tsconfig.json`, `package.json`,
`src/env.d.ts`, `src/main.tsx`, `src/index.css`, or `src/assets.test.ts`.

**No new dependency.** Everything here is standard DOM plus what T01 already pinned.

---

## 2. `src/map/manifest.ts`

### Types

```ts
type ProvinceKind = "land" | "sea" | "lake";

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Point = {
  x: number;
  y: number;
};

type Province = {
  id: number;
  name: string;
  kind: ProvinceKind;
  hex: string;
  rgb: [number, number, number];
  pixelCount: number;
  bounds: Bounds;
  centroid: Point;
};

type MapInfo = {
  source: string;
  width: number;
  height: number;
};

type PaintedInfo = {
  pixelCount: number;
  coverage: number;
  unregisteredColors: string[];
};

type MapManifest = {
  format: typeof MANIFEST_FORMAT;
  version: typeof MANIFEST_VERSION;
  map: MapInfo;
  provinces: Province[];
  painted: PaintedInfo;
};
```

### Constants

```ts
const MANIFEST_FORMAT = "civitas.province-map";
const MANIFEST_VERSION = 1;
const PROVINCE_KINDS: readonly ProvinceKind[] = ["land", "sea", "lake"];
```

### Public functions

```ts
function parseManifest(payload: unknown): MapManifest;
function parseManifestText(text: string): MapManifest;
function indexProvincesById(provinces: readonly Province[]): Map<number, Province>;
```

`parseManifestText` wraps `JSON.parse` and rethrows as
`"manifest is not valid JSON"`, then delegates to `parseManifest`.

`indexProvincesById` exists because **province ids are not array positions**
(1..1650 for 1648 entries). Comment that in the file.

### Validation algorithm — `parseManifest`

Checks run in this order. Each failure throws `new Error(message)` immediately;
no accumulation, no coercion, no defaults. The asset ships with the app, so a
mismatch is a build error, not a user error.

1. `payload` is a non-null object and not an array, else
   `"manifest is not a JSON object"`.
2. `root.format === MANIFEST_FORMAT`, else
   `` `manifest format is ${JSON.stringify(root.format)}, expected "civitas.province-map"` ``.
3. `root.version === MANIFEST_VERSION` (strict `===`, so the string `"1"` is
   rejected), else
   `` `manifest version is ${JSON.stringify(root.version)}, expected 1` ``.
4. `root.map` is an object; `map.source` is a string; `map.width` and
   `map.height` are integers `> 0`. Else
   `"manifest map must have a source string and a positive integer width and height"`.
5. `root.provinces` is an array, else `"manifest has no provinces array"`.
6. For each entry, at index `i`, every failure message is prefixed
   `` `manifest province at index ${i}: ` ``:
   - `id` is an integer `> 0` -> `"id must be a positive integer"`.
   - `id` not already seen -> `` `id ${id} is already used` ``.
   - `name` is a string -> `"name must be a string"`.
   - `kind` is in `PROVINCE_KINDS` -> `"kind must be land, sea or lake"`.
   - `rgb` is an array of length 3, every element an integer in `0..255` ->
     `"rgb must be three integers in 0..255"`.
   - `hex` matches `/^#[0-9a-f]{6}$/i` -> `"hex must be #rrggbb"`.
   - `hex` decodes to the same three channels as `rgb` ->
     `` `hex ${hex} disagrees with rgb [${rgb.join(", ")}]` ``.
   - `pixelCount` is an integer `>= 0` -> `"pixelCount must be a non-negative integer"`.
   - `bounds` has integer `x`, `y` `>= 0` and integer `width`, `height` `>= 0` ->
     `"bounds must be four non-negative integers"`.
   - `centroid` has integer `x`, `y` `>= 0` -> `"centroid must be two non-negative integers"`.
7. `root.painted` is an object; `pixelCount` an integer `>= 0`; `coverage` a
   finite number; `unregisteredColors` an array of strings. Else
   `"manifest painted summary is missing or malformed"`.

The parser returns **newly built objects**, not the parsed payload. Copy each
field explicitly. That is what makes the return type honest: an unvalidated
extra key on the input must not leak into `MapManifest`.

`rgb` is rebuilt as `[Number(raw[0]), Number(raw[1]), Number(raw[2])]` so the
tuple type is real rather than an assertion over an `unknown[]`.

### Deliberately NOT validated here

- **Duplicate colours.** A colour collision only matters when the lookup table is
  built, and that is where it is detected — `buildColorIndex` throws. Splitting it
  this way keeps `manifest.ts` free of any packing knowledge.
- Whether `sum(pixelCount) === painted.pixelCount`. `src/assets.test.ts` already
  pins that as a data fact; the parser does not need a 1648-entry sum on every boot.
- Whether bounds lie inside the map. Same reason.

### Export

```ts
export {
  MANIFEST_FORMAT,
  MANIFEST_VERSION,
  PROVINCE_KINDS,
  indexProvincesById,
  parseManifest,
  parseManifestText,
  type Bounds,
  type MapInfo,
  type MapManifest,
  type PaintedInfo,
  type Point,
  type Province,
  type ProvinceKind,
};
```

---

## 3. `src/map/province-index.ts`

### The byte-order comment — write it verbatim

This is the one place the brief flags as the easiest silent bug. Put this comment
at the top of the packing section:

```ts
// `ImageData.data` is a `Uint8ClampedArray` laid out R, G, B, A — one byte per
// channel, in that order, on every platform. That order comes from the ImageData
// spec, not from the machine, so reading the four bytes by index is
// endian-independent.
//
// A `Uint32Array` VIEW over the same buffer is NOT endian-independent. On a
// little-endian machine pixel 0 reads back as 0xAABBGGRR; on a big-endian one as
// 0xRRGGBBAA. `../civitas-map/src/map/colors.ts` probes the endianness at startup
// for exactly this reason, and `import-provinces.ts` there takes such a view.
//
// This module never takes a u32 view. Every pixel is assembled from its four
// bytes, so the packed layout is 0x00RRGGBB on every platform, with no probe and
// no branch. Alpha is not packed — it is consumed by the UNPAINTED test below.
```

### Constants

```ts
// Valid packed colours occupy 0x000000..0xFFFFFF, so any value above that is free
// as a sentinel. It has to be a sentinel and not 0: no province in this map is
// black today, but nothing in the format forbids one, and a black province would
// otherwise be indistinguishable from bare canvas.
const UNPAINTED = 0xffffffff;
```

### Public functions

```ts
function packRgb(r: number, g: number, b: number): number;
function unpackRgb(packed: number): [number, number, number];
function packPixels(bytes: Uint8ClampedArray | Uint8Array, pixelCount: number): Uint32Array;
function buildColorIndex(provinces: readonly Province[]): Map<number, number>;
function sampleIntegrity(
  index: ProvinceIndex,
  provinces: readonly Province[],
  sampleSize: number,
): { checked: number; matched: number };
function decodeProvincePixels(bitmap: ImageBitmap): Uint32Array;
function createProvinceIndex(bitmap: ImageBitmap, manifest: MapManifest): ProvinceIndex;
```

### `packRgb` / `unpackRgb`

```ts
function packRgb(r: number, g: number, b: number): number {
  return (((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) >>> 0;
}
```

`unpackRgb` returns `[(packed >>> 16) & 0xff, (packed >>> 8) & 0xff, packed & 0xff]`.

### `packPixels`

```
if bytes.length !== pixelCount * 4:
    throw `pixel buffer is ${bytes.length} bytes, expected ${pixelCount * 4} for ${pixelCount} pixels`

out = new Uint32Array(pixelCount)

for i in 0 .. pixelCount - 1:
    base = i * 4
    if bytes[base + 3] !== 255:
        out[i] = UNPAINTED
        continue
    out[i] = ((bytes[base] << 16) | (bytes[base + 1] << 8) | bytes[base + 2]) >>> 0

return out
```

`!== 255` rather than `=== 0` on purpose: a canvas stores pixels premultiplied,
so a partly transparent pixel cannot be read back at its original colour
(`rgba(192,64,64,200)` returns `193,64,64`). A province is identified by an exact
colour, so a part-transparent pixel would invent a province that matches nothing.
The verified asset has only alpha 0 and 255, so this branch never fires on the
real file — it is a guard for a re-exported one. Say that in a comment.

Loop with an index and a local `base`; do not build intermediate arrays. 10.4 M
iterations, roughly 40 ms.

### `buildColorIndex`

```
index = new Map<number, number>()

for province of provinces:
    packed = packRgb(province.rgb[0], province.rgb[1], province.rgb[2])
    existing = index.get(packed)
    if existing !== undefined:
        throw `provinces ${existing} and ${province.id} share colour ${province.hex} — the pixel lookup would be ambiguous`
    index.set(packed, province.id)

return index
```

`UNPAINTED` can never collide with a key here: `0xffffffff` is outside the range
`packRgb` can produce. No guard needed; state that in a comment so nobody adds one.

Expected size on the real manifest: **1648**.

### `class ProvinceIndex`

```ts
class ProvinceIndex {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint32Array;
  readonly colorIndex: ReadonlyMap<number, number>;

  constructor(
    width: number,
    height: number,
    pixels: Uint32Array,
    colorIndex: ReadonlyMap<number, number>,
  );

  packedAt(x: number, y: number): number;
  provinceAt(x: number, y: number): number | null;
}
```

The constructor throws if `pixels.length !== width * height`:
`` `province bitmap is ${pixels.length} pixels, expected ${width * height} for ${width}x${height}` ``.

`packedAt`:

```
px = Math.floor(x)
py = Math.floor(y)
if px < 0 or py < 0 or px >= width or py >= height:
    return UNPAINTED
return pixels[py * width + px]
```

`provinceAt`:

```
packed = packedAt(x, y)
if packed === UNPAINTED:
    return null
id = colorIndex.get(packed)
return id === undefined ? null : id
```

Two things to nail down in comments:

- **Row-major.** The address is `y * width + x`. With a 3653-wide map a
  transposed index still lands inside the array most of the time and returns a
  plausible wrong province, so the test uses a non-square grid.
- **Fractional coordinates are floored, not rounded.** T03 hands over
  `screen -> map` floats and pixel `n` covers `[n, n + 1)`. Rounding would shift
  the pick half a pixel and pick the wrong province on every border.
- An opaque colour absent from the index returns `null`. The manifest's
  `unregisteredColors` is empty today, so this cannot fire on the real asset, but
  returning `null` rather than throwing keeps a hover handler from crashing.

### `sampleIntegrity`

A cheap self-check for the failure mode nothing else catches: the browser
colour-converting the bitmap on decode, which shifts every RGB and silently makes
every lookup return `null`.

```
checked = 0
matched = 0
limit = Math.min(sampleSize, provinces.length)

for i in 0 .. limit - 1:
    province = provinces[i]
    checked += 1
    if index.provinceAt(province.centroid.x, province.centroid.y) === province.id:
        matched += 1

return { checked, matched }
```

**A centroid is a centre of mass, so it is not guaranteed to lie inside its own
province.** Measured: 14 of 1648 do not. Over the first 200 provinces, 3 miss.
So this is a ratio test, never an all-must-match test. `loadMapAssets` calls it
with `sampleSize = 200` and fails below **0.9**. A correct decode scores ~0.985
there; a colour-converted one scores ~0.

### `decodeProvincePixels`

The only DOM-touching function in this module. It must stay inside a function
body — `province-index.test.ts` imports this module in Node, where `document`
does not exist, so any top-level DOM access breaks the test run.

```
width = bitmap.width
height = bitmap.height

canvas = document.createElement("canvas")
canvas.width = width
canvas.height = height

ctx = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" })
if !ctx: throw "2d canvas context unavailable"

ctx.imageSmoothingEnabled = false
ctx.drawImage(bitmap, 0, 0)          // untransformed: a pixel-for-pixel copy

data = ctx.getImageData(0, 0, width, height).data
pixels = packPixels(data, width * height)

canvas.width = 0                     // release the ~42 MB backing store
canvas.height = 0

return pixels
```

`colorSpace: "srgb"` is the default; pass it anyway so nobody "helpfully" changes
it. Do **not** pass `premultiplyAlpha` or `colorSpaceConversion` options to the
canvas — the bitmap-side option is set at `createImageBitmap` in `map-assets.ts`.

### `createProvinceIndex`

```
if bitmap.width !== manifest.map.width or bitmap.height !== manifest.map.height:
    throw `provinces_map.png is ${bitmap.width}x${bitmap.height}, the manifest describes ${manifest.map.width}x${manifest.map.height}`

pixels = decodeProvincePixels(bitmap)
colorIndex = buildColorIndex(manifest.provinces)

return new ProvinceIndex(manifest.map.width, manifest.map.height, pixels, colorIndex)
```

### Export

```ts
export {
  ProvinceIndex,
  UNPAINTED,
  buildColorIndex,
  createProvinceIndex,
  decodeProvincePixels,
  packPixels,
  packRgb,
  sampleIntegrity,
  unpackRgb,
};
```

---

## 4. `src/map/map-assets.ts`

### URLs

```ts
// Relative, with no leading slash. The dev server maps `./assets` onto `/assets`
// and CopyRspackPlugin emits `dist/assets/`, so the same string resolves in both.
// A leading slash would pin the app to the domain root; the app has no router, so
// the document URL is always `/`, and a relative path also survives being served
// from a subdirectory.
const MANIFEST_URL = "assets/provinces_manifest.json";
const PROVINCE_IMAGE_URL = "assets/provinces_map.png";
const MAP_IMAGE_URL = "assets/map.png";
```

### Types

```ts
type LoadStep = "manifest" | "province-bitmap" | "province-index" | "map-art" | "done";

const LOAD_STEPS: readonly LoadStep[] = [
  "manifest",
  "province-bitmap",
  "province-index",
  "map-art",
  "done",
];

type LoadedMapAssets = {
  manifest: MapManifest;
  index: ProvinceIndex;
  art: ImageBitmap;
};
```

### Public functions

```ts
async function fetchBitmap(url: string): Promise<ImageBitmap>;
async function loadMapAssets(onStep?: (step: LoadStep) => void): Promise<LoadedMapAssets>;
```

`fetchBitmap`:

```
response = await fetch(url)
if !response.ok: throw `${url} responded ${response.status}`
blob = await response.blob()
return await createImageBitmap(blob, { colorSpaceConversion: "none" })
```

`colorSpaceConversion: "none"` because these pixels are identity data, not colour.
Verified: `provinces_map.png` carries no `sRGB`/`gAMA`/`iCCP` chunk, so no
conversion would happen either way — the option makes the intent explicit and
holds if the asset is ever re-exported with a profile.

A private `fetchManifest(url)` reads `response.text()` and hands it to
`parseManifestText`, rather than calling `response.json()`. A dev server that
answers a missing path with `index.html` then fails as
`"manifest is not valid JSON"` instead of a bare `SyntaxError` with no URL in it.
Prefix the rethrown message with the URL: `` `${url}: ${message}` ``.

`loadMapAssets` algorithm:

```
// All three requests start together: the province PNG is 566 KB, the art 2.6 MB,
// and the decode cannot start before its bytes arrive.
manifestPromise = fetchManifest(MANIFEST_URL)
provincePromise = fetchBitmap(PROVINCE_IMAGE_URL)
artPromise = fetchBitmap(MAP_IMAGE_URL)

// Awaited in order below, so the two later ones would be "unhandled" for a tick
// if the first rejects. A no-op catch on each keeps the console clean; the real
// rejection is still delivered at the await.
for promise of [manifestPromise, provincePromise, artPromise]:
    promise.catch(() => undefined);

onStep?.("manifest")
manifest = await manifestPromise

onStep?.("province-bitmap")
provinceBitmap = await provincePromise

onStep?.("province-index")
try:
    index = createProvinceIndex(provinceBitmap, manifest)
finally:
    provinceBitmap.close()          // ~42 MB, and the pixels are packed by now

sample = sampleIntegrity(index, manifest.provinces, 200)
if sample.checked > 0 and sample.matched / sample.checked < 0.9:
    throw `the province bitmap disagrees with the manifest (${sample.matched}/${sample.checked} sampled centroids matched) — the image was probably colour-converted on decode`

onStep?.("map-art")
art = await artPromise

// map.png is one pixel narrower than provinces_map.png by design (PLAN section 2).
// Same height, at most one pixel of width difference. Anything else is a
// different map and would put every province in the wrong place.
if Math.abs(art.width - manifest.map.width) > 1 or art.height !== manifest.map.height:
    throw `map.png is ${art.width}x${art.height}, which does not match the ${manifest.map.width}x${manifest.map.height} province map`

onStep?.("done")

return { manifest, index, art }
```

`art` is **not** closed — it is the render source for T03.

### Export

```ts
export {
  LOAD_STEPS,
  MANIFEST_URL,
  MAP_IMAGE_URL,
  PROVINCE_IMAGE_URL,
  fetchBitmap,
  loadMapAssets,
  type LoadStep,
  type LoadedMapAssets,
};
```

---

## 5. `src/state/map-store.ts`

Mirrors the reference's rule (`../civitas-map/src/state/editor-state.ts`, the
comment above `let bitmap`): **large mutable objects are plain module variables,
not signals.** A signal carries identity and status; a 42 MB `Uint32Array` in a
signal would be diffed and re-read by every subscriber for nothing.

```ts
type LoadPhase = "idle" | "loading" | "ready" | "failed";

const loadPhase = signal<LoadPhase>("idle");
const loadStep = signal<LoadStep>("manifest");
const loadError = signal<string | null>(null);
const mapSize = signal<{ width: number; height: number } | null>(null);
const provinceCount = signal(0);

const loadProgress = computed(() => {
  if (loadPhase.value === "ready") {
    return 1;
  }
  if (loadPhase.value !== "loading") {
    return 0;
  }
  const at = LOAD_STEPS.indexOf(loadStep.value);
  return at < 0 ? 0 : at / (LOAD_STEPS.length - 1);
});

let assets: LoadedMapAssets | null = null;
let byId: Map<number, Province> | null = null;
let inFlight: Promise<void> | null = null;
```

Public functions:

```ts
async function ensureMapLoaded(): Promise<void>;
function getMapAssets(): LoadedMapAssets | null;
function provinceAt(x: number, y: number): number | null;
function provinceById(id: number): Province | null;
```

`ensureMapLoaded`:

```
if assets: return
if inFlight: return inFlight        // idempotent: two components may both ask

loadPhase.value = "loading"
loadStep.value = "manifest"
loadError.value = null

inFlight = (async () => {
    try:
        loaded = await loadMapAssets((step) => { loadStep.value = step; })
        assets = loaded
        byId = indexProvincesById(loaded.manifest.provinces)
        mapSize.value = { width: loaded.manifest.map.width, height: loaded.manifest.map.height }
        provinceCount.value = loaded.manifest.provinces.length
        loadPhase.value = "ready"
    catch (error):
        loadError.value = error instanceof Error ? error.message : String(error)
        loadPhase.value = "failed"
    finally:
        inFlight = null
})()

return inFlight
```

`ensureMapLoaded` **never rejects**. A failure lands in `loadError` and
`loadPhase`. A caller in an effect that ignores the promise must not produce an
unhandled rejection.

`provinceAt` returns `null` when `assets` is null — callers run before the load
finishes and must not have to guard.
`provinceById` reads `byId`, never `provinces[id - 1]`. **Ids run 1..1650 for
1648 provinces; positions 1318 and 1458 do not exist.** Comment it.

### Export

```ts
export {
  ensureMapLoaded,
  getMapAssets,
  loadError,
  loadPhase,
  loadProgress,
  loadStep,
  mapSize,
  provinceAt,
  provinceById,
  provinceCount,
  type LoadPhase,
};
```

---

## 6. `rspack.config.mjs` change

```js
plugins: [
  new rspack.HtmlRspackPlugin({
    template: "./index.html",
  }),
  // Copied, not imported. `map.png` is 2.6 MB and `provinces_map.png` 566 KB;
  // an `asset/resource` import would hash the filenames for no benefit here, and
  // an inlined data URL would be catastrophic. Copying keeps `assets/<name>` as
  // one stable URL that `devServer.static` already answers in dev.
  new rspack.CopyRspackPlugin({
    patterns: [
      {
        from: "assets",
        to: "assets",
      },
    ],
  }),
],
```

Verified: `rspack.CopyRspackPlugin` exists in the pinned `@rspack/core` 2.1.4.
`noErrorOnMissing` stays at its default `false`, so a missing `assets/` fails the
build instead of shipping a broken app.

`devServer.static` stays exactly as it is. In dev, rspack serves the compiled
output first and falls back to the static directory; both hold the same bytes.

`dist/` grows from 196 K to roughly 3.5 MB. That is the expected outcome, not a
regression. `src/assets.test.ts` and the import guard in `src/scaffold.test.ts`
assert nothing about `dist` size.

### `src/scaffold.test.ts` change

Two lines at the end of `"rspack config keeps the settings CSS modules and JSX depend on"`:

```ts
// T02 added CopyRspackPlugin. Assets are copied, never imported — the import
// guard above still holds.
assert.equal(config.plugins.length, 2);
const copyPlugin = config.plugins.find((plugin) => {
  return plugin.constructor.name.includes("Copy");
});
assert.ok(copyPlugin, "assets must be copied into the build");
```

Do not weaken the two `doesNotMatch` assertions in
`"no source file imports a map asset into the bundle"`. Nothing in this design
matches them: `"assets/map.png"` is a plain string, not an `import`.

---

## 7. `src/App.tsx`

```tsx
function App() {
  useSignals();

  useEffect(() => {
    ensureMapLoaded();
  }, []);

  ...
}
```

`useSignals()` from `@preact/signals-react/runtime` at the top — PLAN section 4,
reactivity is opt-in per component. Without it none of this re-renders.

Rendered content:

1. A status line driven by `loadPhase`: `idle` / `loading <step> <percent>` /
   `ready` / `failed: <loadError>`. Use `loadProgress` for the percent.
2. When ready: map size, province count, and the size of the colour index.
3. The **smoke probe** — a table of the six verified pixels in section 0 with the
   id `provinceAt` returns for each, so a wrong answer is visible without opening
   the console. Also `console.info` the same rows once, in an effect that runs
   when `loadPhase` turns `"ready"` — the task's stated done-condition is a log.
4. Two number inputs (`x`, `y`, `useState`) and a live readout of
   `provinceAt(x, y)` plus the name from `provinceById`. This is the "report the
   province id under a given pixel" half of the brief.

Do **not** render the map, add a canvas, or wire hover. That is T03.

`noUnusedLocals` and `noUnusedParameters` are on. Any leftover import fails
`yarn typecheck`.

---

## 8. Tests

Both files sit beside their source. Both are pure Node — no DOM, no signals, no
React. `tsx --test "src/**/*.test.ts"` **does** recurse into `src/map/`; I
verified it by dropping a probe test into `src/__probe/deep/` and watching the
count go 29 -> 30.

Read the real assets from disk with `node:fs` and
`fileURLToPath(new URL("../../assets/...", import.meta.url))`, the way
`src/assets.test.ts` already does.

### `src/map/manifest.test.ts`

Build a `validManifest()` fixture helper returning a fresh two-province object
each call, so a mutating test cannot leak.

- The fixture parses, and every field survives: `rgb` is a 3-tuple with the right
  values, `bounds` and `centroid` are copied field by field.
- The parser returns a **new** object: `parsed.provinces[0] !== fixture.provinces[0]`.
- Rejections, each asserted on its message with `assert.throws(fn, /.../)`:
  `null`, `42`, `"text"`, `[]` payloads; missing `format`; `format:
  "civitas.province-map-v2"`; missing `version`; `version: 2`; `version: "1"`;
  `map` missing; `map.width` zero, negative or fractional; `provinces` missing;
  `provinces` an object; duplicate `id`; `id: 0`; `kind: "mountain"`;
  `rgb: [152, 215]`; `rgb: [152, 215, 300]`; `rgb: [152, 215, 171.5]`;
  `hex: "98d7ab"` (no hash); `hex` disagreeing with `rgb`; `pixelCount: -1`;
  `bounds` missing a field; `centroid` fractional; `painted` missing;
  `painted.unregisteredColors` holding a number.
- `parseManifestText("{ not json")` throws `/not valid JSON/`.
- **The real asset**: `parseManifestText(readFileSync(...))` succeeds; 1648
  provinces; every `kind === "land"`; `map` is 3653 x 2855;
  `painted.pixelCount === 2756578`; `painted.unregisteredColors` is empty.
- `indexProvincesById` on the real manifest: size 1648; `get(1)!.hex === "#98d7ab"`;
  `get(1650)` is defined; **`get(1318)` and `get(1458)` are `undefined`**; and
  `provinces[1317].id !== 1318` — the assertion that makes the position-vs-id trap
  fail loudly if anyone "fixes" it.

### `src/map/province-index.test.ts`

Packing — the byte-order core:

- `packRgb(0, 0, 0) === 0x000000`, `packRgb(255, 255, 255) === 0xffffff`.
- `packRgb(1, 2, 3) === 0x010203`. Symmetric inputs cannot catch a swapped
  channel order; this one can.
- `packRgb(152, 215, 171) === 0x98d7ab` — tied to province 1's own `hex` string
  from the real manifest, parsed with `Number.parseInt(hex.slice(1), 16)`. So the
  packing agrees with the format's own notation and not just with itself.
- `unpackRgb(packRgb(r, g, b))` round-trips for a handful of triples including
  `(0, 0, 255)` and `(255, 0, 0)`.
- `packPixels` on a hand-built 4-pixel RGBA byte array
  `[152,215,171,255, 0,0,0,0, 1,2,3,255, 9,9,9,128]`
  gives `[0x98d7ab, UNPAINTED, 0x010203, UNPAINTED]`. This is the single test the
  brief asks for: it pins channel order, the alpha rule, and the partial-alpha rule
  in one shot.
- **Anti-u32-view test**: for every non-`UNPAINTED` output of `packPixels`, assert
  `value <= 0xffffff`. A `new Uint32Array(bytes.buffer)` view would put alpha in
  the high byte and blow past that on any host, little- or big-endian. Assert it
  on a fixture whose alpha is 255 and whose red channel is high, so the two
  interpretations genuinely differ.
- `packPixels` throws when `bytes.length !== pixelCount * 4`.

Index building:

- `buildColorIndex` on two provinces: size 2, `get(packRgb(...)) === id`.
- `buildColorIndex` throws when two provinces share an `rgb`, and the message
  names **both** ids.
- `buildColorIndex` on the real manifest: size 1648, no throw. This is the
  1648-entry assertion the brief asks for.
- No key equals `UNPAINTED`.

`ProvinceIndex.provinceAt`, on a **3 x 2** synthetic grid (non-square on purpose,
so a transposed address is detectable):

```
row 0: A  B  UNPAINTED
row 1: B  A  C          (C is opaque but absent from the colour index)
```

- `provinceAt(0, 0)`, `(1, 0)`, `(0, 1)`, `(1, 1)` return the right ids. A
  transposed `x * height + y` gives a different answer at (2, 0) and (0, 1).
- `provinceAt(2, 0)` is `null` — unpainted.
- `provinceAt(2, 1)` is `null` — opaque but unregistered.
- `provinceAt(-1, 0)`, `(0, -1)`, `(3, 0)`, `(0, 2)` are all `null`.
- `provinceAt(1.9, 0.9) === provinceAt(1, 0)` — floored, not rounded. Add
  `provinceAt(0.6, 0) !== provinceAt(1, 0)` so a `Math.round` fails.
- The constructor throws when `pixels.length !== width * height`.
- `packedAt` outside the grid returns `UNPAINTED`.

`sampleIntegrity` on the same synthetic grid with a fabricated province list:
one province whose centroid hits itself and one whose centroid lands on a
neighbour -> `{ checked: 2, matched: 1 }`. Also `sampleSize` larger than the list
clamps to the list length.

### Not covered by tests, and why

- `map-assets.ts` and `map-store.ts`. `fetch`, `createImageBitmap`, canvas and
  signals are all runtime, and PLAN section 4 forbids DOM and canvas tests. The
  browser smoke probe in section 9 is their gate.
- `decodeProvincePixels`. Same reason. Its whole job is to hand bytes to
  `packPixels`, which is tested exhaustively.
- Real pixel content of `provinces_map.png`. Decoding a PNG in Node needs a
  decoder this package does not have and must not gain. The six verified probe
  pixels in section 0 are checked in the browser.

---

## 9. Verification — the implementer runs all of these

From `PKG`:

```bash
yarn typecheck        # must print nothing, exit 0
yarn test             # must pass; count must RISE from 30, and the new test
                      # names from src/map/ must appear in the output
yarn build            # must succeed
ls -la dist/assets    # must list map.png, provinces_map.png,
                      # provinces_manifest.json, country-flag.jpg
du -sh dist           # ~3.5 MB, up from 196K — expected
grep -rn "'" src/     # must print nothing (no single-quoted strings)
```

If the test count does not rise, the glob is not picking up `src/map/`. It does —
verified — so a flat count means the files are misnamed.

Then, in a browser:

```bash
yarn dev              # note the port it prints
```

Open the app and confirm, from the page itself:

- The status goes `loading` -> `ready`. No red error.
- Map size **3653 x 2855**, province count **1648**, colour index size **1648**.
- The probe table reads exactly:

| Pixel | Expected |
|---|---|
| (598, 391) | 1 |
| (1496, 395) | 2 |
| (1382, 1329) | 1000 |
| (1513, 2744) | 1650 |
| (0, 0) | null |
| (3652, 2854) | null |

- Typing another coordinate into the x/y inputs updates the reported id live.
- The console shows the same probe rows, and **no** unhandled-rejection warning.
- The Network tab shows `assets/provinces_manifest.json`,
  `assets/provinces_map.png` and `assets/map.png` all at 200, none of them
  inlined into the JS bundle.

Then check the production build serves the same way:

```bash
cd dist && yarn :static
```

Open the printed URL and confirm the same probe table. This is what proves the
copy plugin, and not just `devServer.static`, is doing the work.

Finally, deliberately break it once and confirm the error path: edit
`assets/provinces_manifest.json` in a scratch copy to `"version": 2`, point
`MANIFEST_URL` at it, reload, and confirm the page shows
`failed: assets/...: manifest version is 2, expected 1`. **Revert both edits.**

---

## 10. Edge cases and failure modes that must be handled

1. **Endianness.** Never take a `Uint32Array` view over `ImageData.data`. Section 3.
2. **Colour management on decode.** No profile chunk on the province PNG, and
   `colorSpaceConversion: "none"` on the bitmap. `sampleIntegrity` catches it if a
   browser converts anyway.
3. **Premultiplied alpha.** Alpha `!== 255` is unpainted, not "snap to opaque".
4. **A black province.** Legal in the format. `UNPAINTED` is `0xffffffff`, outside
   the packable range, so `0x000000` stays a usable key.
5. **Non-contiguous province ids.** 1..1650 for 1648 entries; 1318 and 1458 are
   missing. Always `Map`-by-id, never `provinces[id - 1]`.
6. **Duplicate colours** would make the lookup ambiguous. `buildColorIndex` throws
   and names both ids.
7. **Duplicate ids** — `parseManifest` throws.
8. **`map.png` is 1 px narrower.** Tolerance of 1 on width, exact on height.
9. **Bitmap / manifest size mismatch** — `createProvinceIndex` throws.
10. **Non-2xx fetch** — message names the URL and the status.
11. **HTML served for a missing JSON path** — text-then-parse, so the message
    names the URL.
12. **`getContext("2d")` returning null** — throw, do not `!`-assert.
13. **`getImageData` `SecurityError`.** Cannot happen today: the assets are
    same-origin. It would start happening if anyone moved them to a CDN. Note it
    in a comment next to the call.
14. **Double load.** `ensureMapLoaded` is idempotent through `inFlight`.
15. **`ensureMapLoaded` must never reject.** A React effect that ignores the
    promise must not raise an unhandled rejection.
16. **Reads before the load finishes.** `provinceAt` and `provinceById` return
    `null`, never throw.
17. **Out-of-range and fractional coordinates** — clamp to `null`, floor floats.
18. **Memory.** The packed `Uint32Array` is 10 429 315 x 4 = **41.7 MB** and lives
    for the app's lifetime. The `ImageData` copy and the canvas backing store are
    another 41.7 MB each — release both (`canvas.width = 0`) and `close()` the
    province `ImageBitmap`. Peak is ~125 MB during the decode; steady state ~42 MB
    plus the art bitmap.
19. **Do not transfer `index.pixels` to the T04 worker.** A transfer detaches the
    buffer and every later `provinceAt` reads zeroes. Leave a comment saying so.
20. **`assert.equal(config.plugins.length, 1)`** in `src/scaffold.test.ts` fails
    the moment the copy plugin lands. Update it in the same change, section 6.

---

## 11. Explicitly NOT part of T02

- Rendering anything. No canvas in the UI, no `MapCanvas`, no zoom, no pan. T03.
- The view transform and screen <-> map conversion. T03.
- Border extraction, the border worker, and any second pass over the pixels. T04.
- Hover, selection, and click handling. T08.
- Countries, province -> country assignment, and country colours. T06.
- `localStorage`, persistence, and migrations. T05.
- Using `assets/country-flag.jpg` for anything. It is copied into `dist` because
  it lives in `assets/`; nothing reads it yet. T09.
- Web workers, `OffscreenCanvas`, and moving the decode off the main thread. The
  decode is ~150 ms once, behind a progress indicator. Not worth the complexity now.
- Any new dependency, including a PNG decoder for Node-side tests.
- Changing `tsconfig.json`, `package.json`, `index.html`, `src/env.d.ts`,
  `src/main.tsx`, `src/index.css`, or `src/assets.test.ts`.
- Touching `../civitas-map` in any way.
