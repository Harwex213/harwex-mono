# Civitas interactive map

An interactive game map for the Civitas province set. It is a static web app with no
backend. Players inspect and edit countries and provinces, and run a country economy
sheet backed by a real calculator.

The sibling package `../civitas-map` is the editor that produced the assets. This
package only reads them. It never imports from the editor.

Stack: rspack, TypeScript, React 19, `@preact/signals-react`. Rendering is Canvas 2D.

```bash
yarn dev          # dev server on an OS-picked port
yarn build        # bundle to dist/
yarn typecheck    # tsc --noEmit; prints nothing on success
yarn test         # tsx --test over src/**/*.test.ts
```

Run those from this directory, or as `yarn workspace @hw/civitas-interactive-map <script>`
from `javascript/`. The workspace uses the `node-modules` linker and hoists to
`javascript/node_modules`, so this package has no `node_modules` of its own.

## Assets

Four files live in `assets/`. The dev server serves that directory at `/assets`.
The production build copies the same directory to `dist/assets` through
`rspack.CopyRspackPlugin`. Both paths answer the same URLs, so the code requests
`assets/map.png` with no leading slash.

| File | What it is |
|---|---|
| `provinces_map.png` | 3653 x 2855 RGBA. One flat unique colour per province. The pick and border source. |
| `map.png` | 3652 x 2855 RGBA. The artistic render. Display only. |
| `provinces_manifest.json` | 588 KB. Describes all 1648 provinces. |
| `country-flag.jpg` | 735 x 490. One sample flag. |

`provinces_map.png` is the authoritative surface. `map.png` is exactly 1 px narrower
and the same height, so screen to map pixel lookup is 1:1 with no rescaling.

No source file under `src/` may import a file from `assets/`. A test enforces this.
The rule keeps the 2.5 MB PNG and the 588 KB manifest out of the bundle.

## Manifest contract

```jsonc
{
  "format": "civitas.province-map",
  "version": 1,
  "map": { "source": "Karta_provintsiy.png", "width": 3653, "height": 2855 },
  "provinces": [
    {
      "id": 1,
      "name": "Province 1",
      "kind": "land",
      "hex": "#98d7ab",
      "rgb": [152, 215, 171],
      "pixelCount": 1152,
      "bounds": { "x": 577, "y": 364, "width": 37, "height": 58 },
      "centroid": { "x": 598, "y": 391 }
    }
  ],
  "painted": { "pixelCount": 2756578, "coverage": 0.264311, "unregisteredColors": [] }
}
```

A parser must reject any `format` other than `civitas.province-map` and any `version`
other than `1`.

Facts a consumer can rely on, each pinned by a test in `src/assets.test.ts`:

- All 1648 provinces are `kind: "land"`.
- **Ids are unique but not contiguous.** The highest id is 1650, so two ids are
  missing. Index provinces by a `Map` keyed on id. `provinces[id - 1]` returns the
  wrong province.
- Every packed RGB value is distinct, so a colour lookup table cannot collide.
- `centroid` is the centre of mass, not the centre of `bounds`. Labels and markers
  belong on the centroid.
- Every name is the placeholder `"Province <id>"`.
- The manifest holds no country data. The user creates countries inside the app.

## Architecture

The app boots from `src/main.tsx`, which mounts `App` with `createRoot`. There is no
`StrictMode`.

Reactivity is opt-in per component. A component that reads a signal calls
`useSignals()` from `@preact/signals-react/runtime` at its top. The repo has no babel
plugin, so a component that skips the call does not re-render.

State lives in `localStorage` alone under the versioned key `civitas.state.v1`. There
is no export or import UI and no server.

### Files so far

| Path | What it is |
|---|---|
| `src/main.tsx` | Entry. Mounts `App`. |
| `src/App.tsx` | Mounts `MapCanvas` and overlays the load status until the assets are ready. |
| `src/index.css` | Dark theme tokens, reset, base control styling. Copied from `../civitas-map`. |
| `src/env.d.ts` | Ambient declarations for `*.module.css` and `*.css`. |
| `src/map/manifest.ts` | Manifest types and the strict parser. |
| `src/map/province-index.ts` | Colour packing and the packed-colour to province-id lookup. |
| `src/map/map-assets.ts` | Asset URLs and the three-request load pipeline. |
| `src/map/view.ts` | The pure view transform. Fit, clamp, zoom, screen to map, draw rect. |
| `src/map/borders.ts` | Pure border extraction. Scan, country recompute, tiling, tile culling. |
| `src/map/borders.worker.ts` | The worker shell around `borders.ts`. Holds the ids and the crossings. |
| `src/state/map-store.ts` | Load-status signals and the app-facing lookup functions. |
| `src/state/view-store.ts` | View signals and the guarded actions that write them. |
| `src/state/borders-store.ts` | Worker lifecycle, border signals, and the `Path2D` accessors. |
| `src/state/selection-store.ts` | Hovered and selected province ids, with deduplicating setters. |
| `src/state/schema.ts` | The document types, the sparse serialiser and the repairing parser. |
| `src/state/migrations.ts` | The ordered migration chain and its runner. Shipped empty. |
| `src/state/persistence.ts` | Storage injection, `readState`, `writeState` and the debounced writer. |
| `src/state/world-store.ts` | The world signals, the actions, and the mutation-to-write wiring. |
| `src/state/image.ts` | Upload downscaling and the two pure size helpers. |
| `src/ui/MapCanvas.tsx` | The two canvases, the input handlers and the frame loop. |
| `src/ui/render.ts` | Canvas drawing. `drawScene` for the art, `drawOverlay` for the overlay. |
| `src/ui/border-layer.ts` | `Path2D` tiles, the border stroke, and the two border styles. |
| `src/ui/highlight-layer.ts` | The province highlight stamp and its cache. |
| `src/scaffold.test.ts` | Pins the build and workspace contract. |
| `src/assets.test.ts` | Pins the asset dimensions and the manifest facts above. |

### Conventions

- `javascript/CLAUDE.md` governs code style. Statements end with `;`, `if` and loops
  always use braces, strings use double quotes, each file has one grouped named
  export at its end, and CSS has one declaration per line.
- Dependency versions are exact. No `^`, no `~`. They match `../civitas-map`.
- `tsconfig.json` is standalone and does not extend `@hw/typescript-config`. It sets
  `strict`, `noUnusedLocals` and `noUnusedParameters`. There are no path aliases.
- CSS modules sit beside their component as `*.module.css`.
- Tests use Node's built-in runner through `tsx` and sit beside the file they test.
  They cover pure logic only. There is no jsdom, so DOM and canvas go untested.

## Asset loading

`src/map/manifest.ts` parses the manifest. `parseManifest` takes a parsed JSON
value and `parseManifestText` takes the raw body. Both validate every field and
throw on the first problem. A `format` other than `civitas.province-map` and a
`version` other than the number `1` are rejected. The parser builds new objects,
so an unvalidated key cannot reach a caller. The parser does not check colours;
`buildColorIndex` owns that check.

`src/map/province-index.ts` turns the province bitmap into a lookup.
`decodeProvincePixels` draws the `ImageBitmap` to a canvas and reads the RGBA
bytes. `packPixels` packs each pixel into one `0x00RRGGBB` word. `buildColorIndex`
maps each packed colour to its province id. `ProvinceIndex.provinceAt(x, y)`
returns the province id under a map pixel, or `null` outside the map and on bare
canvas.

Three rules govern the packing:

- The packing reads the four bytes one at a time. It never takes a `Uint32Array`
  view over the buffer, because such a view has a machine-dependent byte order.
  The layout is therefore `0x00RRGGBB` on every platform.
- `UNPAINTED` is `0xffffffff`, not `0`. Black is a legal province colour, so a
  sentinel of `0` would collide with it.
- Any alpha below 255 counts as unpainted. A canvas stores pixels premultiplied,
  so a part-transparent pixel cannot be read back at its original colour.

`src/map/map-assets.ts` runs the load. `loadMapAssets` starts all three requests
together, then awaits the manifest, the province bitmap and the art in that
order. It reports each step through an optional callback. It closes the province
bitmap once the pixels are packed, and it keeps the art bitmap open as the render
source for T03. Two checks guard the result. A centroid sample must place at
least 90% of sampled provinces inside their own colour; a lower score means the
image was colour-converted on decode. `map.png` must match the manifest height
exactly and the manifest width within one pixel.

`src/state/map-store.ts` is the app-facing surface. `ensureMapLoaded()` is
idempotent and never rejects. A failure lands in the `loadError` and `loadPhase`
signals instead. The signals are `loadPhase`, `loadStep`, `loadError`, `mapSize`,
`provinceCount` and the computed `loadProgress`. The 42 MB pixel array is a plain
module variable, not a signal. `provinceAt(x, y)` and `provinceById(id)` return
`null` until the load finishes, so a caller that runs during loading needs no
guard. Render off `loadPhase === "ready"`, not off a truthy check of the art
bitmap.

Traps for later tasks:

- `provinceAt` floors its arguments. Pass screen-to-map floats straight in.
- Never transfer `ProvinceIndex.pixels` to a worker. A transfer detaches the
  buffer, and every later `provinceAt` then reads zeroes.
- 14 of the 1648 centroids fall outside their own province. The integrity check
  is a ratio test for that reason. Do not tighten it into an all-must-match test.
- `yarn build` prints two size warnings for the copied assets. The warnings are
  accurate and are not silenced.

## Rendering, zoom and pan

The map is drawn on two stacked canvases inside one host element. The lower
canvas holds the art. The upper canvas holds the overlay. Both are painted in
the same animation frame from the same view, so the overlay can never slide
against the art during a pan.

### The view transform

`src/map/view.ts` is pure. It has no DOM, no canvas and no signals, so every
function is unit tested in Node.

A view is `{ scale, x, y }`. `scale` is CSS pixels per map pixel, not device
pixels. `x` and `y` say where map pixel (0, 0) sits inside the viewport, in CSS
pixels. `MAX_SCALE` is 8, which is 16 device pixels per map pixel on a 2x
display. The device pixel ratio enters only at `snapView` and at draw time.

The minimum scale is the fit scale with no padding. `fitScale` takes the smaller
of the two axis ratios, so at minimum zoom the whole map is visible and one axis
touches both viewport edges.

`clampTranslate` runs two regimes per axis. An axis larger than the viewport is
clamped to the map edges, so no background gap opens. An axis smaller than the
viewport is locked to its centred value. The second regime is not hypothetical.
It applies to one axis at and near minimum zoom.

`zoomAt` reads the anchor point through the old scale, then solves the
translation for the new clamped scale. The map point under the cursor therefore
stays under the cursor. `zoomAt` returns the same object reference when the
scale did not change, and `view-store` uses `!==` to skip the signal write. That
guard is what stops a wheel held at the 8x cap from repainting forever.

`sourceRect` snaps the source rectangle to whole source pixels and derives the
destination from those integers. `dw / sw` is therefore exactly `scale`. A
fractional source rectangle makes the browser resample with a shifting phase,
which shimmers during a pan.

### Drawing

`src/ui/render.ts` owns the canvas calls. `prepare` sets the transform to the
device pixel ratio and clears the frame, so a leaked transform cannot
accumulate. `drawScene` calls the 9-argument `drawImage` with the rectangle
`sourceRect` computed. At scale 8 that reads about one viewport divided by 8 of
source pixels, not the whole 10.4 megapixel image.

`shouldSmooth` is `scale * dpr < 1`. Smoothing is decided in device pixels. At
scale 0.7 on a 2x display each map pixel already covers 1.4 device pixels, and
smoothing there turns the flat province colours to mush. The sibling package
`../civitas-map` tests `scale < 1` instead. Do not copy that line.

`map.png` is 3652 px wide and the authoritative map is 3653 px wide, so map
column 3652 has no art. `drawEdgeColumn` repeats the art's last column into that
gap. It is guarded on `gap > 0`, so a future re-export at the full width draws
nothing extra.

`drawOverlay` strokes a 1 CSS px hairline around the map bounds. The hairline is
an instrument, not decoration. Both canvases snap the view with the same
function and the same ratio, so the hairline and the art edge coincide to the
pixel. A hairline that detaches from the art means the two transforms have
diverged.

### Input

`src/ui/MapCanvas.tsx` handles the gestures.

- The wheel zooms toward the cursor. The listener is native with
  `{ passive: false }`, because React registers `onWheel` passively and ignores
  `preventDefault` there. `deltaMode` is converted through `[1, 16, 100]`.
  Firefox reports one notch as `deltaY: 3, deltaMode: 1`, and treating that as 3
  pixels makes the wheel feel dead.
- A left drag pans. The gesture starts after 3 px of movement. The pan is always
  the origin plus the total delta, never an accumulation of per-move deltas.
- A double click zooms 2x toward the clicked point, with no animation.
- The context menu is suppressed. T08 puts right-click country selection there.

Every draw goes through one `requestAnimationFrame` handle. `scheduleDraw` is a
no-op while a frame is pending, so a burst of wheel events yields one paint per
frame. `draw` reads every input fresh instead of closing over values, so a
coalesced frame paints the newest state.

### The view store

`src/state/view-store.ts` holds `view`, `viewport`, `dpr`, `cursorMap` and
`panning`. The view lives in a store rather than in component state because T04,
T07 and T08 all need it.

`view.value` is `View | null`. It stays null until both the map size and a
non-zero viewport exist, because those arrive from two independent async
sources. `syncView()` is the single initialisation point and runs from both
paths. Guard the null; do not invent a default.

Three rules govern the actions:

- Every action returns without writing when the map size is null or either
  viewport dimension is at most 0.
- Every action skips the write when nothing changed. A fresh object is never
  `Object.is`-equal, so a write always notifies.
- No action may be called from inside a `useSignalEffect`. Each one writes
  signals it also reads, which is a loop. Call them from DOM handlers and plain
  `useEffect`s.

#### The fitted policy (T08-FIX)

`viewFitted` is a fourth signal, and it decides what a viewport resize does.

The view is *fitted* while it sits at the fit scale — that is, while the user
has not deliberately zoomed away from it. A fresh load is fitted. On a resize a
fitted view recomputes and takes the new fit scale; a view that is not fitted
keeps its absolute scale and only re-clamps its translation.

The flag is **derived, never set by hand**. `writeView` recomputes it as
`isFittedScale(next.scale, mapSize, viewport)` on every write, so a wheel notch,
a double click, `resetView` and any zoom control added later all maintain it
with no per-action wiring. It cannot go stale. `writeView` derives it **before**
its `sameView` early return, because a resize that leaves the view untouched
still has to re-evaluate the flag against the new viewport. It reads `mapSize`
and `viewport` with `.peek()`, never `.value`, because `writeView` runs from DOM
handlers and must not widen anyone's dependency set.

`syncView` reads the flag **one viewport stale on purpose**. `setViewport`
writes the new viewport a line before it calls `syncView`, so the stored flag
still describes the previous viewport — which is exactly the question being
asked: *was the user fitted before this resize.*

The resize path calls `resizeView`, **not** `clampView`. `clampScale` floors the
scale at the fit scale, and across a resize that floor is a one-way ratchet:
growing the viewport raises the floor and drags the scale up, shrinking it back
lowers the floor and leaves the scale high, and the map ends up cropped
(`.plan/VISUAL-CHECK-PHASE2.md` defect 1, reproduced at 906 -> 1400 -> 906).
`resizeView` clamps to `MIN_SCALE .. MAX_SCALE` instead and re-clamps the
translation. The fit floor is still correct for **user zoom**, so `clampScale`,
`clampView` and `zoomAt` are unchanged and zooming out still terminates at
exactly the fit view.

Traps for later tasks:

- A view that is not fitted and whose scale is **below** the new fit scale keeps
  that scale, so the map letterboxes on all four sides. That is the policy, not
  a bug — a resize must never change a deliberate zoom. `0` re-fits it.
- `isFittedScale` compares against `fittedScale`, the fit scale capped at
  `MAX_SCALE`, never against the raw `fitScale`. A viewport more than 8x the map
  would otherwise read "not fitted" forever and never re-fit again.
- `MIN_SCALE` is defensive only. No user action reaches it: zooming out floors
  at the fit scale and `resizeView` never lowers a scale.
