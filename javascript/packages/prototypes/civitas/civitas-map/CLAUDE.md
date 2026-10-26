# Civitas map editor

Paints a province map over a terrain image, groups the provinces into countries,
and exports what a grand-strategy map needs: an indexed-by-colour province PNG, a
JSON manifest describing every province in it, and a countries file. Inspired by
how EU-style province maps are authored.

The editor has two modes, switched in the top bar: `Provinces` paints the
province layer, `Countries` makes countries out of provinces. The sibling package
`../civitas-interactive-map` only displays the result.

Stack: rspack, TypeScript, React, `@preact/signals-react`.

```bash
yarn dev                      # dev server on an OS-picked port, with the maps API
yarn build                    # bundle to dist/
yarn typecheck                # tsc over src/ and e2e/; prints nothing on success
yarn test                     # unit tests: tsx --test over src/ and dev-server/
yarn test:screenshots         # screenshot tests in e2e/, see below
yarn test:screenshots:update  # rewrite the screenshot baselines
```

Run those from this directory, or as `yarn workspace @hw/civitas-map <script>` from
`javascript/`.

## Map library

`Load map…` and `Load provinces…` open a dialog that lists the images in
`assets/maps/`. The list comes from `GET api/maps`. Today the dev server answers
it with `dev-server/maps-api.mjs`; a real backend replaces that module later and
keeps its contract:

```jsonc
// GET api/maps -> 200
{ "images": [{ "name": "map.png", "url": "assets/maps/map.png", "bytes": 2653014, "manifestUrl": null, "countriesUrl": null }] }
```

- The urls are relative to the page. The dev server's static
  handler serves the files themselves at `/assets/maps/<name>`.
- An image whose stem also has a `.json` file beside it gets that file as
  `manifestUrl`, and a `.countries.json` file as `countriesUrl`. That is what
  `Export PNG + JSON` writes, and a `Load provinces…` pick loads all of it.
- `yarn build` has no API. The dialog then shows the failed request and a Retry.
- `src/datasource/map-library/map-library.ts` is the client side. It checks the
  answer field by field.

## Workflow

