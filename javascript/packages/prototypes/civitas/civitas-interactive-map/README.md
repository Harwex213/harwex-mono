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
| `src/App.tsx` | Load-status scaffolding. Shows the map facts and a province lookup probe. T03 replaces the body. |
| `src/index.css` | Dark theme tokens, reset, base control styling. Copied from `../civitas-map`. |
| `src/env.d.ts` | Ambient declarations for `*.module.css` and `*.css`. |
| `src/map/manifest.ts` | Manifest types and the strict parser. |
| `src/map/province-index.ts` | Colour packing and the packed-colour to province-id lookup. |
| `src/map/map-assets.ts` | Asset URLs and the three-request load pipeline. |
| `src/state/map-store.ts` | Load-status signals and the app-facing lookup functions. |
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