- The HUD's `fit yes|no` readout is the browser instrument for all of this.
  Resize the window and watch whether it stays `yes`.

- `sourceRect` takes the ART size, 3652 x 2855. Every other call takes the MAP
  size, 3653 x 2855. Mixing them asks `drawImage` for a column the bitmap does
  not have.
- Assigning `canvas.width` reallocates and clears the backing store even when
  the value is unchanged. Guard the assignment with `!==`.
- A `resolution` media query fires only when the ratio leaves its current value,
  so the listener has to be re-armed at the new ratio each time it fires.
- T04 appends border drawing to `drawOverlay` and keeps the bounds hairline.
- The HUD in `MapCanvas.tsx` is T03 verification UI. T08 replaces it.

## Borders and highlights

Borders are extracted in a worker and drawn as stroked paths on the overlay canvas.
The scan runs once. A country reassignment reuses that scan instead of rescanning.

### Extraction

`src/map/borders.ts` holds every algorithm and touches no DOM, so Node tests cover
all of it.

`mapPixelsToIds` turns the packed-colour bitmap into a `Uint16Array` of province ids.
It builds a transient 33.5 MB `Uint16Array(1 << 24)` lookup table, so each pixel costs
one indexed read instead of a hash lookup. The table is dropped straight after.

`scanBorders` makes one row-major pass. A crossing exists where a pixel's province id
differs from the id of its right or bottom neighbour. `NO_PROVINCE` is id 0 and takes
part in the comparison, which is what outlines the landmass against the sea. The scan
merges collinear crossings into runs on the way past. The real bitmap yields 215 177
crossings and 132 190 runs.

A run's geometry sits on the grid line between the two provinces, not on the up-left
pixel. A grid line straddles both provinces equally, and a stroke needs that.

`countryRuns` walks the retained crossing list and never reads the bitmap. A country
boundary is always a subset of the province crossings, so the recompute is a few
milliseconds against tens of milliseconds for a full scan. A test pins that subset
property on the real bitmap.

`buildBorderTiles` sorts the segments into 256 px tiles. The output is a flat
`Float32Array` of endpoints plus a `Uint32Array` offset table, so both buffers
transfer to the main thread with no object allocation. A segment crossing a tile edge
is split, not duplicated, which keeps the culling exact.

`visibleTiles` maps a view to a tile range and keeps a one-tile margin on every side.

### The worker

`src/map/borders.worker.ts` is a shell with no logic of its own. It keeps the id
bitmap and the crossing list for its whole life, and it answers two messages.

- `scan` converts the pixels, scans, tiles, and returns the province tiles.
- `countries` takes a `countryOf` array indexed by province id and returns country
  tiles.

The worker forces `countryOf[0] = 0` on receipt. Index 0 is `NO_PROVINCE`, not a
province. It wraps both handlers in `try`/`catch` and reports a failure as a normal
response.

`src/state/borders-store.ts` owns the worker. `ensureBordersScanned` is idempotent.
`setCountryAssignment` is latest-wins and coalesces a request that arrives while
another is in flight. `disposeBorders` terminates the worker. The signals are
`borderPhase`, `borderError`, `borderStats`, `countryBorderStats` and
`bordersVersion`. `applyDemoCountries` and `clearDemoCountries` exist only to drive
the T04 HUD, and T06 deletes them.

The store passes `index.pixels.slice()` to the worker. A transfer would detach the
buffer and every later `provinceAt` would read zeroes.

### Drawing

`src/ui/border-layer.ts` builds one `Path2D` per tile and strokes only the visible
ones. `drawBorders` installs the map-to-screen transform, then sets
`lineWidth = style.widthCss / view.scale`. The stroke width is therefore constant in
screen space over the whole 25x zoom range. A map-space width does not work: one map
pixel is 0.32 CSS px at the fit scale and 8 CSS px at the 8x cap.

Province borders are 1 CSS px. Country borders are 2.25 CSS px. `drawBorders`
restores the CSS-pixel transform before it returns, because the bounds hairline that
follows draws in CSS pixels.

`src/ui/highlight-layer.ts` fills the hovered and the selected province. It builds an
`ImageData` stamp over the province's bounding box and caches the last 32 stamps. The
largest bounding box is 12 642 pixels, so a stamp costs well under a millisecond. The
select fill is the hover fill at twice the alpha. A province that is both hovered and
selected is filled once.

`drawOverlay` draws the highlights, then the province borders, then the country
borders, then the bounds hairline. Every T04 field on `OverlayInput` is optional, so
`drawOverlay` with none of them draws exactly what T03 drew.

Traps for later tasks:

- Pass `snapView(view, dpr)` into the border draw, the same value `drawScene` uses.
  The raw view puts borders up to half a device pixel off the art.
- The border scan takes the map size 3653 x 2855. Only `sourceRect` takes the art
  width 3652.
- Province ids run 1 to 1650 for 1648 provinces. Ids 1318 and 1458 do not exist.
  Size `countryOf` by the highest id and leave the holes at 0.
- The left-click select in `MapCanvas.tsx` is a placeholder. T08 owns selection and
  extends `selection-store.ts`.
- The HUD buttons carry `data-hud-control`. The pointer handlers return early for a
  target inside one, so a button press cannot pan or select.

## Persistent state

One JSON document in one `localStorage` key. `src/state/` holds it in four layers:
the shape, the migration chain, the storage, and the signals.

### The document

`src/state/schema.ts` is pure. `CivitasState` is the in-memory shape and `StateDoc`
is the stored one. The two `Map`s become records keyed by the decimal id, because
JSON has no map.

```jsonc
{
  "version": 1,                    // the SCHEMA version, not the key's v1
  "provinceOverrides": {
    "1": { "name": "Verified", "lore": "...", "imageDataUrl": "data:image/webp;..." }
  },
  "countries": [
    {
      "id": 1,
      "name": "Testland",
      "slogan": "",
      "lore": "",
      "flagDataUrl": null,
      "provinceIds": [12, 13, 44],  // sorted ascending
      "colorHex": "#c0563f"
    }
  ],
  "economics": { "1": { "version": 1, "data": {} } },
  "nextCountryId": 2
}
```

Every field on a province override is optional and an empty one is absent. A
country carries all seven fields always. An economics slot keeps its own
`version`, separate from the document's, so a T11 economics migration can run on
its own schedule.

The caps, all enforced on write and again on load:

| Constant | Value | Applies to |
|---|---|---|
| `NAME_MAX` | 120 chars | Province and country name |
| `SLOGAN_MAX` | 160 chars | Country slogan |
| `LORE_MAX` | 8000 chars | Province and country lore |
| `IMAGE_DATA_URL_MAX` | 600 000 chars | Province image and country flag |
| `MAX_JSON_DEPTH` | 8 levels | The economics bag |
| `MAX_COUNTRY_ID` | 65535 | Country id, because `buildCountryOf` returns a `Uint16Array` |
| `STORAGE_BUDGET_BYTES` | 4 000 000 | The whole document, at 80% of a 5 MB quota |

- **Province overrides are sparse.** `serializeState` writes a key only for a
  province whose override has a non-empty field, and it drops an override that has
  none left. A session that edits two provinces writes two keys, not 1648. A test
  pins that.
- **Countries are an array, overrides and economics are `Map`s.** The country order
  is user-visible in T06's panel, and the array is that order.
- **`provinceIds` is sorted on serialisation.** Two states that reached the same
  assignment therefore stringify identically.
- **Economics is an opaque JSON bag** — `{ version, data }`. T11 defines the field
  set. Until then anything JSON-safe survives a round trip untouched.

`normalizeState` **repairs and never throws**, the opposite policy from
`parseManifest`. The manifest is a build artefact where a mismatch is a bug. This
document is user data a browser or an older build may have damaged, and losing one
malformed override must not lose the other forty. It reports what it repaired as a
short list of aggregated notes, never one note per bad record.

Its rules: keys must match `/^[1-9][0-9]*$/`; strings are truncated to their caps;
an image must be a `data:image/` URL under 600 000 chars, so a remote URL never
enters the document; a country id must be an integer in `1..65535`; a province
claimed twice stays with the first claimant; an economics slot without a country is
dropped; `nextCountryId` is forced above the highest surviving country id. Every
object is rebuilt field by field and every record is walked with `Object.keys`, so
a `__proto__` key in the payload cannot reach anything.

`normalizeState` must **not** read the manifest. State is read synchronously at
startup while the map load is still in flight, so `provinceById` returns `null`
then. An override for an id the manifest lacks is kept and never looked up.

### Storage

`src/state/persistence.ts` takes the storage as an argument everywhere. Only
`defaultStorage` reaches for a global, and it wraps the **property access** to
`globalThis.localStorage`, because Safari with cookies blocked throws there rather
than on `setItem`. In Node the same fallback runs, which is why the whole layer is
testable with a three-method fake.

The key is `civitas.state.v1`. **The `v1` is a namespace and never changes.** The
schema version is the `version` field inside the document, and that is what the
migration chain reads. Bumping the key would orphan every user's data, which is the
exact thing the chain exists to prevent.

`readState` never throws. Its five failure modes:

| Payload | Result |
|---|---|
| Missing | Empty state, no warning. A first run is not a problem. |
| Unparseable, or valid JSON that is not an object | Quarantined to `civitas.state.v1.corrupt`, empty state, `corrupt` warning. |
| `version` missing or not a positive integer | Same as corrupt. |
| `version` newer than this build | Empty state, `future` warning, **`writable: false`**. Nothing is quarantined, cleared or rewritten. |
| `version` older with no migration | Quarantined, empty state, `unmigratable` warning. |

A repaired payload still loads and still writes back: `repaired` warning,
`writable: true`.

`writeState` returns a result and **never throws, never retries and never evicts**.
Silently dropping the image the user just uploaded is worse than telling them the
save failed, and the in-memory state survives either way. `isQuotaExceeded` is
duck-typed over `QuotaExceededError`, `NS_ERROR_DOM_QUOTA_REACHED`, `code 22` and
`code 1014` — `DOMException` is absent in some runtimes.

`utf16Bytes` is `length * 2`. Browsers account `localStorage` in UTF-16 code units,
so `new Blob([text]).size` measures UTF-8 and understates a base64 payload by up to
half.

`createStateWriter` is a **fixed-window trailing debounce at 400 ms, not a
restarting one**. A `schedule()` inside an open window is absorbed and does not push
the deadline out. A restarting debounce starves: lore typed at one keystroke every
300 ms would postpone the write for as long as the user keeps typing. The timers are
injectable, and the test counts `set` calls — `armed()` alone cannot tell a fixed
window from a restarting one.

### The signals

`src/state/world-store.ts` exports every signal as a `ReadonlySignal` computed over
a private writable one. An action is therefore the only way to change state, so a
mutation cannot bypass `markDirty()`. Every action **replaces** its container: a
`Map` mutated in place is `Object.is`-equal to itself and no subscriber re-renders.

`initWorldStore(options)` is the injection seam and the re-init point. Production
calls it with no arguments; a test calls it with a fake storage and fake timers, and
that call is the reset. `installStateFlush()` adds `pagehide` **and**
`visibilitychange`, because iOS Safari can kill a backgrounded tab without ever
firing `pagehide`.

`markDirty()` returns early when `statePersistent` is false, which is what stops a
future-version document from being overwritten. A quota failure keeps the in-memory
state, sets a `quota` warning and leaves `persistent` true, so the next dirty mark
retries — a later delete may free the space. A non-quota write failure turns
persistence off, because retrying a broken storage every 400 ms is noise.

Actions: three explicit province setters (a patch object would need `undefined` to
mean "leave" and `null` to mean "clear", and a panel gets that tri-state wrong),
`addCountry` / `updateCountry` / `deleteCountry`, `assignProvinces`, and the two
economics writers. `assignProvinces` is the single entry point that keeps the
one-owner invariant: it strips the ids from every other country before adding them.
`provinceDisplayName(id)` layers the override name over the manifest name over
`"Province N"`.

`buildCountryAssignment(maxProvinceId)` returns the `Uint16Array` that
`setCountryAssignment` in `borders-store.ts` takes. **T05 does not call it.** T06
owns the effect that pushes the array to the border worker.

The public surface is 12 signals and 13 actions. The signals are
`provinceOverrides`, `countries`, `economics`, `nextCountryId`, `countryById`,
`countryOfProvince`, `stateWarning`, `statePersistent` and `stateBytes`, plus the
three lookups `provinceOverrideOf(id)`, `economicsOf(countryId)` and
`provinceDisplayName(id)`.

### Warnings

`stateWarning` is `{ kind, message, at }` or `null`. `dismissStateWarning()`
clears it. Seven kinds exist and each one names a distinct recovery:

| Kind | Cause | `statePersistent` after |
|---|---|---|
| `corrupt` | The payload did not parse, or its `version` was not a positive integer. | true |
| `unmigratable` | The `version` is older and no migration covers it. | true |
| `future` | The `version` is newer than this build. | **false** |
| `repaired` | The payload loaded, and `normalizeState` fixed something. | true |
| `quota` | A write hit the storage quota, or the country ceiling was reached. | true |
| `unavailable` | `localStorage` is absent or throws, or a write failed for a non-quota reason. | false |
| `budget` | The document passed `STORAGE_BUDGET_BYTES`. Nothing is deleted. | true |

`quota` keeps persistence on, so the next edit retries — a later delete may free
the space. `unavailable` turns it off, because retrying a broken storage every
400 ms is noise. `future` turns it off to protect a newer document.

### Images

`src/state/image.ts` bounds each image at ~256 KB. `downscaleImage(file, maxEdge,
quality)` resizes through a canvas and **always re-encodes, even when it does not
resize** — a 200 x 200 PNG can still be 700 KB, so the re-encode is what bounds the
bytes. It tries WebP first and falls back to JPEG by checking the returned data
URL's prefix, because `toDataURL` silently returns PNG for a type the browser cannot
encode. WebP keeps alpha; a flag with a transparent background turns black under
JPEG. The quality ladder is bounded at five encodes with one half-size redraw, never
a `while` on size.

`fitDownscale` never upscales and clamps each axis with `Math.max(1, ...)`. A
1 x 4000 strip rounds its short edge to 0 and `drawImage` then throws.

`downscaleImage` is the only way an image enters the store. `setProvinceImage` and
`updateCountry` validate a prefix and a length; they do not resize. Verified in
Chrome: `assets/country-flag.jpg` (735 x 490, 98 KB) becomes a 256 x 171 WebP of
13 KB, and the whole document is then 34 KB.

Traps for later tasks:

- **Reactivity is opt-in.** A component reading these signals calls `useSignals()`.
- **No action may run inside a `useSignalEffect`.** Each writes signals a computed
  derived from them reads.
- The warning banner in `App.tsx` is the minimum that makes `stateWarning` visible.
  T08 restyles it inside the real shell.
- Two tabs clobber each other. There is no `storage` listener and no merge, by
  decision, not by oversight.
- `readState` takes an optional `targetVersion`. It exists so the migration branch
  is exercised while the shipped schema is still at version 1 and no stored document
  can legally be older than it. Production never passes it.
- The store is a module singleton. A test resets it with
  `initWorldStore({ storage, timers })` and there is no other reset.
- `src/state/world-store-lifecycle.test.ts` observes a store that has never been
  initialised, so it needs its own process. `tsx --test` gives each file one, which
  is why that file exists separately and why its first test must stay first.

## Countries and province assignment

A country is created in the app, painted onto the map province by province, and
tinted in its own colour. The model adds no storage key and no schema field. T05
already shipped `Country` with `colorHex` and `provinceIds`, and T06 fills them.

### Files

| Path | What it is |
|---|---|
| `src/map/country-aggregate.ts` | Pure. Province count, pixel count, union bounds and the area-weighted centroid. |
| `src/map/paint-path.ts` | Pure. The integer line walk between two pointer samples. |
| `src/ui/tint-layer.ts` | The offscreen tint canvas, its word format, and the per-box repaint. |
| `src/state/country-store.ts` | The derived signals and the debounced push into the border worker. |
| `src/state/assign-store.ts` | Assignment mode, the active country, and the stroke state machine. |
| `src/ui/CountryPanel.tsx` | Country CRUD, the mode toggle, and the colour picker. |
| `src/ui/country-panel.module.css` | The panel styles. |