1. **Load a map** — `Load map…` and pick an image from the map library, or drop a
   png/jpg/webp anywhere on the window.
   To carry on from an earlier session, `Load provinces…` after the map — see
   [Reopening an export](#reopening-an-export). If the map already has its borders
   drawn on it, `Detect borders` in the right menu does steps 2 to 4 for you — see
   [Detecting borders](#detecting-borders-already-drawn-on-the-map).
2. **Outline a province** with the brush. Every province owns one exact RGB, and
   the first one is created for you.
3. **Fill it** with the bucket. The fill spreads through the connected run of
   identical pixels on the province layer and stops at your own strokes — the
   source image has no borders to stop it, so close the outline first.
4. Repeat with `+ New` per province. `Picker` makes the province under the cursor
   active again when you come back to it.
5. **Make countries** — switch to `Countries`, see [Countries](#countries).
6. **Export** — writes `<map>-provinces.png`, `<map>-provinces.json` and, when
   there are countries, `<map>-provinces.countries.json`.

## Controls

| | |
|---|---|
| wheel | zoom at the cursor |
| space + drag, middle drag | pan |
| right drag | provinces: erase, whichever tool is active; countries: take provinces out |
| left drag | countries: put provinces into the active country |
| alt + left drag | countries: take provinces out |
| `B` `G` `E` `I` | provinces: brush, bucket (**g**round fill), eraser, p**i**cker |
| `[` `]` | provinces: brush size |
| `N` | new province, or new country in the countries mode |
| `V` | hide/show the layer |
| `0` `+` `-` | fit, zoom in, zoom out |
| `⌘Z` / `⌘⇧Z` | provinces: undo / redo |

The UI shows no hint line for these. This table is the reference.

## Export format

The PNG is the province layer alone at map resolution, transparent where nothing
is painted. Colours are written bit-exact: brush tips are rasterised as integer
spans rather than filled paths, so no pixel is ever a blend of two provinces and
the image can be read back by colour lookup.

```json
{
  "format": "civitas.province-map",
  "version": 1,
  "map": { "source": "map.png", "width": 5120, "height": 3402 },
  "provinces": [
    {
      "id": 1,
      "name": "Province 1",
      "kind": "land",
      "hex": "#98d7ab",
      "rgb": [152, 215, 171],
      "pixelCount": 844511,
      "bounds": { "x": 2432, "y": 892, "width": 995, "height": 849 },
      "centroid": { "x": 2929, "y": 1316 }
    }
  ],
  "painted": { "pixelCount": 857116, "coverage": 0.049199, "unregisteredColors": [] }
}
```

Geometry is measured from the exported pixels at export time, so it cannot drift
from the image. `centroid` is the centre of mass, which is where a label or a unit
marker belongs — the centre of the bounding box can fall outside a curved
province. `unregisteredColors` lists paint whose province is gone from the
registry; it should stay empty.

## Countries

The `Countries` mode shows each province in the colour of its country. An
unassigned province is shown faintly in its own colour. Every province gets a dark
outline, so single provinces stay visible inside a country.

- The left menu has no cursor modes, no brush and no history. It keeps `Fit` and
  the layer options. The right menu lists the countries: `+ New`, name, colour,
  province count, delete.
- A press on a province puts it into the active country. A drag puts every
  province it crosses there. A province belongs to at most one country, so it
  leaves its old country.
- A stroke that starts on a province of the active country takes provinces out
  instead. The right button or Alt always takes them out. The rule is decided once
  per stroke (`strokeActionFor` in `src/domain/countries/countries.ts`), so
  dragging back over a province does not flip it twice.
- Country changes have no undo. `⌘Z` does nothing in this mode, because the history
  holds province paint, which this mode does not show.
- A new map and `Detect borders` drop all countries. Deleting a province takes it
  out of its country. Deleting a country leaves its provinces unassigned.

The countries file. `../civitas-interactive-map` reads the same file as
`assets/countries.json`:

```json
{
  "format": "civitas.countries",
  "version": 1,
  "countries": [
    { "id": 1, "name": "Aurelia", "colorHex": "#c0563f", "provinceIds": [431, 448] }
  ]
}
```

- `provinceIds` are the ids of the manifest beside it, sorted.
- `slogan` and `flagDataUrl` are optional. The editor does not edit them. It keeps
  them from a loaded file and writes them back unchanged.
- A reader refuses another `format` or `version`. Inside a valid file it skips a
  bad country, an unknown province id, and a province that an earlier country
  already claimed.

## Detecting borders already drawn on the map

`assets/maps/Karta_provintsiy.png` has its province borders painted into the image.
Load it as the base map and press `Detect borders`: the editor reads the borders back
out and fills the province layer, which on that map is 1648 provinces across 50
landmasses, in about a second.

**Land only.** Every province it produces is `land`. Water is never turned into a
province.

It runs in a worker, since it touches every pixel a dozen times over and would
otherwise freeze the editor. Detection replaces the layer and the registry
wholesale, and asks first if there is anything to lose. Thresholds live in
`DEFAULT_OPTIONS` in `src/domain/detect/detect-provinces.ts`; `detectFromBaseMap` takes
overrides, though nothing in the UI passes any yet. The rules live in
`src/domain/detect/`; the worker is `src/datasource/detect/detect-worker.ts`.

Five passes, each answering something a hand-drawn map does:

| Pass | What it does | Why |
|---|---|---|
| water | blue-dominant pixels **that are not dark**, then an opening of radius `riverWidth` | Both halves of that test matter. The border ink on this map is blue-dominant too — `20,25,34`, green minus blue of −9 — so on luminance alone it lands in the water mask, and any stretch of it thicker than the opening survives as "enclosed water". Real water starts at luminance 40 and the ink tops out at 27, so `waterLum` splits them with room to spare. The opening then deletes water thinner than twice the radius, which is what rivers are: water-coloured, but a few pixels wide, and left in the mask they cut their province in half. |
| bodies | connected runs of not-water; a run touching the frame is not land | The scanned paper this map sits on runs off the frame and carries land-coloured speckle that forms clusters of thousands of pixels — no colour or size test separates those from a small island. A framed map has water all round its land, so this one rule drops the whole artifact. |
| seeds | land-coloured pixels inside a body | Border ink is far darker than terrain, so it fails the test and each walled-off area is left as its own component. |
| provinces | connected runs of seeds; runs under `minArea` dropped | Dithering and texture leave specks. Dropping them *before* the watershed matters: a surviving speck seeds a province of its own. |
| watershed | every province expands one pixel per round into the leftovers of its body | Two provinces meet on the centre line of the ink between them, and ink, rivers, dropped specks and dithering go to whoever is nearest. Bounded by the body, so it cannot cross open water. |

Water enclosed by land joins those leftovers, so a lake is shared out between the
provinces around it rather than leaving a hole. Open water is untouched — it reaches
the frame, so it is never enclosed.

Because the ink is no longer mistaken for water, provinces run right up to their
coastline on their own; there is no separate coastal pass.

What it cannot do is invent a border that was never drawn. The southern continent on
that map has no internal borders, only rivers, so it comes back as one province of
312k pixels. The notice reports the largest and median province area, which is how
you spot those: paint the missing borders with the brush and run the bucket, or
split them by hand.

## Reopening an export

`Load provinces…` reads a previous export back in. Pick the provinces PNG in the map
library; a JSON manifest and a countries file with the same name beside it are
loaded with it. Dropping a manifest onto the window, with or without its PNG and
its countries file, imports the whole drop. The base
map has to be open first, since the layer is sized from it — a dropped image on its
own is always taken as a new base map, never as a province layer.

Each half carries what the other cannot: the PNG holds the shapes, the manifest
holds the names, kinds and ids. All parts are read before any is applied, so a
broken manifest or countries file leaves the layer as it was. Without a countries
file the import drops the current countries, because their province ids belong to
the registry that is being replaced.

The rules it applies, all reported in a notice after the import:

- **Size must match the map.** A province image or manifest of another size is
  refused, because every province in it would land somewhere else.
- **Unlisted colours are adopted** as new provinces. Paint the manifest does not
  describe would otherwise export as `unregisteredColors`.
- **Unusable manifest entries are skipped** — no colour, or a colour another entry
  already claimed. Repeated or missing ids are renumbered rather than dropped.
- **Part-transparent pixels are dropped.** A canvas stores pixels premultiplied, so
  reading one back cannot return its original colour — `rgba(192,64,64,200)` comes
  out as `193,64,64` — and a province is identified by an exact colour, so such a
  pixel would invent a province matching no entry. Exports from this editor are
  always fully opaque or fully clear; this only fires on images from elsewhere,
  including anti-aliased province edges.

History is dropped on import: opening a document is not an edit, and the strokes on
the stack belong to pixels that no longer exist.

## Implementation notes

- The province layer (`src/domain/layer/province-layer.ts`) is a pure `Uint32Array`
  of its pixels, the source of truth. It records the rectangle its writes touched.
  The map canvas keeps a canvas copy (`renderer/layer-canvas.ts`) and uploads only
  that rectangle each frame. Hover lookup, flood fill and the export scan read the
  array, so none of them pay for a `getImageData` on a 17-megapixel canvas.
- Undo snapshots the 256px tiles a stroke touched, not the whole layer: a full
  frame of this map is ~70 MB. Depth is 40 strokes.
- The map bitmap and the layer sit in store signals by identity only. They are
  large mutable objects no component renders. Components react to
  `layerRevision` instead.
- The export encodes the PNG from the layer's pixels in
  `src/datasource/downloads/downloads.ts`.

## Not implemented

- No sessions are persisted: a reload starts empty, and the base map has to be
  picked again before its provinces can be reloaded.
- Nothing is uploaded: an export goes to the browser's downloads, not into the
  map library.
- The bucket has no tolerance and ignores the terrain underneath, so coastlines
  have to be traced by hand rather than snapped to. `Detect borders` is the way to
  get provinces off a map that already has borders on it.
- Detection thresholds are not exposed in the UI. They are tuned for a map with
  blue water, green-to-neutral land and dark ink; a map that inverts any of those
  needs the values in `DEFAULT_OPTIONS` changed.

## Architecture

The layers follow `../civitas-interactive-map`:

```
UI --subscribes to--> Store
UI --calls--> Actions --change--> Store
              Actions --call--> Datasource
UI --creates--> Services --subscribe to--> Store
                Services --call--> Actions
```

| Folder | What goes there | Imports from |
|---|---|---|
| `src/ui/` | React components. A component reads the store and calls actions. | services, store, domain, the `TAppRegistry` type |
| `src/services/` | Long-lived objects that own a piece of the DOM outside React. `map-canvas/` owns the map canvas. | store, domain, the `TAppRegistry` type |
| `src/store/` | Signals and computeds only. No function changes state. No function does I/O. | domain, types from datasource |
| `src/actions/` | Every state change. An action is a plain function `(store, ...args)` or `(store, sources, ...args)`. | store, datasource, domain |
| `src/datasource/` | Everything outside the app, one subfolder per system: `map-library/` (`GET api/maps` and the image fetch), `images/` (`createImageBitmap` and canvas reads), `detect/` (the web worker), `downloads/`. | domain |
| `src/domain/` | The editor's rules: colours, brushes, the view math, the province layer, the manifest format, border detection, the province registry rules, countries and the countries file, what a press on the map means. Pure: no signals, no DOM, no I/O. | — |
| `dev-server/` | The stand-in backend: the maps API middleware for the rspack dev server. | — |
| `e2e/` | Screenshot tests. See [Screenshot tests](#screenshot-tests). | — |

- `src/main.tsx` is the composition root. It calls `createStore()`,
  `createDatasources()` and `createRegistry(store, sources)`. It wraps `App` in
  `StoreProvider` and passes `registry` as a prop. There is no `StrictMode`.
- Every folder in the table except `src/ui/`, `dev-server/` and `e2e/` has an
  `index.ts`. Code outside a folder imports from that folder's `index.ts` only.
  Files inside a folder import each other by path and never import their own
  `index.ts`, so no import cycle can form. `src/scaffold.test.ts` checks the
  allowed imports between layers.
- An `index.ts` has no imports. It has one `export { ... } from "./file";` per file
  of its own folder, with inline `type` modifiers and one name per line.
- `src/store/` and `src/actions/` share six area subfolders: `map/` (the open map,
  the layer, the camera), `provinces/` (the registry, hover, import, detection,
  export), `countries/` (the countries, the active country, the stroke), `tools/`
  (the editor mode, the tool, the brush), `status/` (busy flags, error, notice) and
  `library/` (the map library dialog).
- `src/actions/registry.ts` lists every action. A new action goes into
  `storeActions` or `sourceActions` there. Its type is derived from the function.

### UI

- A component reads the store with `useStore()` and calls `useSignals()` at its
  top. The repo has no babel plugin, so a component that skips the call does not
  re-render.
- A component gets actions through a `registry` prop and declares the actions it
  uses as `Pick<TAppRegistry, ...>`.
- `src/ui/pages/editor/` is the one page. It lays out the widgets and owns the
  window-wide input: the keyboard shortcuts (`use-shortcuts.ts`) and the drop of
  local files.
- `src/ui/widgets/` holds `top-bar`, `toolbar` (the left menu), `map-canvas`,
  `province-panel` and `country-panel` (the right menu, by mode), `status-bar` and
  `map-library-dialog`. A widget does not import another widget.

### MapCanvasService

`src/services/map-canvas/` holds the map canvas. The widget renders the host `div`
and two canvases; its one `useEffect` creates the service, calls
`attach(host, { scene, overlay })` and calls `dispose()` on cleanup.

| File | Role |
|---|---|
| `map-canvas-service.ts` | The lifecycle: the input listeners, the ResizeObserver, the space key, the cursor, and the two redraw effects with their requestAnimationFrame scheduling. |
| `input-handler.ts` | Turns pointer and wheel events into registry calls. What a press means is `classifyPress` in `src/domain/interaction/press.ts`. |
| `renderer/render.ts` | The scene pass (base map, the layer or the countries view, bounds) and the preview pass (brush footprint or crosshair). |
| `renderer/layer-canvas.ts` | The canvas copy of the province layer. |
| `renderer/country-canvas.ts` | The countries view. It builds the per-pixel province index (`src/domain/countries/province-index.ts`) once per layer state. A country change repaints only the provinces whose colour changed. |

## Conventions

- `javascript/CLAUDE.md` governs code style.
- Every file and folder under `src/` and `e2e/` is named in kebab-case. Playwright
  names `e2e/editor.spec.ts-snapshots/` itself.
- Dependency versions are exact. No `^`, no `~`.
- Unit tests use Node's built-in runner through `tsx` and sit beside the file they
  test. They cover pure logic and actions; there is no jsdom. A test builds its
  own app with `createTestApp()` from `src/test-support.ts`: a fresh store and
  fake datasources.

## Screenshot tests

`e2e/` holds black-box screenshot tests on `@playwright/test`. They drive the editor
with the mouse, the keyboard, text and ARIA roles only, so a refactor behind the UI
does not break them.

- The backend is mocked at the network level (`e2e/mock-library.ts`): `api/maps`
  and the files under `assets/maps/`. The bundle is the real `src/main.tsx`, built
  in production mode into `e2e/dist/app` by `e2e/rspack.config.mjs`.
- The fixture images are drawn in code (`e2e/fixtures/`): a 360 x 240 map with ink
  borders, a provinces export of it with its manifest and its countries file, and
  an image of another size. No binary fixture is committed.
- Playwright serves the bundle with `python3 -m http.server` on port 47623 and
  stops the server itself.
- The viewport is 1400 x 900 at device scale 1. The baselines live in
  `e2e/editor.spec.ts-snapshots/`. The local Chromium on macOS rendered them;
  another OS renders fonts differently and needs its own baselines.
