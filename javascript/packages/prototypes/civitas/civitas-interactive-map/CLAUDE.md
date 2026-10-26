# Civitas interactive map

An interactive game map for the Civitas province set. It is a static web app with no
backend. It shows the provinces and the countries and lets the player inspect them:
the registration form and the economy of each country.
It edits nothing.

The sibling package `../civitas-map` is the editor that produces the assets,
including the countries. This package only reads them. It never imports from the editor.

Stack: rspack, TypeScript, React 19, `@preact/signals-react`. Rendering is Canvas 2D.

```bash
yarn dev          # dev server on an OS-picked port
yarn build        # bundle to dist/
yarn typecheck    # tsc --noEmit; prints nothing on success
yarn test         # unit tests: tsx --test over src/**/*.test.ts
yarn test:screenshots         # screenshot tests in e2e/, see below
yarn test:screenshots:update  # rewrite the screenshot baselines
```

Run those from this directory, or as `yarn workspace @hw/civitas-interactive-map <script>`
from `javascript/`. The workspace uses the `node-modules` linker and hoists to
`javascript/node_modules`, so this package has no `node_modules` of its own.

## Assets

Six files live in `assets/`. The dev server serves that directory at `/assets`.
The production build copies the same directory to `dist/assets` through
`rspack.CopyRspackPlugin`. Both paths answer the same URLs, so the code requests
`assets/map.png` with no leading slash.