`assignProvinces` in `src/state/world-store.ts` stays the only writer of an
assignment. `assign-store.ts` decides what to write and calls it. The one-owner
invariant therefore lives in one place, exactly where T05 put it.

### The tint layer

The tint is one map-sized offscreen canvas of 3653 x 2855, and `drawOverlay`
draws it with a single `drawImage`. A stamp per province, the way
`highlight-layer.ts` works, would cost 1648 `drawImage` calls per frame at fit
zoom. The per-frame cost is the one that matters, because a pan pays it 60 times
a second.

An update repaints one province bounding box at a time through `putImageData`.
The median box is 2 961 px and the sum of all 1648 boxes is 5 126 902 px, which
is half a map scan. A whole-canvas rebuild is 10.4 M pixels with a lookup on
each. A per-box repaint is therefore always cheaper. Do not add a "rebuild
everything above N provinces" threshold.

`buildTintPixels` resolves the province that **owns** each pixel, not the
province being repainted. Bounding boxes overlap and `putImageData` replaces the
destination rectangle including its alpha, so a tile built the way
`buildStampPixels` builds one would erase a neighbour's tint. The consequence is
a useful property: a box repaint leaves the rectangle globally correct, so
repainting the same box twice in one batch changes nothing.

A tint word is `0xAARRGGBB`, forced unsigned with `>>> 0`. **`0` means "no
tint"** and cannot be confused with a colour, because a tinted province always
has alpha at least 1. `tintWordFor` returns `0` for a malformed hex, a
non-finite alpha and an alpha at or below 0.

`TINT_ALPHA` is 0.32. It sits between the T04 hover fill at 0.22 and the select
fill at 0.44, so a hovered province still reads as hovered on top of its country
colour.

The module writes each pixel as four separate bytes. It never takes a
`Uint32Array` view over the `ImageData` buffer, because such a view has a
machine-dependent byte order. This is the same rule `province-index.ts` states
at its top.

`syncTintLayer` has an all-zero fast path. Deleting the last country is one
`clearRect`, not 5.1 M pixel writes. `getTintCanvas()` returns `null` while
nothing is tinted, so a project with no countries pays exactly the T04 overlay
cost.

`drawOverlay` draws the tint first, then the highlights, then the province
borders, then the country borders, then the bounds hairline. The tint takes the
**map** size 3653 x 2855. Only `drawScene`'s `sourceRect` takes the art width
3652, and the tint has no `drawEdgeColumn` analogue.

### The derived store

`src/state/country-store.ts` holds three computeds and one effect.

- `maxProvinceId` is the highest id in the manifest, or 0 before the load
  finishes.
- `countryTintWords` is one 32-bit word per province id. Index 0 stays 0,
  because `NO_PROVINCE` is never tinted. The hex is parsed once per country, not
  once per province.
- `countryAggregates` maps a country id to its `CountryAggregate`. **The
  `computed` is the cache.** It recomputes only when the countries array
  identity changes, and a full recompute is 1648 `Map` lookups. T07 places its
  labels on `aggregate.centroid`.

`initCountrySync()` registers the effect that pushes the assignment into the T04
border worker. `App.tsx` calls it once and disposes it on unmount.

The push is debounced 120 ms, on top of the latest-wins coalescing already in
`borders-store.ts`. The coalescing bounds the worker at one request in flight,
but every response still costs `buildBorderPaths` on the main thread — T04
measured 5.7 ms for 180 tiles. At 30 pointermove events a second that is 17% of
the frame budget plus 180 discarded `Path2D` per response. `BORDER_PUSH_MS` is
120 and T05's `DEBOUNCE_MS` is 400; the border has to stay visibly live during a
drag, and a `localStorage` write does not.

`flushCountryBorders()` fires the pending push at once. `endStroke` calls it, so
releasing the mouse updates the country outline within one worker round trip.
The debouncer is T05's `createStateWriter` from `persistence.ts`. That function
is a generic fixed-window trailing debounce with injectable timers, and reusing
it beats a second copy.

### Aggregates

`aggregateCountry(countryId, provinceIds, lookup)` takes a province **lookup**,
not a `Country`. The module then imports nothing from `src/state/`, and the
maths is testable in Node where the manifest never loads.

The centroid is **area-weighted**: each province's centre of mass counts for its
`pixelCount`. A plain mean puts a label between a country's islands instead of
over its mainland. Two provinces of 1000 px and 9000 px at x 0 and x 100 give a
centroid at x 90, not x 50. The result is not rounded, because T07 wants the
sub-pixel value.

`unionBounds` computes `max(ax + aw, bx + bw) - x`, never `max(aw, bw)`. It
returns a copy when the accumulator is null, so widening a country's box cannot
rewrite the manifest's own `bounds` object through an alias.

`provinceCount` counts the ids the user assigned. `resolvedCount` counts the ids
the manifest carries. The two differ when a stored document names a phantom id.
An empty or fully phantom country has a null `bounds` and a null `centroid`. A
manifest whose `pixelCount` is 0 everywhere falls back to an unweighted mean
rather than returning `NaN`.

### Assignment mode and the stroke

`src/state/assign-store.ts` exposes `assignMode`, `activeCountryId` and
`painting`, plus `beginStroke`, `extendStroke`, `endStroke` and `cancelStroke`.

`activeCountryId` is a `computed` over `countryById`. Deleting the active
country disarms assignment with no extra wiring, and no stale id can reach
`assignProvinces`. The mode itself stays on and is simply inert.

**The stroke action is decided once, at `beginStroke`, and held for the whole
drag.** Deciding it per province makes a drag that re-enters a province toggle
it back, and a drag across a rival country leaves a trail of half-assigned
provinces. `strokeActionFor` is the whole rule: Alt always erases, clicking a
province the active country already owns removes it, and anything else assigns
it away from its previous owner.

`extendStroke` takes a **batch** of ids, one call per pointermove. Each
`assignProvinces` replaces the countries array and invalidates
`countryOfProvince`, `countryTintWords` and `countryAggregates`, so batching
removes a straight N-times multiplier. The stroke keeps a `visited` set, so an
id repeated along one line costs a `Set.has`.

`applyStroke` checks `countryById.peek().has(stroke.countryId)` before it
writes. T05 pinned that `assignProvinces` with an id naming no country still
strips the provinces from their owners, so without the check a country deleted
mid-drag would turn the rest of the stroke into a silent mass unassign.

`samplePathPixels` walks the integer line between two pointer samples. A
pointermove at 60 Hz during a flick jumps over 300 map pixels at the 0.317 fit
scale, and sampling only the event's own pixel leaves holes through the painted
region. `MAX_PATH_SAMPLES` is 4096, which a full-viewport flick of about 3 000
map pixels never reaches.

### Input in assignment mode

`MapCanvas.tsx` gains a `paint` gesture beside the existing `pan` one.

- **The middle button always pans.** That is what keeps the map navigable while
  the left button paints.
- A left drag paints. Alt held at press erases.
- A left press falls through to a pan whenever no stroke started — no active
  country, or a press outside the map bounds. The map is never unusable.
- Double-click zoom is suppressed while the mode is on. The left button is the
  paint tool there, so a double click is two strokes.
- The wheel still zooms.
- Escape leaves the mode. `CountryPanel` owns that listener.
- The host carries `data-mode` and `data-painting`, which drive the crosshair
  and cell cursors.

A pointer that leaves the map pauses the stroke instead of painting a line to a
clamped edge pixel. A cancelled pointer keeps whatever the stroke already
applied — those writes are in the store — and forces no extra worker round trip.

### The panel

`CountryPanel` is mounted as a sibling of `MapCanvas`, so its pointer events
never reach the map host and it needs no `data-hud-control` guard. It is
deliberately plain: T08 restyles it inside the real shell and T09 replaces it
with the country overview panel.

`input type="color"` fires React's `onChange` on every native `input` event, and
dragging the OS picker emits dozens a second. Each one would replace the
countries array and repaint every province of that country, which is about 20 ms
at 300 provinces. The panel debounces a colour edit 80 ms in a fixed window and
shows the pending value locally, so the input stays responsive. The unmount
handler commits the last pending value. Name edits need no debounce.

Delete arms on the first click and only deletes on a second click within 3
seconds. A misclick that destroys a 300-province country has no undo.

The T04 demo-country buttons are gone. `applyDemoCountries`, `clearDemoCountries`
and the `.hudActions` styles were deleted with them. The HUD now reports `mode`
and `active`, and its `country` readout is the instrument for the "no freeze
while painting" check.

### Traps for later tasks

- **`getMapAssets()` is a plain module variable and notifies nobody.** Every
  computed and every effect that touches the manifest must also read
  `loadPhase.value`. Without that read, a country hydrated from `localStorage`
  never tints until something else invalidates.
- The tint canvas takes the map width 3653. Only `sourceRect` takes the art
  width 3652.
- Pass `snapView(view, dpr)` into `drawOverlay`, the same value `drawScene`
  uses. The raw view puts the tint half a device pixel off the art.
- `syncTintLayer`, `getTintCanvas` and `disposeTintLayer` are untested. They
  need `document.createElement`, `getContext("2d")` and `putImageData`, and the
  repo has no jsdom. The pure pieces they are built from are covered.
- `CountryPanel.tsx` and the `MapCanvas.tsx` pointer handling are untested for
  the same reason.
- Touch is not handled. A one-finger drag paints, and pan is unreachable on
  touch while the mode is on. This is a desktop prototype.
- Province ids run 1 to 1650 over 1648 provinces. An aggregate skips an
  unresolvable id and never throws.

## Country labels

A country's name is drawn across its territory in the style of a political map:
uppercase, letter-spaced, dark type inside a light casing. The label sits on a map
point that is proved to be inside the country. It never sits in the sea.

Labels add no storage key and no schema field. Every value below is derived.

### Files

| Path | What it is |
|---|---|
| `src/map/label-layout.ts` | Pure. The font ramp, the anchor chain, the pole search, the fit test, the greedy layout. |
| `src/ui/label-layer.ts` | The only file that calls `measureText`. Metrics, the layout call, the two-pass draw. |
| `src/state/label-store.ts` | `showLabels`, the `countryLabelSources` computed, the anchor cache, the contains predicate. |

The split follows purity. `label-layout.ts` takes text widths as **numbers**, so
the whole of the maths runs under Node with no canvas. `label-layer.ts` supplies
those numbers. `label-store.ts` supplies the country data.

`CountryLabelSource` is declared in `src/map/label-layout.ts`, not in the store.
`src/ui/render.ts` names the type and imports only from `./` and `../map/`.
Declaring it in the store would pull a `ui -> state` import into the renderer.

### The anchor

`resolveLabelAnchor` walks three steps and returns the first point that the
`contains` callback accepts:

1. The country's area-weighted centroid, from `countryAggregates`.
2. Each province's centre of mass, largest province first, capped at
   `ANCHOR_CANDIDATE_LIMIT` = 8 tries.
3. A pole of inaccessibility searched inside the **largest province's** bounding
   box.

If all three fail the function returns `null` and the country gets no label.
There is no bounding-box-centre fallback. A guessed point is exactly the failure
mode the chain exists to prevent.

Step 2 is what saves a ring-shaped country. Its centroid falls in the hole, and a
province centre of mass lies inside its own province for 1634 of the 1648
provinces. A province of the country is by construction inside the country.

Step 3 searches the largest province's box, never the country's union box. A
union box reaches 3119 x 2427 map px, and a 24 x 24 grid over it samples every
130 px and misses a thin arm. A province box covers at most 12 642 px of area,
which the same grid resolves.

The search is a coarse grid plus a chamfer distance transform plus 2 refinement
levels, so `GRID_LEVELS` x `GRID_CELLS`² = 3 x 24² = 1728 `contains` calls.
`chamferDistance` weights a diagonal step at √2, not 1. Manhattan iso-contours are
diamonds and push the label toward a diagonal tip.

`src/state/label-store.ts` caches the resolved anchor per country and validates
the entry against **`country.provinceIds` array identity**. `assignProvinces`
returns the same `Country` object for every country it did not touch, so identity
is an exact "the territory is unchanged" test with no hashing. A rename therefore
costs no recompute, and a paint drag recomputes only the countries it changed.

`countryLabelSources` gates on `loadPhase.value === "ready"`. That read does two
jobs. It subscribes the computed to the map load, because `getMapAssets()` is a
plain module variable that notifies nobody. It also stops an anchor from being
computed while `provinceAt` returns `null` for every pixel, which would fill the
cache with `null` and leave every country unlabelled for the rest of the session.

`countryContainsPoint` reads `countryOfProvince.peek()`, not `.value`. It runs
inside the computed and inside a `requestAnimationFrame` callback. `.peek()` is
correct in both and cannot widen a dependency set.

### Type size

`labelFontSize(scale)` is `basePx * (scale / referenceScale) ** exponent`, clamped
to `minPx..maxPx`.

| Field | Value | Why |
|---|---|---|
| `referenceScale` | 0.32 | The fit scale of the 3653 x 2855 map in a typical viewport. |
| `basePx` | 13 | The size at the opening view. |
| `exponent` | 0.45 | Sub-linear. The zoom range is 25x, and a linear ramp gives 328 px type at the cap. |
| `minPx` | 9 | Below this the tracked caps stop reading. |
| `maxPx` | 34 | Above this the label billboards over its country. |

The ramp produces 9.00 px at scale 0.1, 13.00 at 0.32, 21.71 at 1, and 34.00 at
both 3 and 8.

### Text measurement

Text is drawn **glyph by glyph with a manual advance**, and measured the same way.
`ctx.letterSpacing` is engine-dependent, and `measureText(wholeString).width`
includes kerning the draw never applies. The measured width must equal the drawn
width, or the fit test and every collision rect are wrong.

`LETTER_SPACING_EM` is 0.18. Tracking adds `n - 1` gaps, never `n`. There is no
trailing space after the last glyph, and `labelTextWidth` floors the gap count at
0 so an empty name cannot return a negative width.

Advances are measured once per name at `METRIC_FONT_PX` = 100 and scaled linearly
to the live size, so a wheel notch costs zero `measureText` calls. The cache holds
`METRIC_CACHE_LIMIT` = 256 names and evicts the oldest. `measureLabelMetrics` runs
inside `drawCountryLabels`, after the draw font is set, so it saves and restores
`ctx.font`. Without that a cache miss renders its label at 100 px.

The string is walked with `Array.from(text)`, never `text.split("")`. A split
surrogate pair measures and draws as two replacement glyphs.

### The fit test and the greedy layout

`layoutLabels` sorts a **copy** of the candidates by area descending, with
`countryId` breaking a tie, then walks the list once.

A candidate is dropped when its on-screen bounding box cannot hold its text:
`bounds.width * view.scale < textWidth * FIT_WIDTH_RATIO` (1.05) or
`bounds.height * view.scale < fontSize * FIT_HEIGHT_RATIO` (1.6). That is the
"hidden when the country is too small at this zoom" rule, and the width it
compares against is measured, never estimated from a character count.

A surviving candidate tries the 7 entries of `NUDGE_OFFSETS` in order: the anchor,
then up, down, left, right in units of font size and text width. The first offset
whose rect collides with no already-placed rect wins. Offset 0 is trusted, because
`resolveLabelAnchor` already proved the anchor is in-country; every other offset is
back-projected through `screenToMap` and re-tested with `contains`, or a nudge
would push the label into the water. A candidate whose every offset collides or
leaves the country is dropped. The larger country already owns that space.

#### The end probe (T08-FIX)

The 7-offset trial lives in `chooseOffset`, which `layoutLabels` can run twice.
With `requireEndsInside` on, a trial also back-projects the two ends of the
**text span** — `(cx ± textWidth / 2, cy)`, not the padded box corners, because
the padding is casing and is allowed to overhang — and requires `contains` on
both. It runs at offset 0 too, unlike the in-country test, because offset 0 is
exactly the case that overhangs.

`layoutLabels` runs the probe pass first and, **if it finds nothing, runs the
plain pass**. That fallback is what makes the probe safe: it can only change
*which* offset wins, never *whether* a label is placed. No label is ever lost to
it and `placed` in the HUD cannot go down.

Pan invariance survives. `mapToScreen` then `screenToMap` of an offset from the
anchor is `anchor + offset / scale`, independent of `view.x` and `view.y`, so
the probe is a function of the scale alone.

