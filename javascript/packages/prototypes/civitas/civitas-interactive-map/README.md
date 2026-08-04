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

Traps for later tasks:

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