| File | What it is |
|---|---|
| `provinces_map.png` | 3653 x 2855 RGBA. One flat unique colour per province. The pick and border source. |
| `map.png` | 3652 x 2855 RGBA. The artistic render. Display only. |
| `provinces_manifest.json` | 588 KB. Describes all 1648 provinces. |
| `countries.json` | The countries, exported from the editor. See [Countries contract](#countries-contract). |
| `countries-info.json` | The registration form and the economy of each country. Written by hand; today it holds demo numbers. See [Country info contract](#country-info-contract). |
| `country-flag.jpg` | 735 x 490. One sample flag. |

`provinces_map.png` is the authoritative surface. `map.png` is exactly 1 px narrower
and the same height, so screen to map pixel lookup is 1:1 with no rescaling.

No source file under `src/` may import a file from `assets/`. A test enforces this.
The rule keeps the 2.5 MB PNG and the 588 KB manifest out of the bundle.

`loadMap` fetches all five data files at once. A failed fetch of any of them,
`countries.json` and `countries-info.json` included, fails the load.

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
- The manifest holds no country data. The countries live in `countries.json`.

## Countries contract

The editor writes `countries.json`. `parseCountries` in `src/domain/world/countries-file.ts`
reads it.

```jsonc
{
  "format": "civitas.countries",
  "version": 1,
  "countries": [
    {
      "id": 1,
      "name": "Aurelia",
      "colorHex": "#c0563f",
      "provinceIds": [431, 448],
      "slogan": "Gold in the hills",               // optional
      "flagDataUrl": "data:image/svg+xml;base64,…" // optional
    }
  ]
}
```

- The parser throws on any `format` other than `civitas.countries` and any `version`
  other than `1`. The load then fails.
- `id` is an integer from 1 to 65535 and unique. `colorHex` is `#rrggbb`.
  `provinceIds` is a list of positive integers. An entry that breaks one of these
  rules is dropped.
- One province has one owner. The first country that names a province keeps it.
  Later claims are dropped.
- A flag that is not a `data:image/` URL is dropped. The country stays.
- A blank name shows as `"Country <id>"`.
- Every dropped item becomes a repair note. The app joins the notes into one
  dismissible notice at the top of the screen.
- The list order is the panel order.

## Country info contract

`countries-info.json` holds what the country sheet shows: the registration form of
each country (`docs/sources/registration.md`) and the result of its economy
calculator for the current year (`docs/sources/174454458-clm-ekonomicheskaya-sistema.md`).
The app shows the calculator result only. It has no formulas and keeps no history
of years. `parseCountryInfo` in `src/domain/world/country-info-file.ts` reads it.

```jsonc
{
  "format": "civitas.countries-info",
  "version": 1,
  "countries": [
    {
      "countryId": 4,                     // an id from countries.json
      "profile": {
        "capital": "Таллас", "region": "Бэньго", "government": "…",
        "democraticElections": false, "ideology": "…", "religion": "…",
        "history": "…", "culture": "…"
      },
      "economy": {                        // null while the country has no calculator
        "year": 1912,
        "gdp": 84200, "growthPct": 3.4,   // millions of arlings, percent
        "sectors": [{ "kind": "agriculture", "volume": 12600, "growthPct": 1.1 },
                    { "kind": "other", "title": "Приборостроение", "volume": 3400, "growthPct": 7.2 }],
        "creditRating": "A",              // A+ A B C D E F
        "stateControl": 62,               // 0 plan .. 50 neutral .. 100 market
        "emissionPct": 1, "militarySpendingPct": 6,
        "fs": 1240, "vpk": 380, "fsReserve": 600, "vpkStockpile": 150,
        "resources": [{ "title": "Уголь", "balance": 40 }]   // + surplus, − deficit
      }
    }
  ]
}
```

- The parser throws on any `format` other than `civitas.countries-info` and any
  `version` other than `1`. The load then fails.
- An entry with a bad or repeated `countryId` is dropped. A missing profile field
  becomes `""`, and a missing `democraticElections` becomes `false`.
- An economy with a missing number or an unknown rating becomes `null`, so the
  sheet never shows half an economy. A bad sector or resource row is dropped on
  its own. A third `other` sector is dropped: the rules allow two.
- A sector `kind` is one of `agriculture`, `lightIndustry`, `heavyIndustry`,
  `commerce`, `extraction`, `other`. Only `other` uses `title`; the UI names the
  base sectors itself.
- `gdp` is the calculator's figure. The sheet does not sum the sectors to get it.
  A sector's share is its `volume` over the sum of the sector volumes.
- The rating steps come from the rules text. Their exact list is on a picture of
  the calculator that the docs do not include, so it may need a fix.
- A country without an entry, or with `economy: null`, shows a "not filled in"
  line in the sheet.
- Every dropped item becomes a repair note in the same notice as `countries.json`.

## Architecture

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
| `src/services/` | Long-lived objects that own a piece of the DOM outside React. A service gets the store and its registry slice from its creator. | store, domain, the `TAppRegistry` type |
| `src/store/` | Signals and computeds only. No function changes state. No function does I/O. | domain, types from datasource |
| `src/actions/` | Every state change. An action is a plain function `(store, ...args)` or `(store, sources, ...args)`. | store, datasource, domain |
| `src/datasource/` | Everything outside the app, one subfolder per system: `map-assets/` (`fetch` of the PNGs, the manifest and the countries, plus the load steps and `loadProgress`), `borders/` (the web worker), `timers/`. | domain |
| `src/domain/` | The app's rules and vocabulary about the map and the world: the manifest format and its parser, `ProvinceIndex`, the view math, border extraction, label layout, the countries file and its parser, the selection rules. Pure: no signals, no DOM, no I/O. Domain does not know how data is loaded or sent to a worker. | — |
| `e2e/` | Screenshot tests and their own composition root. See [Screenshot tests](#screenshot-tests). | the `index.ts` of each layer |

- `src/main.tsx` is the composition root. It calls `createStore()`, `createDatasources()`
  and `createRegistry(store, sources)`. It wraps `App` in `StoreProvider` and passes
  `registry` as a prop. There is no `StrictMode`.
- Every folder in the table except `src/ui/` and `e2e/` has an `index.ts`. Code
  outside a folder imports from that folder's `index.ts` only. Files inside a folder
  import each other by path and never import their own `index.ts`, so no import cycle
  can form. A test may import its own module directly.
- A layer never re-exports another layer's names. A consumer imports a name from
  the `index.ts` of the layer that owns it. A renamed alias such as
  `type TMyRegistry = TOtherLayerType` counts as a re-export too.
- `src/store/` and `src/actions/` share four area subfolders: `map/` (assets, camera,
  borders), `world/` (the countries), `interaction/` (hover and selection) and
  `labels/`. The actions for the slices in `store/<area>/` live in `actions/<area>/`.
- `src/actions/registry.ts` lists every action. A new action goes into `storeActions`
  or `sourceActions` there. Its type is derived from the function.
- Read-only lookups that need the store (`provinceAt`, `provinceDisplayName`,
  `mapPixelAt`, ...) live in `src/store/selectors.ts`.
- The app saves nothing. It has no storage, no export and no server.
  The countries come from `countries.json` and their info from
  `countries-info.json`. Neither changes after the load.

### UI

- A component reads the store with `useStore()`. It calls `useSignals()` from
  `@preact/signals-react/runtime` at its top. The repo has no babel plugin, so a
  component that skips the call does not re-render.
- A component gets actions through a `registry` prop. It declares the actions it uses
  as `Pick<TAppRegistry, ...>`. Its parent passes the registry down.
- `src/ui/pages/` holds whole screens. A page lays out widgets and owns screen-wide
  input. `pages/map/` is the only page.
- `src/ui/widgets/` holds self-contained blocks of the screen: the map canvas, the
  country panel (a read-only list on the left; a row click selects the country),
  the plaque, and the country sheet (on the right; the form and the economy of the
  selected country in two tabs; its close button clears the selection). The sheet
  is in Russian, like the game texts. Each widget has its own folder with its `.tsx`, its
  `*.module.css` and its small sub-components.
- A page imports widgets. A widget does not import another widget or a page. Code
  that two widgets need goes into a new `src/ui/components/` folder or into
  `src/domain/`.
- `src/ui/theme.css` is the global token sheet.

### MapCanvasService

`src/services/map-canvas/` holds the whole map canvas. React does not draw the map and
does not handle its input. The widget `ui/widgets/map-canvas/map-canvas.tsx` renders
the host `div`, two canvases and the debug HUD. The widget's one `useEffect` creates
the service, calls `attach(host, { scene, overlay })` and calls `dispose()` on cleanup.

| File | Role |
|---|---|
| `map-canvas-service.ts` | The lifecycle. Owns the input listeners, the ResizeObserver, the dpr media query, the signal effects, the requestAnimationFrame scheduling and the host's `data-panning`. `dispose` also disposes the border worker and the tint canvas. |
| `map-canvas-registry.ts` | `TMapCanvasServiceRegistry`, the registry slice the service calls. |
| `interaction-machine.ts` | Pure. The input state machine. States: `idle`, `panning` (`pending` or `dragging`). A left or middle drag pans. A left click selects the province, a right click its country. `transition(state, event)` returns the next state and a list of commands. |
| `input-handler.ts` | Turns each DOM event into a machine event and runs the commands through the registry. It makes no decision of its own. |
| `renderer/frame.ts` | One frame: prepare the canvases, the scene pass, the overlay pass. Reads the store fresh on each frame. |
| `renderer/passes.ts` | The scene pass (art) and the overlay pass (tint, highlights, borders, hairline, labels). |
| `renderer/layers/` | One module per layer: `art-layer`, `tint-layer`, `highlight-layer`, `border-layer`, `label-layer`. |

A new gesture rule goes into `interaction-machine.ts` with a test. A new layer goes
into `renderer/layers/` and gets its slot in `drawOverlay`.

## Conventions

- `javascript/CLAUDE.md` governs code style. Statements end with `;`, `if` and loops
  always use braces, strings use double quotes, each file has one grouped named
  export at its end, and CSS has one declaration per line.
- An `index.ts` is the exception to the grouped export. It has no imports. It has one
  `export { ... } from "./file";` per file of its own folder, with inline `type`
  modifiers and one name per line. `src/scaffold.test.ts` checks both forms.
- A file that imports both values and types from one module uses one import with
  inline `type` modifiers, one name per line, values first. A types-only import
  stays `import type { ... }`.
  ```ts
  import {
    createDatasources,
    type TDatasources,
  } from "./datasources";
  ```
- Every file and folder under `src/` and `e2e/` is named in kebab-case:
  `map-canvas.tsx`, `country-panel.module.css`, `borders-worker.ts`. Playwright names
  `e2e/map.spec.ts-snapshots/` itself.
- CSS modules sit beside their component as `*.module.css`.
- Dependency versions are exact. No `^`, no `~`. They match `../civitas-map`.
- `tsconfig.json` is standalone and does not extend `@hw/typescript-config`. It sets
  `strict`, `noUnusedLocals` and `noUnusedParameters`. There are no path aliases.
- Unit tests use Node's built-in runner through `tsx` and sit beside the file they
  test. They cover pure logic only. There is no jsdom, so unit tests do not touch the
  DOM or the canvas. The screenshot tests cover the DOM and the canvas.
- A test builds its own app with `createTestApp()` from `src/test-support.ts`. The app
  has a fresh store, fake timers and a fake border worker. `setCountries()` puts
  countries into the store as a finished load would.

## Screenshot tests

`e2e/` holds black-box screenshot tests on `@playwright/test`. The tests drive the app
with the mouse and the keyboard only. So the tests survive refactors of the code
behind the map. `yarn test:screenshots` builds `e2e/dist/app` and compares it against
the baselines. `yarn test:screenshots:update` rewrites the baselines after a deliberate
visual change.

- The tests serve `assets/countries.json` and `assets/countries-info.json` through
  `page.route`: the countries from `e2e/fixture.ts` (Aurelia, Borealis, Calderra,
  with slogans and flags), an empty list, or a damaged file. In the info fixture
  Aurelia has a full form and an economy, Borealis a form without an economy, and
  Calderra no entry. The other assets and the border worker stay real.
- `e2e/main.tsx` is a second composition root. It mirrors `src/main.tsx`.
- `e2e/main.tsx` sets `window.__civitasE2E.ready()`. The tests wait on this call
  instead of a timeout.
- `e2e/rspack.config.mjs` extends the app config and writes to `e2e/dist/app`. So
  `yarn build` and `yarn dev` stay untouched.
- Playwright serves the bundle with `python3 -m http.server` on port 47613 and stops
  the server itself.
- The viewport is 1400 x 900 at device scale 1. The debug HUD is masked.
- The baselines live in `e2e/map.spec.ts-snapshots/` and are committed. The local
  Chromium on macOS rendered them. Another OS renders fonts differently and needs its
  own baselines.