The probe is **opt-in**: `LayoutOptions.probeEnds`, default false, forwarded by
`layoutCountryLabels` and turned on by `drawOverlay`. It is off by default
because it spends `contains` calls at offset 0, and two T07 tests pin that
offset 0 reads no bitmap at all. Weakening a pinned test to fit a cosmetic
improvement was not on the table, so the flag carries the difference and both
settings are tested.

`rectsOverlap` uses strict `<`, so two flush rects do not collide.

**The collision pass runs over every candidate that passed the fit test, including
the off-screen ones.** Culling off-screen candidates first is a bug, not an
optimisation: a label that scrolls out would free its slot, a neighbour would pop
in, and scrolling back would pop it out again. Every pan would make labels jump.
`LabelPlacement.visible` decides only what is drawn. A test pins that two view
translations give the same placed set and the same `offsetIndex` per label.

There is no layout cache. The layout is a pure function of the sources, the view
and the viewport, and all three change on every pan. Once the metrics are warm the
pass is one sort and at most 7 rect trials per candidate.

### Drawing

`drawCountryLabels` strokes the casing on **all** glyphs first, then fills them
all. A per-glyph stroke-then-fill lets glyph N's halo eat glyph N-1's fill under
tight tracking. The casing is `strokeText`, not `shadowBlur`: a blur is the slow
path and gives a soft glow instead of a political-map casing.

`LABEL_FILL` is `rgba(24, 20, 14, 0.92)` and `LABEL_HALO` is
`rgba(248, 246, 240, 0.80)`. Dark type inside a light casing, matching T04's dark
border ink. The art is dark-ish and the casing is what carries the contrast.

`LABEL_FONT_STACK` duplicates `--font` from `src/index.css`. Canvas cannot read a
CSS custom property without a `getComputedStyle` call per frame. Change both lines
together.

Labels draw **last** in `drawOverlay`, after the tint, the highlights, the province
borders, the country borders and the bounds hairline. They take
`snapView(input.view, ratio)`, the same value every other overlay step uses.

`drawCountryLabels` leaves `font`, `fillStyle`, `lineJoin` and `miterLimit` set. It
is currently the last step, and `prepare` resets the transform every frame. Any
step appended after it must set its own type and stroke state.

### The toggle

`L` toggles `showLabels`. `MapCanvas.tsx` owns the listener and ignores the key
inside an `INPUT`, a `TEXTAREA`, a `SELECT`, a `contentEditable` element, and any
modifier chord. The toggle is deliberately not persisted. It is the instrument for
the "the label is not in the sea" check: press `L` and see what is underneath.

### Traps for later tasks

- Never pass `input.view` into the label layout. Only `snapView(view, dpr)`.
- Every field `T07` added to `OverlayInput` is optional. `render.test.ts` asserts
  that an overlay drawn without them is byte-identical to the T06 output.
- The fit test still uses the country's union **bounding box**, so a long thin
  country passes the width test even where no part of it is that wide. The
  overhang that follows is handled at the **placement** stage instead, by the
  end probe below — not by widening `FIT_WIDTH_RATIO`, which would hide labels
  that are fine today.
- `getLastLabelStats()` is one frame stale by construction. The HUD `placed`
  readout always reports the previous frame.
- `src/state/label-store.ts` has only 4 tests and cannot have more. In Node the
  manifest never loads, `loadPhase` never reaches `"ready"`, and
  `countryLabelSources` can only return `[]`. The maths under the store is covered
  in full by `label-layout.test.ts`. Do not fake a `ProvinceIndex` to reach
  further; that tests the fake.
- The HUD `labels` and `placed` readouts are T07 verification UI. T08 replaces
  the whole HUD.

## Selection and the UI shell

A left click selects a province. A right click selects that province's country.
The selection drives a top plaque and three docked panels. T08 also ships the
theme tokens, the panel chrome and the editable-field components that T09 to T12
build on.

T08 adds no `localStorage` key, no schema field and no migration. The selection,
the open panel and assign mode are session state and are never written.

### Files

| Path | What it is |
|---|---|
| `src/state/selection-store.ts` | One selection signal, the pure transition table, six read-only computeds, five actions. Rewritten from T03's placeholder. |
| `src/state/panel-store.ts` | `openPanelId`, `PANEL_DOM_ID`, and the three panel actions. |
| `src/ui/theme.css` | The `--civ-*` token block, plus the re-point of T01's legacy aliases. |
| `src/ui/Shell.tsx` | The layout frame. Owns the one window Escape listener and the bar-button ref map. |
| `src/ui/CountryPlaque.tsx` | Flag, name, slogan and sub-line, with three empty states. |
| `src/ui/Panel.tsx` | The panel chrome: heading, close button, scrollable body, read-only chip. |
| `src/ui/PanelHost.tsx` | Renders the panel named by `openPanelId`. |
| `src/ui/CountryOverviewPanel.tsx` | Placeholder body. T09 owns it. |
| `src/ui/ProvincesOverviewPanel.tsx` | Placeholder body. T10 owns it. |
| `src/ui/EconomicsPanel.tsx` | Placeholder body. T12 owns it. |
| `src/ui/use-field-commit.ts` | The buffered-commit hook the two text fields share. |
| `src/ui/EditableText.tsx` | Single-line field. |
| `src/ui/EditableTextArea.tsx` | Multiline field. |
| `src/ui/ImageUpload.tsx` | File picker, `downscaleImage`, preview, remove, inline error. |

Four modules changed. `src/state/country-store.ts` reads the selected country so
it can raise that country's tint. `src/ui/tint-layer.ts` gained
`SELECTED_TINT_ALPHA`. `src/ui/MapCanvas.tsx` gained the click semantics.
`src/state/world-store.ts` stopped copying `provinceIds`, which is explained
below.

`src/ui/render.ts`, `OverlayInput`, every file under `src/map/`, `borders-store.ts`,
`label-store.ts` and `assign-store.ts` are untouched. `render.test.ts`'s
byte-identical assertions therefore still hold as T07 wrote them.

### The selection model

The selection is three slots inside **one** signal: a province id, a country id,
and a scope of `"none"`, `"province"` or `"country"`. One signal means one write
per click, so no `batch` is needed and no subscriber ever sees a half-applied
selection.

`nextSelection(current, intent, ownerOf)` is pure and holds the whole rule. It is
the same split `strokeActionFor` uses in `assign-store.ts`, so the transition
table is unit tested in Node with no signal involved. There are four intents:
`province` (a left click), `countryOfProvince` (a right click), `country` (a list
row) and `clear`.

Two rows of that table are easy to get wrong:

- **A right click on an unassigned province does not clear the selection.** There
  is no country to select, so the intent degrades to a province selection. Two
  thirds of the map belongs to nobody, and clearing there makes the right click
  feel broken.
- **A `country` intent keeps the current province only when that province is
  inside that country.** Otherwise the province slot would name a province of one
  country while the plaque named another.

`apply` compares the next state with the current one through `sameSelection` and
skips an equal write. A fresh object always notifies, so without that guard a
click on the already-selected province repaints the map and re-runs the tint diff.

**`selectedCountryId` is a computed and is never stored.** At scope `"country"` it
is the stored id validated against `countryById`, the same trick `activeCountryId`
uses in `assign-store.ts`. At any other scope it reads `countryOfProvince` live.
That kills two bugs at once: a deleted country cannot linger in the selection, and
a province repainted into another country updates the plaque while the drag is
still running.

`selectionScope` downgrades rather than reporting a state the data no longer
supports. A country scope whose country is gone reports `"province"` when a
province is still selected, and `"none"` otherwise.

The public surface is six signals — `hoveredProvinceId`, `selectedProvinceId`,
`selectedCountryId`, `selectedCountry`, `selectedProvince`, `selectionScope` — and
five actions: `setHoveredProvince`, `selectProvince`, `selectCountryOfProvince`,
`selectCountry` and `clearSelection`.

`selectedProvince` is `null` until the map load finishes. Every readout built on
it carries a `—` fallback.

### Click semantics

`src/ui/MapCanvas.tsx` decides what a press means.

**A context press is button 2 everywhere, plus a ctrl+left press.** macOS reports
its right click as button 0 with `ctrlKey` set, so a check against `button === 2`
alone starts a pan or a paint stroke and the country selection never happens.
`isContextPress` covers both forms on every platform. Sniffing the platform is
more code and gets one of them wrong.

- `onPointerDown` returns for a context press and starts no gesture. The return
  is **before** its `preventDefault()`. Preventing a `pointerdown` default
  suppresses the compatibility mouse events, and an engine that derives
  `contextmenu` from `mousedown` would then never fire it.
- Declining the press in `onPointerDown` is also what stops a ctrl+click from
  painting. `beginStroke` assigns the pressed province immediately, so a stroke
  started there cannot be taken back by a later `cancelStroke`.
- `onContextMenu` calls `preventDefault()` unconditionally and first, so no menu
  pops for a right-drag either. It then selects the country, unless the gesture is
  already a pan or a paint stroke.
- `onPointerUp` runs the same selection for a ctrl+click on an idle gesture.
  Windows and Linux fire no `contextmenu` for a ctrl+click, and without that
  branch the press would be dead there. On macOS both handlers run, and
  `sameSelection` swallows the second call because it carries the identical intent
  on the identical pixel.

**The paint tool owns the left button only when it can actually paint.** With
assign mode on and a country active, the paint branch returns before the selection
branch, so painting never moves the selection. With no active country
`onPointerDown` already falls through to a pan, and the click at the end of that
fall-through selects. The map is never a dead surface.

`provinceAtClient(host, clientX, clientY)` is the one screen-to-province helper
all three call sites use. `provinceAt` returns `null` for the sea and for bare
canvas alike, so "a click on empty sea clears the selection" needs no separate
branch anywhere.

### The selected country on the map

The selected country is emphasised by **raising its tint alpha**, from
`TINT_ALPHA` 0.32 to `SELECTED_TINT_ALPHA` 0.48. There is no new draw call and no
new overlay layer.

`buildTintWordTable` gained two optional parameters, `emphasisCountryId` and
`emphasisAlpha`. Both default to no emphasis, so a two-argument call is
byte-identical to the pre-T08 output, and a test pins that.

Emphasis changes the alpha byte alone. The red, green and blue bytes stay
bit-identical, so a country never appears to change identity when it is selected.
The cost is small because `diffTintWords` repaints only the ids whose word
changed: one click repaints the old country's boxes and the new country's boxes
once, not once per frame.

0.48 is a visible step up from 0.32 and still does not swallow the T04 select
fill, which is accent gold at alpha 0.44 drawn on top of it. A selected province
therefore still reads as selected inside its own selected country.

### The shell

`src/ui/Shell.tsx` is a full-bleed map with the chrome positioned absolutely over
it. The stacking order comes from the `--civ-z-*` tokens: map 0, button bar 2,
panel dock 3, plaque 4, assign banner 5, warning 6.

**Every shell control is a sibling of the map host and never a descendant.** That
is the rule T06 set for `CountryPanel`. A pointer event on shell chrome therefore
never reaches the map's handlers, and none of this needs `data-hud-control`. That
attribute stays reserved for a control placed inside the host, and T08 adds none.

The plaque rail spans the window, so it is `pointer-events: none` and only the
plaque box inside it is `auto`. Without that it would eat every map click along
the top of the window.

**`Shell` owns the one window Escape listener in the app.** It closes the open
panel first and leaves assign mode second. `CountryPanel`'s own Escape listener
was deleted: two listeners on one key means a press does two things and neither is
predictable. Escape is not suppressed inside a text field, because a field commits
on a debounce, on blur and on unmount, so there is no draft to protect.

Focus is never trapped while a panel is open. It is only **restored** to the bar
button when the element holding it is about to be unmounted, which `Shell` detects
with `closest("#" + PANEL_DOM_ID)`.

Assign mode shows two marks: a banner beside the plaque naming the active country,
and an inset ring around the whole viewport. The ring exists so the mode is
visible when the pointer is nowhere near the banner.

### Keyboard and the reset control

| Key | What it does | Owner |
|---|---|---|
| `L` | Toggles the country labels | `MapCanvas.tsx` |
| `0` | Resets the view to the fit scale | `MapCanvas.tsx` |
| `Esc` | Closes the open panel, else leaves assign mode | `Shell.tsx` |

There are exactly **two** window keydown listeners: `MapCanvas` owns the map
keys and `Shell` owns Escape. Add a map key to the existing effect; do not add a
third listener.

Every map shortcut is ignored inside an `INPUT`, `TEXTAREA`, `SELECT` or
`contentEditable` element, and under any `alt` / `ctrl` / `meta` chord. One
shared `isTypingTarget` helper in `MapCanvas.tsx` answers "is the user typing"
for all of them, so a new key cannot get that guard subtly wrong. Neither key
calls `preventDefault`; outside a text field neither has a default action.

The bar's **`Reset view`** button runs the same `resetView()` action as `0`. It
is an action, not a toggle, so it carries no `aria-pressed` and no `data-on`,
and it is never disabled — `resetView` already writes nothing when the view is
already fitted, and a control that greys itself out on a zoom is more confusing
than a click that does nothing.

### The plaque

`CountryPlaque` is **not interactive**. Wrapping a button around a block that
holds an image invites a nested-interactive accessibility problem for no gain, and
the button bar sits one row below it.

It has three states. With a country selected it shows the flag, the name, the
slogan in quotes and a sub-line of `<province> · <n> provinces`. With a province
selected and no owner it shows the province name and the hint that a right click
selects a country. With nothing selected it shows `no selection`.

A missing flag falls back to a flat swatch of the country's colour. A stored data
URL that fails to decode falls back the same way. The broken-flag state holds
**the failed URL, not a boolean**, so the fallback clears itself when the
selection moves to a country whose flag is fine.

### Theme tokens

`src/ui/theme.css` is global CSS, not a module. Custom properties have to reach
every subtree, and a module would need an import in every file for no gain.
`src/main.tsx` imports it after `./index.css`, so its `:root` block wins on equal
specificity.

The register is a political map: parchment surfaces, ink text, a dark sea. The
tokens cover surfaces, ink, lines, space, radii, type, elevation and z-index. **No
CSS written from T08 on hardcodes a colour, a gap, a radius or a font size.**

The file also re-points T01's legacy aliases — `--bg`, `--text`, `--accent` and
the rest — onto the `--civ-*` tokens. One file therefore moves the whole palette,
instead of four CSS files each being rewritten. New CSS uses `--civ-*` only.

Three constraints the tokens have to respect:

- **`--bg-sunken` cannot map to the sea colour.** `index.css` styles
  `input[type="text"]` with it together with `color: var(--text)`, so the sea
  there would put ink text on a near-black field. It maps to parchment-dim, and
  `.host` in `map-canvas.module.css` sets its own explicit
  `background: var(--civ-sea)`.
- `color-scheme` is `dark` at the root and `light` on the parchment panels. Without
  that the panel scrollbar and the colour and file inputs render dark on light.
- **`--font` stays on the sans stack.** `LABEL_FONT_STACK` in `label-layer.ts`
  duplicates it and canvas cannot read a custom property, so pointing `--font` at
  `--civ-font-display` would silently diverge the canvas labels from the DOM.
  `--civ-font-display` is DOM chrome only.

### Panels

One panel is open at a time, because the three share the right dock.
`panel-store.ts` holds `openPanelId` as a computed over a private signal, and
exposes `openPanel`, `closePanel` and `togglePanel`. `togglePanel` closes the same
id and switches to a different one. `PanelId` is `"country" | "provinces" |
"economics"`.

`PANEL_DOM_ID` is `"civ-panel"`. One id is enough because one panel is mounted at
a time, and the bar buttons point `aria-controls` at it. **`aria-controls` is set
only on the button whose panel is open.** An `aria-controls` naming an id that is
not in the document is worse than none: a screen reader offers a jump to an
element that is not there.

`Panel` is `role="region"` and **not** `role="dialog"`. A dialog role implies a
focus trap, and the brief forbids one. Tab walks out of an open panel normally.
`Panel` registers no key listener; `Shell` owns Escape.

`Panel` shows a `read-only` chip when `statePersistent` is false. A future-version
document puts the store in read-only mode and `markDirty` then drops every write.
A field that looks saved and is not is the worst outcome, so the panel says so.

The three bodies are placeholders. `CountryOverviewPanel` carries four real fields
because the round trip through the T05 store cannot be demonstrated otherwise.
`ProvincesOverviewPanel` caps its list at 50 rows on purpose: a 300-row
unvirtualised list is the exact performance trap T10 exists to solve.
`EconomicsPanel` shows the country name and `turn —`.

### Editable fields

`use-field-commit.ts` buffers a field locally and commits it on a **fixed 200 ms
window**, plus blur, plus unmount.

The debounce is not there for `localStorage`; `markDirty` already batches that at
400 ms. It is there because `updateCountry` replaces the countries array, which
invalidates `countryById`, `countryOfProvince`, `countryTintWords`,
`countryAggregates` and `countryLabelSources`, and re-runs the label layout on the
next frame. 200 ms turns a burst of twenty keystrokes into two of those.

The window is fixed and not restarting, the same shape as `createStateWriter` in
`persistence.ts`. A restarting debounce starves: continuous typing would postpone
the write for as long as the user keeps typing.

`commitRef.current` is assigned on **every** render. `onCommit` is an arrow
function in the parent's JSX and its identity changes each render, so an unmount
flush that used the first render's callback would write into the previously
selected country.

A commit clears the draft. The store write is synchronous, so `props.value` then
holds the committed text, or the clamped text when it passed the cap. The field
visibly snaps back in that case, which is the correct feedback.

**Every field call site must pass a `key` containing the target id**, for example
`key={"name-" + country.id}`. Switching the selection then remounts the field and
drops the pending draft. Without the key a draft for country 3 is displayed over,
and then committed into, country 4.

`EditableText` and `EditableTextArea` call no `useSignals()`. They read no signal,
and the call would subscribe a component to nothing. Both pass `maxLength` down to
the DOM element, so the browser stops an over-long paste before `clampText`
truncates it silently at the store.

`ImageUpload` runs T05's `downscaleImage` and hands the parent a data URL. It
never calls `toDataURL`, `FileReader` or `URL.createObjectURL` itself, which keeps
the ~256 KB bound and the WebP-with-JPEG-fallback behaviour in one place. It
rejects a file over `MAX_UPLOAD_BYTES` (20 MB) **before** anything is decoded, so
a 200 MB TIFF never reaches `createImageBitmap`. The in-flight request is a
counter and not a boolean, so two picks in flight cannot let the older one win. A
failed pick keeps the previous image.

### `updateCountry` no longer copies `provinceIds`

`assignProvinces` is the only writer of that array and it always builds a fresh
one, so the copy defended against nothing. `label-store.ts` validates its anchor
cache on **the array's identity**, and with the copy every keystroke in a country
name re-ran `resolveLabelAnchor`, which is up to 1728 `contains` probes. T08 makes
renaming a per-keystroke operation, so the difference is load bearing. A test pins
the identity on every branch of `updateCountry`.

### Traps for later tasks

- **No `.tsx` file in T08 is unit tested.** The repo has no jsdom, and faking one
  to assert on a rendered plaque tests the fake. The logic worth testing was
  pushed into `nextSelection`, `panel-store.ts`, `buildTintWordTable` and
  `useFieldCommit`.
- `MapCanvas`'s gesture semantics are covered by a browser run, not by a test.
  `isContextPress`, the `onPointerDown` decline, the `onContextMenu` idle guard
  and the `onPointerUp` ctrl+click branch live inside a `.tsx` with no exported
  seam. **If a later task extracts the gesture rule into a pure predicate the way
  `nextSelection` was extracted, test it there.**
- `src/ui/use-field-commit.test.ts` drives the hook on a hand-written React
  dispatcher and reads React's internal dispatcher slot
  `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H`.
  `reactInternals()` throws a named error if that slot disappears, so a React
  upgrade fails with a legible message. React is pinned exactly in `package.json`.
- `countryTintWords` cannot be tested end to end. In Node the manifest never
  loads, `maxProvinceId` is 0, and the computed can only produce a length-1 array.
  `buildTintWordTable` is exported for exactly that reason.
- **The HUD in `MapCanvas.tsx` stays.** Earlier sections say T08 replaces it;
  T08 kept it instead. It moved to the bottom left and gained a `scope` readout.
  It is the instrument that proves the screen-to-map transform has not drifted,
  and it is not product chrome. The shell now carries every product-facing
  readout.
- Two layout cases are known and left to T09: the plaque and the panel dock
  overlap between roughly 900 and 1200 px, and the HUD's `max-width` is wrong
  below roughly 760 px. Both are cosmetic.
- Touch is still unhandled, unchanged from T06. This is a desktop prototype.

## The T08-FIX pass

`.plan/VISUAL-CHECK-PHASE2.md` is an independent browser check of Phase 2. It
reported three defects. T08-FIX closes all three. It adds no source file, no
`localStorage` key, no schema field and no migration. Every value it introduces is
session state or derived.

| Defect | The fix | Described in |
|---|---|---|
| D1. A grow-then-shrink resize left the map cropped. | The resize path calls `resizeView` instead of `clampView`, and `viewFitted` decides whether a resize re-fits. | "The fitted policy (T08-FIX)" |
| D2. Nothing called `resetView`, so the view could not be re-fitted. | The `0` key and the button bar's `Reset view` button. | "Keyboard and the reset control" |
| D3. A long thin country's label spilled out of its own shape. | The end probe inside `layoutLabels`, which `drawOverlay` turns on. | "The end probe (T08-FIX)" |

### Files changed

| Path | What changed |
|---|---|
| `src/map/view.ts` | Added `MIN_SCALE`, `fittedScale`, `isFittedScale` and `resizeView`. `fitView` now builds on `fittedScale`. |
| `src/state/view-store.ts` | Added the `viewFitted` signal. `writeView` derives it, and `syncView` branches on it. |
| `src/ui/MapCanvas.tsx` | Lifted `isTypingTarget` to module scope, added the `0` key to the existing keydown effect, and added the HUD's `fit` readout. |
| `src/ui/Shell.tsx` | Added the `Reset view` button and a divider to the existing bar. |
| `src/ui/shell.module.css` | Added `.barDivider` and `.barAction`. |
| `src/map/label-layout.ts` | Extracted the 7-offset trial to `chooseOffset` and added `LayoutOptions.probeEnds`. |
| `src/ui/label-layer.ts` | Forwards `probeEnds` verbatim. |
| `src/ui/render.ts` | `drawOverlay` passes `probeEnds: true`. |

`clampScale`, `clampView`, `zoomAt`, `fitScale` and `MAX_SCALE` are untouched. The
fit floor is still the right rule for user zoom, and zooming out still terminates
at exactly the fit view. `clampView` stays exported and is now called by tests
alone. Do not delete it and do not route a resize back through it.

### The probe is opt-in, and only production opts in

The design called for the end probe to run always, with the plain pass as a
fallback. That broke two T07 tests, and both pin the same thing: offset 0 consults
`contains` zero times. The probe cannot honour that and still fix the overhang,
because the overhang is offset 0. Neither test was weakened. The flag carries the
difference instead.

The opt-in sits one level above where the design put it. `layoutCountryLabels`
forwards `probeEnds` and `drawOverlay` sets it, because
`src/ui/label-layer-cache.test.ts` calls `layoutCountryLabels` itself and an opt-in
there would still have failed. Both settings are tested at both levels. The cost is
that the two pinned tests now describe a configuration production does not use.

### Tests

`yarn test` goes from 493 to 521. No existing test was edited, weakened or deleted.
Each new test was proved to fail against a real mutation of the source, and
`.plan/T08-FIX/memory.md` lists the seven mutations and what each one broke.

### Traps for later tasks

- **A resize never changes a deliberate zoom.** A view that is not fitted keeps its
  absolute scale even when that scale is below the new fit scale, so the map
  letterboxes on all four sides. That is the policy. `0` re-fits it.
- `viewFitted` is derived inside `writeView` and is never assigned by an action. A
  new zoom control needs no wiring. Assigning the flag by hand reintroduces the
  staleness the derivation removes.
- `view-store.test.ts`'s `reset()` sets `viewFitted.value = true`. A new test file
  that drives the view store needs the same line, or a leftover `false` leaks into
  the tests that follow.
- The HUD's `fit yes|no` readout is the browser instrument for D1. Resize the window
  and watch whether it stays `yes`.
- The label fit test still measures the country's union bounding box. Only the
  placement stage probes the ends. Widening `FIT_WIDTH_RATIO` instead would hide
  labels that are correct today.
- `MapCanvas`'s `0` shortcut, `isTypingTarget` and `Shell`'s `Reset view` button are
  untested. The repo has no jsdom. `resetView` itself is pinned by the store tests,
  and reachability stays a browser check.
- The reset is an instant jump with no easing. There are no zoom buttons, no zoom
  slider, no minimap and no keyboard panning.

## Country overview panel

The country's identity sheet: flag, name, slogan, lore, and two read-only
territory facts. Every field writes through `updateCountry`, which T05 made the
only writer, and the store debounces the `localStorage` write behind it.

T09 adds no storage key, no schema field and no migration. It builds no second
field component, no second store and no second panel system. T08 had already
wired four fields to the store to prove the contract, and T09 completes that
body.

### Files

| Path | What it is |
|---|---|
| `src/ui/country-overview.ts` | New. The panel's pure half: digit grouping, the three formatters, the lore counter and the warning-to-sentence table. |
| `src/ui/country-overview.test.ts` | New. 18 cases over that module, including every row of the warning table. |
| `src/ui/country-overview.module.css` | New. The panel's own styles. Tokens only. |
| `src/ui/CountryOverviewPanel.tsx` | Rewritten body. Notice, flag, name, slogan, lore, counter, Territory. |
| `src/state/schema.ts` | Added `countryDisplayName(id, name)`. `createCountry` routes its name through it. |
| `src/state/image.ts` | `FLAG_MAX_EDGE` 256 -> 384. |
| `src/state/label-store.ts` | The label text goes through `countryDisplayName`. |
| `src/ui/ImageUpload.tsx` | Four optional props: `chooseLabel`, `replaceLabel`, `hint`, `previewClassName`. |
| `src/ui/CountryPlaque.tsx` | The name goes through `countryDisplayName`. The country colour now sits behind the flag box always. |
| `src/ui/CountryPanel.tsx` | The row's name input gained the same fallback as its placeholder. |
| `src/ui/fields.module.css` | Added `.hint` and `.status[data-kind="warn"]`. |
| `src/ui/country-plaque.module.css` | `.flagImage` `object-fit` `cover` -> `contain`. |

Nothing under `src/map/`, and none of `render.ts`, `border-layer.ts`,
`label-layer.ts`, `MapCanvas.tsx`, `persistence.ts`, `migrations.ts`,
`borders-store.ts`, `assign-store.ts`, `selection-store.ts`, `use-field-commit.ts`,
`EditableText.tsx` or `EditableTextArea.tsx` was touched.

### The pure half

`src/ui/country-overview.ts` has no React, no signals and no DOM. The repo has no
jsdom, so a `.tsx` cannot be tested. Everything in the panel worth an assertion
was pushed into this module instead, which is the same split T08 used for
`nextSelection` and T07 used for `label-layout.ts`.

`groupDigits` is hand-rolled and does not call `toLocaleString()`. A test that
asserts `"18,687"` against `toLocaleString` asserts whatever ICU the test runner
shipped with. The comma also has to match `CountryPanel`'s existing `18,687 px`
row, and the two must not disagree.

`formatBytes` reports kilobytes only and floors a non-empty image at `1 KB`. A
flag is never megabytes, because `IMAGE_TARGET_BYTES` caps it at 256 KB, and a
second unit is a second thing to get wrong. A flag that is visibly on screen must
never read `0 KB`.

`loreCounterText` stays silent until the text reaches `LORE_COUNTER_AT`, which is
90% of the cap. A counter that is always on is noise in a field meant for prose.
It reads the cap from `LORE_MAX` rather than from a copy of 8000.

### The name fallback

`countryDisplayName(id, name)` lives in `src/state/schema.ts`, next to
`createCountry`, so the string `"Country N"` exists once.

An empty name is reachable: `updateCountry` accepts `""` and stores it. Before
T09 that blanked the plaque, **deleted the country's label off the map** — the
`text === ""` guard in `label-store.ts` skipped the country — and was then
silently rewritten to `"Country N"` by `normalizeState` on the next reload.
Memory and disk disagreed. One function fixes all three surfaces.

The function does not clamp and does not trim the name it returns. Clamping is
`updateCountry`'s job, and trimming while the user types `" New"` would fight the
field. `CountryPanel`'s row input and the overview panel's Name field keep their
raw `value` and show the fallback as a **placeholder**, because a controlled input
has to let the user clear it.

### The flag

`FLAG_MAX_EDGE` is 384, up from 256. The largest surface a flag is drawn on is the
panel preview at 288 CSS px, which is 576 device px on a 2x display, and 256
cannot cover it. The measured cost is about 70 KB of `localStorage` per flag
against the 4 MB budget, so roughly 57 flags. `IMAGE_TARGET_BYTES` still bounds
the pathological case.

The panel never encodes an image itself. It passes `maxEdge={FLAG_MAX_EDGE}` to
`ImageUpload`, which runs T05's `downscaleImage`. There is no `FileReader`, no
`toDataURL` and no `createObjectURL` anywhere in the panel. A test asserts that by
reading the source.

`ImageUpload` gained four optional props and no new behaviour. `chooseLabel` and
`replaceLabel` let the primary button read `replace…` once an image exists, `hint`
draws a standing line under the actions, and `previewClassName` swaps the preview
box. The hint paragraph sits **before** the error paragraph, so a fresh error is
the last thing in the block and sits closest to the button that produced it. The
request counter, the `mountedRef` guard, `MAX_UPLOAD_BYTES` and the error handling
are untouched.

**`previewClassName` replaces `styles.preview`; it never adds to it.** Two
single-class selectors from two CSS modules have equal specificity, so the winner
is whatever order rspack emits the modules in. That is a coin flip that looks
correct until a rebuild.

The plaque draws its flag with `object-fit: contain` and keeps the country colour
behind the box unconditionally. `cover` crops a 2:1 flag's left and right ends,
which is where the charge usually sits. The colour behind does the letterboxing,
so the no-flag state is the same element with nothing in it rather than a second
visual treatment.

### Save failures

`saveNoticeFor(warning, afterFlagWrite)` turns a `StateWarning` into a sentence,
or into `null`. The notice is **panel-level and sits at the top of the body**, not
inside the flag field: a quota failure caused by lore should not appear under a
flag picker, so `ImageUpload` needs no `notice` prop.

| Warning kind | What the panel says |
|---|---|
| `quota` | Storage is full and the change was not saved. Two texts — one names the flag, the other does not. |
| `budget` | The store's own message, styled as a warning rather than an error. The data is on disk. |
| `unavailable` | Saving is off, plus the store's reason. |
| `future` | A newer build wrote this document, so nothing typed here is saved. |
| `corrupt`, `unmigratable`, `repaired` | Nothing. |

The last three are load-time events about the whole document. `App.tsx` already
shows them in the top banner with a dismiss control, and repeating them inside a
panel would say the same thing twice about something the panel cannot fix.

Two rules make a flag write honest:

- **`flushState()` runs after a flag commit and after a flag removal, never after
  a keystroke.** A quota failure is only discovered inside `writeNow`. Without the
  flush it lands 400 ms later and reads as "it worked, then a banner appeared".
- **The store is read back after a flag commit.** `updateCountry` rejects a data
  URL over `IMAGE_DATA_URL_MAX` **silently** — no return value, no warning, no
  timer armed. Comparing `countryById.peek().get(id).flagDataUrl` against the
  committed URL is the only way to know. It is `.peek()` and not `.value`, because
  this runs in an event handler and must not subscribe.

The flag message is **tagged with the country id and derived**, not cleared in an
effect. The panel does not remount when the selection moves; only its keyed
children do. A message produced for country 3 is therefore simply not country 4's
message.

### Territory

Two read-only facts, plus a third when a flag exists: province count, pixel area
and flag size. They come from `countryAggregates`, the T06 computed that already
caches them. **A component never calls `aggregateCountry`.**

The facts render as a `<section>` holding a heading and a `<dl>`. A `<dl>` may
only contain `dt`, `dd` and `div`, so the heading sits outside the list.

### Traps for later tasks

- **Every field call site keeps `key={"<field>-" + country.id}`.** Without the key
  a draft typed for one country is displayed over, and then committed into, the
  next one. T08 set that rule and T09 follows it for all four fields.
- `updateCountry` still does not copy `provinceIds`. `label-store.ts` validates
  its anchor cache on that array's identity, so a rename costs no anchor
  recompute. Do not "fix" it.
- `useFieldCommit`'s window is fixed at 200 ms and is not restarting.
  `use-field-commit.test.ts` fails if it is made restarting. Do not change 200 ms
  or the store's 400 ms.
- `src/scaffold.test.ts` rejects an inline `export` keyword and an
  `export type { … }` clause. Write `export { type Foo };` at the end of the file.
- The `flag` fact reports **decoded** bytes, from `dataUrlBytes`. The real
  `localStorage` cost is about 2.7x that, because the base64 payload is stored as
  UTF-16. The number therefore understates what the quota notice asks the user to
  reduce.
- The flag hint advertises `svg`, but `createImageBitmap` on an SVG blob is
  rejected by Chrome and Safari. Such a pick fails gracefully with "the file is
  not a readable image"; the wording overpromises.
- `saveNoticeFor` ends with a `return null` after its `switch`, so a new
  `WarningKind` compiles and goes quiet instead of failing the build. The guard is
  in the test instead: the expectation table is typed
  `Record<WarningKind, SaveNoticeKind | null>`, so a new kind fails `yarn typecheck`
  there.
- `flag.touched` stays true after a **successful** upload, so a later quota
  failure caused by a lore keystroke still reads "the flag was not saved" until the
  selection moves.
- `.status[data-kind="warn"]` in `fields.module.css` is currently unused. The live
  warning styling is `.notice[data-kind="warn"]` in the panel's own module.
- The panel imports only `country-overview.module.css`. `panel-bodies.module.css`
  stays for T10 and T12.
- Country colour, creation, deletion and assignment stay in the left
  `CountryPanel`. T09 moved none of them.
- Two shell layout defects from T08 are still open, because both are chrome shared
  by all three panels: the plaque and the panel dock overlap between roughly 900
  and 1200 px, and the HUD's `max-width` is wrong below roughly 760 px.
- No `.tsx` in this task is unit tested, for the usual reason. The wiring that
  cannot be reached without jsdom is pinned by source-text assertions in
  `country-overview.test.ts` — `flushState()` present, `countryById.peek()`
  present, `countryById.value` absent, `maxEdge={FLAG_MAX_EDGE}` passed, no
  encoder call, and the four `key` props. `src/scaffold.test.ts` set that
  precedent.

## Provinces overview panel

The selected country's provinces, one editable row each: an image, a name and a
lore box. The list is virtualised. At most thirteen rows exist in the DOM at any
moment, whatever the country holds.

T10 adds no storage key, no schema field and no migration. It builds no second
field component, no second store and no second panel system. Every write goes
through T05's three province setters, and those are already sparse.

### Files

| Path | What it is |
|---|---|
| `src/ui/province-list.ts` | New. The panel's pure half: the window arithmetic, the search predicate, the row assembly, the budget and the quota notice. |
| `src/ui/province-list.test.ts` | New. 46 cases over that module, plus the source assertions listed below. |
| `src/ui/province-list.module.css` | New. The panel's own styles. Tokens only. |
| `src/ui/ProvinceList.tsx` | New. The search box, the scroll viewport, the sliding window, and the two-way selection sync. |
| `src/ui/ProvinceRow.tsx` | New. One row. Reads no signal. |
| `src/ui/ProvincesOverviewPanel.tsx` | Rewritten body. Two empty states, the save notice, the keyed list, the footer. |
| `src/ui/EditableTextArea.tsx` | One optional prop, `areaClassName`. |

Nothing under `src/map/` or `src/state/` changed. `Panel.tsx`, `ImageUpload.tsx`,
`EditableText.tsx`, `use-field-commit.ts`, `country-overview.ts` and
`fields.module.css` are untouched. `panel-bodies.module.css` stays, because
`EconomicsPanel` still imports it.

### The pure half

`src/ui/province-list.ts` has no React, no signals and no DOM. The repo has no
jsdom, so a `.tsx` cannot be tested. Everything in the panel worth an assertion
lives in this module instead. That is the same split T07 used for
`label-layout.ts`, T08 for `nextSelection` and T09 for `country-overview.ts`.

### The virtual window

**Rows are a uniform fixed height, `PROVINCE_ROW_HEIGHT` = 196.** A uniform
height makes the index-to-offset arithmetic O(1) in both directions, so there is
no offset table, no per-row measurement and no per-row `ResizeObserver`.

The constant is applied as an inline `height` on the row element, and
`province-list.module.css` declares no height at all. The two therefore cannot
disagree. A test pins both halves of that.

The number comes from the row's internal budget: 2 px of border, 16 px of
padding, a 24 px header strip, an 8 px gap, and 144 px for the taller of the two
body columns. That is 194, and 196 leaves 2 px of slack. The row clips its
overflow, so a preview grown past the budget cuts the fields off silently rather
than pushing the row taller.

**The component's whole scroll state is one integer, `first`.** The `scroll`
handler calls `windowStart(scrollTop, …)` and React bails when the integer is
unchanged, so scrolling inside one row costs zero renders.

`windowGeometry(first, …)` returns the window. It **re-clamps `first`** to
`rowCount - visible - overscan`, which is exactly the value a real scroll to the
bottom produces. The clamp therefore never fights the user, and it removes the
blank frame between a filter shrinking the list and the browser's own `scrollTop`
clamp firing a `scroll` event.

`visible` is `ceil(height / rowHeight) + 1`. The `+ 1` covers a partially
scrolled first row. `OVERSCAN_ROWS` is 4 above and 4 below, which is generous on
purpose: a row that unmounts under a fast scroll aborts an in-flight
`downscaleImage` inside it.

The rendered rows are **one translated block of contiguous rows**, not one
absolute position per row. A scroll step is a single `transform` write.
`.rows` must carry no `gap`. A gap adds height the geometry does not know about,
and the window then drifts away from the scrollbar.

Measured in Chrome on a 400-province country at a 678 px viewport: 13 rows in the
DOM at every scroll position, 9 at the very bottom, a spacer of 78 400 px, and a
measured row height of exactly 196. `ceil(678 / 196) + 1 + 2 * 4` is 13.

### Search

The filter matches the display name as a case-insensitive substring, and the id
as a **prefix**. Typing `41` surfaces province 41 and 412, not every province
whose id contains those digits.

The lore is deliberately not searched. It is up to 8000 characters per province,
and a full-text match over prose is unpredictable where a name-plus-id match is
not. There is no debounce either, because the filter is one `includes` over a few
hundred short strings.

`filterRows` returns the **same array reference** for an empty query. That
identity keeps an unfiltered list free through the `useMemo` chain.

### Selection, both ways

A click on a row's header strip calls `selectProvince`. Focus entering any field
in the row does the same, so typing moves the map highlight to the province being
edited. `selectProvince` deduplicates through `sameSelection`, so a focus move
inside one row writes nothing.

**A row click sets scope `"province"`, and the panel does not empty.**
`selectedCountryId` at any non-country scope reads `countryOfProvince` live, so
`selectedCountry` still returns the same country. That looks like a bug waiting
to happen. It is not.

The map-to-list scroll is **guarded on the selection id held in a ref**, not on a
render. Hand-scrolling therefore never re-scrolls, and the `scrollTop` write
cannot loop: the `scroll` event it fires re-renders, and `syncedRef` already
holds the id.

`scrollTopForIndex` returns `null` for a row that is already fully visible, so a
click on a visible row never jumps the list under the cursor. A jump of more than
one viewport centres the target row instead of gluing it to an edge. A row the
filter hides is **not** recorded as synced, so clearing the query scrolls to it
then.

`<ProvinceList key={country.id}>` resets the query and the scroll position when
the selection moves to another country, with no effect and no cleanup.
`country.id` does not change when provinces are painted into that same country,
so painting never resets the list.

### Sparseness

Sparseness is inherited, not re-implemented. `writeOverrideField` in
`world-store.ts` already skips an unchanged value, and it deletes an override
once its last field is emptied. T10's only duty is to call a setter from a commit
handler and never from render. `useFieldCommit`'s unmount flush is safe: `flush()`
returns early unless `onChange` assigned something.

**The name input is controlled on the raw override value, not on the resolved
name.** A controlled input has to let the user clear the field, and
`setProvinceName("")` removes the override — which is exactly how a province
returns to its manifest name. The resolved name shows as the placeholder and in
the header strip.

The footer's `edited` count is the in-app instrument for all of this. Open a
300-province country, scroll the whole list, and it must still read `0 edited`.
Verified in Chrome: after two full sweeps `provinceOverrides` is `{}`. Typing one
name writes `{"350":{"name":"Alta Verde"}}` — one key, one field.

**`overrideSummary` is computed over all rows, never over the filtered ones.**
The `edited` count must not drop when a filter hides the edited provinces.

### The row

`ProvinceRow` reads no signal and imports nothing from `@preact/signals-react`.
`ProvinceList` holds the only subscription and hands each row plain props.
Thirteen rows each subscribing to `provinceOverrides` would re-render all
thirteen on every keystroke anyway, because the parent re-renders too.

Rows are keyed by the province id. A sliding window therefore unmounts the
leaving id and mounts the entering one fresh. The inner fields need no keys of
their own, and a buffered draft can never land on the wrong province.

`ImageUpload` gained no new prop. `chooseLabel="add…"` and
`replaceLabel="change…"` are short enough to sit beside `remove` in the 136 px
image column, and `choose file…` is not. That is the whole reason for the short
labels. The format line sits in the panel footer once instead of in every row.

`EditableTextArea` gained one optional prop, `areaClassName`, because
`fields.module.css`'s `.area` sets `min-height: 6em` and `resize: vertical` and
both break a fixed row height. **It replaces `styles.area` and never adds to
it.** Two single-class selectors from two CSS modules have equal specificity, so
appending makes the winner depend on the order rspack emits the modules in. That
is the same rule and the same wording T09 wrote for `previewClassName`.

`PROVINCE_LORE_ROWS` is 3. The full `LORE_MAX` cap of 8000 characters still
applies, and the box scrolls internally.

### The viewport is always mounted

The "no province matches" line renders **inside** the scroll viewport, not in
place of it. Unmounting the viewport would drop the `ResizeObserver` registered
against that element in a `[]`-dependency effect, and `viewportHeight` would then
be stale for the rest of the session.

The panel body needs no change to scroll correctly. `Panel`'s `.body` is already
a flex column with `min-height: 0`, so `.viewport` becomes the scroller with
`flex: 1; min-height: 0; overflow-y: auto`. **Every sibling of the viewport is
`flex: none`.**

### The footer is a render prop

`shown` is a function of the query, and the query lives inside `ProvinceList`
under the `key={country.id}` remount. `ProvinceList` therefore takes
`footer: (shown, summary) => ReactNode` and calls it during render. The sentence
and its styling stay in the panel, with no effect and no extra render.

### The image budget

`PROVINCE_IMAGE_MAX_EDGE` stays 320. The row preview is 96 CSS px, which is 192
device px at DPR 2, so 320 already has headroom for a larger preview later.
Raising it multiplies stored bytes by the square of the ratio for a surface
nothing draws. T09 pinned 320 in `image.test.ts`.

`localStorage` is accounted in UTF-16 code units, so one base64 character costs 2
bytes. A 320-edge WebP is about 24 000 characters, which is about 48 KB stored.
That is `PROVINCE_IMAGE_STORE_BYTES`. Against `STORAGE_BUDGET_BYTES` of
4 000 000 that is **about 80 province images** before the `budget` warning, and
roughly 100 before a real 5 MB quota throws.

The worst case is much smaller. `IMAGE_TARGET_BYTES` caps one image at 256 KB
decoded, which is about 700 KB stored, so five such images exhaust the budget.
250 full 8000-character lores do too. A live test with 300 lores hit the warning
at 4701 KB, and the panel stayed usable at 13 rows.

`imagesRemaining` floors at 0, so a document already over budget reads "room for
about 0" rather than a negative count.

### Quota and the save notice

Quota is surfaced exactly the way T09 surfaces it for the flag.

- **`flushState()` runs after an image write and after an image removal, never
  after a keystroke.** A quota failure is only discovered inside `writeNow`.
  Without the flush it lands 400 ms later and reads as "it worked, then a banner
  appeared".
- **`isImageDataUrl` is called before `setProvinceImage`, not after.** The store
  rejects an over-cap data URL silently — no return value, no warning, no timer
  armed. Running the store's own predicate first turns the silent drop into a
  sentence, with no read-back and no `.peek()` question.
- The notice sits at the top of the panel body, never inside a row. A quota
  failure caused by lore must not appear under one province's file picker.
- `imageSaveNoticeFor` **delegates to T09's `saveNoticeFor`** and overrides one
  branch only: `quota` after an image write. The warning-to-sentence table stays
  in one place, so a new `WarningKind` still has exactly one home.

The message is tagged with the province id and derived, not reset in an effect.
The panel does not remount when the selection moves; only its keyed child does.
The panel therefore checks `country.provinceIds.includes(notice.provinceId)`, and
a notice produced for another country's province is simply not shown.

### Tests

`yarn test` goes from 547 to 593. Every new case is in
`src/ui/province-list.test.ts`. No existing test was edited, weakened or deleted.

The geometry is pinned by a **full scroll sweep**: `windowStart` composed into
`windowGeometry` the way the component composes them, over 6 row counts, 5
viewport heights and every row boundary plus a 97 px comb. The sweep runs at
overscan 0 as well as 4. Four spare rows on each side hide an off-by-one, and at
0 the `+ 1` for a partially scrolled row is load bearing.

Six mutations were applied to the source and each one broke a test: dropping the
`+ 1` from `visible`, dropping the trailing overscan from `last`, ceiling instead
of flooring in `windowStart`, restoring a `ROW_CAP` slice in the panel, making
`.rowArea` resizable, and controlling the name input on `row.name`.

The wiring jsdom cannot reach is pinned by source assertions, the precedent being
`scaffold.test.ts` and `country-overview.test.ts`. They cover the three setters,
the absence of any effect in the row, `areaClassName` replacing rather than
appending, the viewport rendering before the empty branch, the flex rules in the
CSS module, the row's internal pixel budget, and the panel carrying no `ROW_CAP`
and no `slice(`.

### Traps for later tasks

- **`PROVINCE_ROW_HEIGHT` is inline and the CSS declares no height.** Add a
  border, a padding or a taller preview to a row and the fields are clipped, not
  pushed down. Change the constant and the internal budget comment together.
- **`.rows` must carry no `gap`.** A gap drifts the window away from the
  scrollbar, and nothing on screen says why.
- `ProvinceList` reads `provinceOverrides`, `selectedProvinceId` and `loadPhase`
  in the **component body**, never only inside a `useMemo`. A render where the
  memo does not re-execute would read nothing and quietly unsubscribe. The
  `loadPhase` read is what stops the names from staying `"Province N"` for the
  whole session, because `getMapAssets()` is a plain module variable and notifies
  nobody.
- `country.provinceIds` is stable by identity. `updateCountry` deliberately does
  not copy it, and both `label-store.ts` and this list depend on that. Do not
  "fix" it.
- **`ImageUpload` drops an in-flight upload when its row unmounts**, through its
  `mountedRef` guard. `OVERSCAN_ROWS = 4` widens the safe band. Fixing it means
  lifting the busy flag out of a component three panels share, so it is recorded
  and not fixed.
- The hard-quota branch, where `setItem` itself throws, was never reproduced in a
  browser. Chrome accepted a 4.7 MB document plus 1.3 MB of ballast without
  throwing. `imageSaveNoticeFor(quota, true)` covers the branch, and it renders
  through the same element the `budget` warning was seen rendering through.
- A phantom province id stays listed and stays editable. Ids 1318 and 1458 are
  absent from the manifest, and a stored document may name others. Such a row
  carries `data-known="false"`. Hiding it would make its override unreachable.
- Not built, deliberately: no camera move on selection, no assignment,
  reordering, multi-select or bulk edit from this panel, no "all provinces" view
  for unassigned provinces, and no lore full-text search. A camera move needs a
  new `view-store` action and would reopen the fitted policy.
- Still open from T08 and T09, because both are chrome shared by all three
  panels: the plaque and the panel dock overlap between roughly 900 and 1200 px,
  and the HUD's `max-width` is wrong below roughly 760 px.
- Touch is still unhandled. This is a desktop prototype.

## Economics calculator engine

The economy is a real calculator, not a stub. `src/economy/` computes a country's
GDP, growth, spending points, savings, debt, resources, credit rating and control
scale, and it advances all of that by one turn.

The rules come from `.plan/T11/FORMULA-SPEC.md`. That file is the authority, and
T11-B implements it literally. The spec itself was reconstructed from a Russian
rulebook article and fifteen screenshots of the original spreadsheet, both
preserved under `.plan/T11/`. The article states no formulas, so every formula in
the spec is either recovered from a screenshot or invented. The spec labels each
constant `SOURCED` or `INVENTED`, and `src/economy/constants.ts` carries the same
split in its comments.

T11-B adds no UI, no store field, no storage key and no migration. Nothing
outside `src/economy/` was created or modified. T12 wires the engine to a panel.

### Files

| Path | What it is |
|---|---|
| `src/economy/types.ts` | Every shape the engine reads or returns. No runtime code. |
| `src/economy/constants.ts` | `ECONOMY_CONSTANTS`, the rating tiers, the eleven control bands, the per-tier debt table, the resource matrix and its computed inversion. The only place a balance number is written. |
| `src/economy/num.ts` | `roundTo`, `clamp`, `finiteOr`, `safeDivide` and the two range predicates. |
| `src/economy/control.ts` | The control band index, its name, and its three generated effects. |
| `src/economy/rating.ts` | The tier lookup, the FR rating factor, the per-tier debt terms, the clean-turn predicate, and step 13. |
| `src/economy/resources.ts` | Step 2: need, extraction, imports, exports, supply, shortage, and the per-sector penalty. |
| `src/economy/generation.ts` | Step 3: FR and MIC generation, emission, inflation and the two step limits. |
| `src/economy/actions.ts` | Step 4: nationalization, privatization and the concession grant. |
| `src/economy/debt.ts` | Step 5 borrowing and step 7 servicing. |
| `src/economy/savings.ts` | Step 6 reserve and stockpile, step 8 upkeep, step 10 auto-investment. |
| `src/economy/growth.ts` | Step 11: the modifier sum, the per-sector rate, and the GDP-weighted overall rate. |
| `src/economy/gdp.ts` | Step 12: the next-turn volumes and the concession cost. |
| `src/economy/validate.ts` | V1 to V13, the errors that abort a turn. |
| `src/economy/derive.ts` | `deriveEconomy` — the read-only form of steps 2 to 13. |
| `src/economy/pipeline.ts` | `resolveTurn` — the fifteen steps as data, and the draft fold. |
| `src/economy/history.ts` | The turn record, its stored precision, and the twelve-record cap. |
| `src/economy/economy-state.ts` | `createInitialEconomy` and the two row factories. |
| `src/economy/serialize.ts` | `economyToJson` and the repairing `economyFromJson`. |

There is no barrel file. The package has none anywhere, so a caller imports the
module it needs.

### The engine is pure, and a test enforces that

`src/economy/` is plain TypeScript over plain data. It imports no React, no
signals, no stylesheet and nothing from `src/ui/`. It touches no DOM, no
`localStorage`, no clock and no random source. The dice roll for an action is an
input the caller supplies, exactly as the rulebook has a judge throw it in a chat.

`src/economy/purity.test.ts` scans the directory and asserts all of that. It also
asserts the one import that leaves the directory is type-only — `serialize.ts`
reuses `JsonRecord` and `JsonValue` from `src/state/schema.ts`, and a type-only
import erases at build time. The same file checks the repo's export convention:
one grouped named export, last in the file, on every source module.

Purity is what makes every formula testable without a browser. The repo has no
jsdom, so a module that reached for the DOM could not be tested at all.

### Two entry points

```ts
deriveEconomy(state: EconomyState, context?: EconomyContext): DerivedEconomy
resolveTurn(state: EconomyState, context?: EconomyContext): TurnResolution
```

`deriveEconomy` answers "what does this sheet say right now". It is **total**: it
computes through step 13 even on invalid input and it never throws. That is what
lets T12 show live derived values while a field is half-typed, and it is what lets
step 1 report every error at once instead of stopping at the first.

`resolveTurn` answers "advance to the next turn". It calls `deriveEconomy` once
as step 1. If that pass reports errors, the turn aborts and nothing is written.
Otherwise the remaining fourteen steps fold a draft state and the call returns the
next state plus a turn record.

Both functions are pure. Neither writes to its argument. `determinism.test.ts`
pins this three ways: the same input gives a deep-equal output twice, the input
deep-equals its own snapshot afterwards, and a deep-frozen state resolves without
a throw.

`context` is `{ provinceCount }` and defaults to 0. The concession cost divides
total GDP by the province count, and the engine may not read a store to find that
number. A count of 0 makes a concession free, which is the documented guard.

### The turn pipeline

`TURN_STEPS` is an ordered array of fifteen named step descriptors:

```
derive-and-validate  resources  generation  actions  borrowing  savings
debt-service  upkeep  spending  auto-invest  growth  gdp  rating  flags  commit
```

**The order is load-bearing.** Steps 6, 7, 8 and 9 all draw on one running FR
balance, so moving any of them changes every number after it. The order is
therefore data rather than control flow, and `pipeline.test.ts` asserts the
fifteen names deep-equal the spec's list in the spec's order.

Every step returns a new draft. No step mutates. Each step also returns a record
of what it changed, and those records are what the turn history stores.

Only step 1 can abort. There is no second validation site anywhere in the engine.

### The running FR balance

Money is charged in a fixed order, and the order has consequences a player can
feel. A reserve addition is charged at step 6, **before** debt service at step 7.
So banking money can starve an auto-serviced loan and cost rating points. That is
deliberate and it is never silent: warnings V14 and V17 both fire.

The balance is exposed at three points — `frBalanceAfterSavings`,
`frBalanceAfterDebt` and `frBalanceAfterUpkeep` — so a panel can show where the
money went. `frAvailable - frSpent` is the same set of terms in a different
order, and a test asserts the two agree.

### Anti-circularity

FR generation reads growth, and growth reads unspent FR. That is a cycle.

The cycle is broken by `plannedGrowthPct`, which depends only on the sector
volumes and the two growth columns. Generation at step 3 reads
`plannedGrowthPct`. Growth at step 11 reads the FR left over. Nothing iterates to
a fixed point, and the pipeline stays a straight line.

Total GDP is likewise frozen once, at the top of `deriveEconomy`. Every quantity
that divides by GDP sees that one number.

### Numbers

Internal arithmetic runs at full double precision with no intermediate rounding.
**A rounded value is never an input to further arithmetic.** Rounding is a view,
applied at exactly two boundaries: the turn record and the commit step.

`roundTo` is symmetric half-up on the magnitude. `Math.round` alone breaks ties
upward, so `-0,125` would land on `-0,12` while `+0,125` landed on `+0,13`.
Growth and rating deltas are signed, so the asymmetry would show.

Every division goes through `safeDivide`, which returns 0 on a zero or non-finite
denominator. Every number written to a draft or a record passes `finiteOr` first,
because `sanitizeRecord` in `src/state/schema.ts` **drops** a key whose value is
`NaN` or `Infinity` — the field does not become null, it disappears from the saved
document. Every range check is written negated, `!(x >= 0 && x <= max)`, so a
`NaN` fails it instead of sailing through.

### What a turn computes

**Generation.** FR is a 20% tax on GDP, scaled by the credit rating, the control
band, planned growth, the military share and the light-industry share. Emission is
added on top rather than multiplied in, because printing money creates money in
proportion to the money base and needs no creditor. MIC is generated from the
military share, scaled by planned growth and the heavy-industry share. At the
standard start this gives 10 017,00 FR and 233,20 MIC.

**Credit rating.** Seven tiers from A+ down to F. The rating sets the FR factor,
the borrowing limit as a multiple of annual income, the interest rate and the loan
term. Five effects subtract points and exactly one adds: a **clean turn** earns
+1. A turn is clean when emission is zero, no debt payment was missed, and
realised growth is strictly positive. The recovery is one more term in the same
sum, not a gate on the others, so a clean turn that also nationalises is -4 + 1.

**Control scale.** Eleven bands from total control to minarchism. All three
effects are generated from the band index, so band 50 stays neutral however the
coefficients are retuned. The scale sets a growth bonus, an FR multiplier, and the
**step limit** — the most a player may move emission or military spending in one
turn. The step limit is a hard cap, never a clamp: a value past it aborts the turn
through V3 or V4 rather than being quietly trimmed.

**Resources.** Eight resources feed sectors through a fixed dependency matrix.
One deposit yields 50 units a turn. A shortage penalty is a weighted, normalised
mean of the shortages of the resources a sector depends on, so a total shortage of
everything gives exactly 1. The penalty is multiplicative and applies only when
pre-shortage growth is positive. Both halves of the original rule therefore hold
exactly: a full shortage lands the sector on 0, and a sector already shrinking is
untouched. A shortage can never on its own drive growth negative.

**Debt.** Loans amortise straight-line over the remaining term, so the last
payment is the whole remaining principal and a loan closes at exactly 0. Interest
is paid before principal, and unpaid interest capitalises — that is the whole
mechanism behind a debt spiral, with no extra rule. Loans are serviced in array
order, so a thin balance starves the newest loan rather than short-paying all of
them. A loan created this turn is not serviced this turn.

**Actions.** Nationalization always succeeds structurally; the roll scales only
the payout. Privatization succeeds on a roll of 6 or more and drags future FR or
MIC generation for three turns. Both sit behind a two-turn cooldown, tracked
separately, and each is locked out at one end of the control scale. A concession
adds +1,50 pp of growth and costs total GDP divided by the province count.

**Growth and GDP.** One modifier sum applies equally to every sector, and the
shortage is the only per-sector term. Next-turn volumes are rounded per sector,
and the total is the sum of the rounded parts. Rounding the total on its own would
let it disagree with the parts a player reads.

### Errors and warnings

V1 to V13 are **errors**. Any one of them aborts the turn and nothing is written.
V14 to V20 are **warnings**. They report something the engine absorbed — a
clipped export, a clipped reserve movement, a debt shortfall, lost MIC points, a
zeroed sector, a clamped concession cost. A warning never stops a turn. Each
warning string starts with its own code, so a panel can group them.

### Persistence

`economyToJson` produces the document `setCountryEconomics` persists.
`economyFromJson` reads arbitrary JSON back and **repairs** rather than rejects,
the same contract `normalizeState` follows. It never throws. Without a repairing
reader one damaged field would lose a country's whole economy.

Turn history is capped at twelve records. A record holds the closing headline
numbers, the per-step deltas and the warnings, never a state snapshot. It also has
to stay flat: `sanitizeRecord` allows eight levels of containers, and the path
from the slot down to a single delta already uses seven.

### Tests

**203 tests across 23 files**, and the suite as a whole is at 796. Every
source file except `types.ts` and `derive.ts` has a test file of its own, and
`purity.test.ts` asserts that pairing.

Four files carry most of the weight:

- `fixture.test.ts` walks the spec's worked example table by table, one test per
  pipeline step. `fixture-detail.test.ts` pins the columns behind those headlines.
- `boundaries.test.ts` sweeps both edges of all seven rating tiers and all eleven
  control bands through the whole engine. The lookup functions have their own
  tests; this file checks the wiring, which is where an off-by-one would bite.
- `guards.test.ts` reaches every degeneracy the way a player would: a country with
  zero GDP, a total resource shortage, a starved loan, a matured loan, a rating at
  its clamp, and a step-limit breach that is rejected rather than clamped.
- `clean-turn.test.ts` and `guards.test.ts` between them drive each clause of the
  clean-turn predicate separately, with the other two clauses asserted to hold.

**Assert derived numbers with a tolerance, never by equality.** `10 000 × 1,06 ×
0,90 × 1,05` does not land on exactly `10 017` in IEEE-754. Whole-obor volumes and
integer ratings are the only safe equality assertions.

**A test file may not export anything** — `purity.test.ts` enforces that. So a
fixture builder cannot be shared between test files, and each file rebuilds its
own country. That duplication is deliberate.

### Known limitations

- **The engine formats nothing and stores nothing itself.** It returns numbers.
  Rendering, the editability split, the End Turn control, the history view and the
  write to `localStorage` all belong to the panel — see "Economics panel and End
  Turn" below. `ECONOMY_SCHEMA_VERSION` is 1 and there is no earlier economy
  document, so `src/state/migrations.ts` stays untouched.
- **A fresh country starts with zero deposits**, so it reads a full resource
  shortage until a judge sets its geology. The spec states no starting geology and
  the engine may not invent one. This is correct, and it is not a bug.
- **Most constants are invented.** The rulebook publishes no formulas, and the
  screenshots were all captured in a resource-starved state. `constants.ts` is the
  single retuning surface, and every scalar in it can be changed without touching
  a formula.
- A loan whose next principal rounds to 0 is removed from `loans[]`. The spec says
  a loan closes at exactly 0 but never says to remove it, and a kept zero loan
  would demand 0 forever while the array grew without bound.

## Economics panel and End Turn

The economics panel is the sheet a player fills in and the button that advances a
turn. It renders all twelve areas of `.plan/T11/FORMULA-SPEC.md`, it decides who
may type into which field, and it shows the record of what the last turn moved.

**No formula lives in `src/ui/Econom*`.** Every number on the sheet comes from one
memoised `deriveEconomy` call, and every advance comes from one `resolveTurn`
call. The panel formats numbers and gates inputs, and it does nothing else. The
engine in `src/economy/` was frozen for this task: T12 added no formula, changed
no constant, and touched no file under `src/economy/`.

### Files

| Path | What it is |
|---|---|
| `src/state/economy-store.ts` | The bridge: hydrate, hold, derive, write through, End Turn, judge mode. |
| `src/ui/economics-format.ts` | Every number the panel prints. Pure. |
| `src/ui/economics-fields.ts` | The tag table, number parsing, the step window, the ledger array edits. Pure. |
| `src/ui/economics-history.ts` | A `TurnRecord[]` becomes a readable view. Pure. |
| `src/ui/EconomyReadout.tsx` | `Readout` — an `[A]` cell. Contains no input at all. |
| `src/ui/EconomyField.tsx` | `NumberField`, `SelectField`, `ToggleField`, `TextField`, and `SectionProps`. |
| `src/ui/EconomySectors.tsx` | Areas 1 and 2: GDP, the 5+2 sectors, per-sector and overall growth. |
| `src/ui/EconomyStanding.tsx` | Areas 3, 4 and 9: credit rating, control scale, both step limits. |
| `src/ui/EconomyBudget.tsx` | Areas 5, 7 and 8: emission, military share, FR and MIC generation, the four ledgers. |
| `src/ui/EconomySavings.tsx` | Area 6: the FR reserve and the MIC stockpile. |
| `src/ui/EconomyResources.tsx` | Area 10: the eight resources and the dependency matrix. |
| `src/ui/EconomyDebt.tsx` | Area 11: capacity, borrowing, the loan table, servicing. |
| `src/ui/EconomyFlags.tsx` | Area 12: mobilization, region, actions, concessions, cooldowns, timed modifiers. |
| `src/ui/EconomyTurn.tsx` | End Turn, the pre-flight error list, the turn history. |
| `src/ui/EconomicsPanel.tsx` | The shell: notices, the legend, the judge toggle, the eight sections. |
| `src/ui/economics.module.css` | Tokens only. No hardcoded colour, gap, radius or font size. |

`src/App.tsx` installs `initEconomySync()` beside `initCountrySync()` and disposes
it first.

### Editability comes from the tag

The spec tags every field `[P]`, `[V]` or `[A]`, and the tag is the only thing
that decides whether a player may type into the field.

| Tag | Meaning | Judge mode off | Judge mode on |
|---|---|---|---|
| `[P]` | player — you set it directly | editable | editable |
| `[V]` | verdict — a judge, an event or a dice roll sets it | locked | editable |
| `[A]` | auto — the engine computes it | never an input | never an input |

`fieldAccess(tag, judge)` in `economics-fields.ts` is that table as a function,
and it is one of the most-tested things in the package.

**An `[A]` field never becomes editable, in either mode.** Two mechanisms enforce
that. `fieldAccess` returns `auto` for every `[A]` tag, and `EconomyReadout.tsx`
contains no `<input>`, no `<select>`, no `<textarea>` and no `contentEditable`.
There is no code path through which an `[A]` value becomes typeable.

**A locked `[V]` field is a `disabled` input.** A disabled input cannot be
focused, typed into, pasted into or dropped on, so a player cannot edit a verdict
field by accident. No click handler guards it, because a handler can be bypassed
and a `disabled` attribute cannot.

Judge mode is a checkbox at the top of the panel. The panel root carries
`data-judge`, so one CSS rule outlines every unlocked `[V]` field. **Judge mode is
not persisted.** It is view state, not world state, and it resets to off on every
reload. A player who reloads the page therefore cannot inherit a judge's unlocked
sheet. Judge mode is an honesty toggle in one browser, not authentication — the
prototype has no backend, no roles and no audit.

A field can also be unavailable for a reason that has nothing to do with its tag.
A borrow field is disabled while the country is in default, and an enterprise
select is disabled while no action is pending. Each such field names its reason
rather than silently accepting a number the turn would reject.

### A typed number is rejected, never clamped

`parseNumberInput(text, spec)` refuses a value instead of trimming it. Spec
section 12 requires that for the step limit, and the panel applies the same rule
to every range on the sheet:

1. An empty field is not zero. Clearing a field reports "enter a number", because
   a silent zero is how a player wipes their GDP without noticing.
2. Only digits, one optional sign and one decimal point pass. `"1e9"`, `"12px"`
   and `"1,000"` all fail cleanly.
3. A non-finite value fails. `sanitizeRecord` **drops** a `NaN` key, so such a
   value would make the field disappear from the saved document on the next
   reload.
4. A fractional value fails on a whole-number field.
5. A value outside the range fails, and the message quotes the range. The check
   is written negated, `!(value >= min && value <= max)`, so a `NaN` that slipped
   through the earlier checks still fails.

A rejected value is never written. `useFieldCommit` clears its draft after the
200 ms commit window, so the input snaps back to the last committed number. While
the draft is illegal the input carries `aria-invalid="true"` and shows the reason.
The `min`, `max` and `step` attributes come from the same spec, so the browser's
own spinner agrees with the parser instead of contradicting it.

Every field carries a `key` containing the country id. Switching country remounts
the field and drops the buffered draft, so a draft for one country can never land
on another country's sheet.

### The step cap

Emission and the military share may each move only so far in one turn. The control
band sets the limit, and mobilization widens the military limit by 10 pp.

`stepWindow(last, limitPp, min, max)` turns that limit into the field's own range:
`[max(min, last - limit), min(max, last + limit)]`. The emission and military
fields take their `spec.min` and `spec.max` from that window, so an over-large
value fails `parseNumberInput` and is never written. **V3 and V4 cannot be
produced by typing.** `stepWindowText` prints the window under both fields, for
example `step this turn: 10.00 pp — you may set 0.00% to 14.00% (now 4.00%)`.

The window is exactly V3, neither looser nor tighter, and a test pins both edges
against `deriveEconomy`. A looser field would accept a value End Turn refuses. A
tighter field would make a legal move unreachable.

The engine's own check stays the authority, because the window alone cannot catch
every case. A judge who lowers the control position narrows the window while
nothing is typed, and the already-committed emission can fall outside it. Then
`derived.errors` carries V3, the emission field shows it, the pre-flight list
names it, and End Turn refuses.

### The store bridge

`src/state/economy-store.ts` exists for three reasons the panel cannot solve on
its own.

- **`economyFromJson` repairs what it reads.** A round trip through JSON on every
  keystroke would let the reader rewrite a half-typed value. So the hydrated
  `EconomyState` is held in memory, in a draft map, and that object is the live
  truth for the session.
- **`deriveEconomy` must run once per change, not once per readout.** A `computed`
  memoises it.
- **`setCountryEconomics` silently no-ops for an unknown country id.** One guarded
  writer keeps that from being a hazard scattered across eleven components.

`selectedEconomy` is a `computed` that writes nothing. It returns the draft when a
draft exists, and otherwise it hydrates from the saved slot. Three properties of
that shape are load bearing:

- **No signal is written during render.** An effect that hydrated into a signal
  would fire during a render pass, which is the classic way to get an infinite
  loop here.
- **Once a draft exists the computed stops subscribing to `economics`.** A
  `computed` tracks dependencies dynamically, so after the first edit another
  country's save does not re-hydrate this one.
- **A country the user only looks at is never written.** The standard opening
  sheet renders from `createInitialEconomy()`, and nothing reaches storage until
  the first edit or an End Turn. A 60-country document therefore does not gain 60
  economies nobody touched.

`selectedDerived` calls `deriveEconomy` with `{ provinceCount }` read from
`countryById`. That subscribes the panel to province painting, which is correct: a
concession costs total GDP divided by the province count, so painting a province
changes what a concession costs.

Every writer reads through `.peek()`, never `.value`, because each one runs inside
an event handler and must not subscribe anything to anything. Every collection
helper replaces its array instead of mutating it — a mutated array is
`Object.is`-equal to itself, and nothing would re-render.

Write-through is synchronous and there is no second debounce. `setCountryEconomics`
marks the state dirty, the T05 writer already coalesces the `localStorage` write
at 400 ms, and the inputs are already buffered at 200 ms. A second debounce here
would only add a window in which a closing panel loses the last edit.

The store refuses to create an invalid state where it can. `addOtherSector`
returns early without grounds, because spec section 4.1 makes such a sector
illegal through V10. `removeOtherSector` also clears a pending concession that
names the removed sector, because the concession would otherwise raise V11 on
every later turn with no field left to point at.

### End Turn

The pre-flight list sits above the button and is always visible. Every entry of
`derived.errors` renders as its code, its field and its message, and every warning
renders in a quieter tone. So a player sees what blocks the turn before pressing
anything.

**The button is two-stage, because an End Turn cannot be undone.** `resolveTurn`
is synchronous, so a fast double click would advance two turns with no way back.
The first press arms the button and the label becomes `confirm turn N`. A second
press within five seconds resolves the turn. The arm is dropped by the timeout, by
a change of country and on unmount.

The button is disabled when saving is off, and it names the reason. Resolving a
turn that could never be saved is the worst outcome in this panel.

`endEconomyTurn` then does five things:

1. It calls `resolveTurn(state, { provinceCount })`.
2. On failure it records the errors and writes nothing. The engine guarantees that
   an aborted turn changes no state, and the store relies on that guarantee.
3. On success it commits the next state through the single writer.
4. It calls `flushState()`. **This is the only `flushState()` call in T12** — a
   keystroke never flushes. An End Turn that did not reach disk is real data loss,
   and learning about it 400 ms later reads as "it worked, then a banner appeared".
5. It reports whether the write reached storage.

A banner then shows the outcome. A failed turn says nothing changed and lists
every error under `role="alert"`. A resolved turn names the turn, the realised
growth and the rating move. When the write did not reach storage the banner adds
an error-toned line: the economy advanced in memory but did not reach storage, and
the player should free some space and edit any field to retry.

### Turn history

`buildHistoryView(records)` turns the engine's `TurnRecord[]` into something a
player reads. The engine stores the newest record last, and the view reverses the
array, because a player reads the newest turn first.

Each turn renders as a `<details>` element. The newest turn is open, the rest are
closed. Inside sit the closing headline numbers and then all fifteen pipeline
steps in the engine's own order, each with a readable title, its surviving rows
and its notes. A warning renders as its V-code in a chip plus a sentence, split
out of the engine's own warning string.

**A zero-valued row is dropped.** A fifteen-step dump in which twelve rows read
`0.00` is a raw dump and not a record. A step that loses every row is marked quiet
and renders as one line, `no change`, so the step order stays visible and a reader
can still see that the step ran.

`humanizeLabel` maps every engine label the panel knows to a phrase, and it splits
camelCase for anything else. So a step added to the engine later degrades to a
readable row instead of disappearing.

The engine keeps the last twelve turns, and the footer says so.

Three display bugs were found by reading the rendered sheet rather than by the
unit tests, and all three would have shipped as numbers that lie:

1. **A drag rendered as a bonus.** `growth.ts` *subtracts* `inflationGrowthPp`,
   `defenceGrowthPp` and `reservePenaltyPp`, and the engine stores all three as
   positive magnitudes. A signed format therefore printed `+0.60 pp` for what is a
   0.60 pp cut. `formatDrag` flips the sign for display only. Two tests pin it, and
   one of them greps `growth.ts` for the three subtractions, so a later engine
   change breaks a test instead of the display.
2. **A closing level signed as if it were a change.** A step record mixes genuine
   deltas, such as a rating losing 2 points to emission, with closing levels, such
   as GDP or a debt limit, and it carries no flag telling the two apart. A blanket
   `+` claimed every level had just risen by its own value. Step rows and headline
   levels now print unsigned, and only overall growth keeps its sign, because
   growth is unambiguously a rate. The sign still drives the colour, so direction
   is not lost.
3. **A percentage-point figure printed as a percentage.**

### Where the economy is persisted

`localStorage`, key `civitas.state.v1`, in the per-country `economics` slot the
T05 writer already owns. `economyToJson` produces that document and
`economyFromJson` reads it back.

T12 added no storage key, no schema field and no migration.
`ECONOMY_SCHEMA_VERSION` is 1, there is no earlier economy document, and
`src/state/migrations.ts` is untouched.

A repairing reader is the reason a damaged field costs one value instead of a
whole economy. When `economyFromJson` repaired something, the panel says so in a
notice at the top. That notice is naturally present only until the first edit: after
it the draft wins, and the repairs have been superseded.

A quota failure on a keystroke renders as the same save notice the other panels
use. It is not fatal, the in-memory state stands, and the next write retries. A
quota failure on End Turn gets error tone instead, because that write is the one
in this panel a player cannot repeat by typing.

`initEconomySync()` drops a draft whose country was deleted. `deleteCountry`
already removes the `economics` slot, but it knows nothing about the draft map. A
stale draft is currently unreachable, because ids are never reused inside a
session and the map is empty after a reload — but "unreachable" there rests on a
counter in another file, and ten lines removes the dependency.

### Formatting

Every number the panel prints goes through `economics-format.ts`, so a readout and
a history row can never disagree about how a percentage looks.

- **`.` for the decimal separator and `,` for thousands.** The spec writes European
  commas and the rest of this package does not. Matching the package wins, because
  two conventions in one app are worse than either one.
- **`groupDigits` from `country-overview.ts` is reused** rather than copied. It
  clamps to non-negative, so `formatObor` splits the sign off first.
- **No `toLocaleString`.** A test asserting `"18,687"` against `toLocaleString`
  asserts whatever ICU data the test runner shipped with.
- **A non-finite value prints an em dash, never `NaN`.** `deriveEconomy` guards
  every value already, so this is defence in depth for a loaded document.

### Tests

**86 tests across the four pure modules**, and the suite as a whole is at 882. The
engine suite is still exactly 203, which is the proof that T12 changed no engine
behaviour.

| File | Tests | What it covers |
|---|---|---|
| `src/ui/economics-fields.test.ts` | 32 | The tag table, the step cap, ledger edits. |
| `src/state/economy-store.test.ts` | 22 | Hydration, write-through, End Turn, judge mode, draft pruning, the persistence round trip. |
| `src/ui/economics-history.test.ts` | 19 | Spec section 19's worked turn, row by row. |
| `src/ui/economics-format.test.ts` | 13 | Every formatter, including the drag sign. |

Two of those deserve naming.

**The classification table is transcribed from the spec and checked against the
rendered panel.** `economics-fields.test.ts` carries spec section 18 as two
tables, 39 `EconomyState` fields and 37 nested fields, giving 76 tagged paths.
Four container fields carry no tag in the spec and are tagged by who may change
their membership, with the clause named in a comment. The tables then drive four
assertions. Every field of a fully populated state must appear in the table, so a
field added later without a tag fails. `fieldAccess` is checked over all 76 paths.
A scanner reads the eleven component sources, finds each field element, pulls its
literal `tag="…"` and the state field its `onCommit` writes, and checks the tag
against the table — 32 elements and 30 committed names, both counts pinned, so a
scanner that silently stopped matching cannot pass. And every `[P]` or `[V]` path
is either rendered by the panel or listed on an explicit omissions table with its
reason, so a field dropped from the sheet fails unless someone removes it
deliberately.

**The persistence round trip runs through a fake storage.** Two countries go out
through `economyToJson` and the T05 writer and come back through a fresh
`initWorldStore`. The rich one sets every remaining field of section 18 away from
its opening value, including a turn record carrying a step with a delta and a
note — seven container levels, one below the depth at which `sanitizeRecord`
truncates. Both come back deep-equal with an empty repair list. A repair would
mean the writer and the reader disagree about the document's own shape.

One expectation in the history tests was wrong and the code was right. A resource
shortage does not raise a warning on its own. Spec section 17 raises one at V18,
when a shortage starves a sector all the way to zero growth. The spec's own worked
example is short on six resources and warns about none, which is what the spec
says it should do.

**There are no `.tsx` unit tests.** The monorepo has no jsdom, so a component test
cannot run at all. The four pure modules carry every test, and the components were
verified in the running app.

### Verified in the browser

`.tsx` files cannot be unit-tested here, so each condition below was checked in the
running app, on a country with seven painted provinces.

| Condition | Result |
|---|---|
| Every `[A]` value updates as a `[P]` value changes | Committing emission 0 → 4 moved FR generated 10,017.00 → 12,017.00 and the inflation drag 0.00 → -0.60 pp on the same commit. |
| A player cannot edit a `[V]` field | All 48 `[V]` fields rendered `disabled`. |
| An `[A]` field is never an input | `label[data-tag="A"] input, label[data-tag="A"] select` matched **0 elements**, with judge mode both off and on. |
| Judge mode unlocks `[V]` and nothing else | Toggling it on unlocked 46 of the 48. The other two were blocked for a stated reason, not by a tag. |
| The step cap blocks an over-large change | Emission committed at 4 with a window of 0 to 10. Typing 30 marked the field invalid, named the window, and snapped back to 4 on blur. Nothing was written. |
| End Turn runs the pipeline and records it readably | Two presses resolved turn 1. The history showed all fifteen steps, four of them marked "no change", with their notes. |
| The economy survives a reload | After a reload: the turn number, emission, rating, control position, all five sector volumes and the turn-1 record were unchanged, and the step window had recentred on the new last value. |
| Judge mode does not survive a reload | After a reload all 48 `[V]` fields were locked again. |

### Known limitations

- **`main.js` now exceeds the 300 KiB advisory limit** at 351 KiB minified, so the
  build's existing asset-size warning gained a fourth entry. It is one advisory
  warning and not an error, and the three asset entries are unchanged. Nothing in
  the panel can be trimmed to get back under the limit.
- **A range input bypasses the 200 ms commit buffer** and writes on every drag
  event. Only the rating score and the control position use one, and both are
  `[V]`, so only a judge can trigger it.
- **`privatizationFrDrag` and `privatizationMicDrag` are not rendered.** The spec
  tags both `[A]`, but they are locals inside `generation.ts` and never reach
  `DerivedEconomy`. Surfacing them needs an engine change, and the engine was
  frozen for T12.
- **A sector's grounds text and a granted concession's sector are shown but not
  editable.** Both are `[V]`. Editing was scoped to the creation control and to a
  concession's `active` toggle.
- **No undo, and no editing a resolved turn.** The history is a record, not a save
  state.
- **No chart, no sparkline and no export.** The history is numbers and text.
- **No dice rolling.** A roll is an input a judge types after throwing it in chat,
  exactly as the rulebook has it. There is no `Math.random` anywhere in the
  package.
