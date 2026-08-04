# Civitas Interactive Map — implementation plan

Package: `@hw/civitas-interactive-map`
Root: `javascript/packages/prototypes/civitas/civitas-interactive-map`

## 1. Product

Static web app (no backend). An interactive game map built on a three-part manifest.
Players inspect and edit countries and provinces, and run a country economy sheet
with a real calculator behind it.

## 2. Established facts (verified, do not re-investigate)

### Assets — already present in `assets/`

| File | Facts |
|---|---|
| `map.png` | 3652 x 2855 RGBA. High-detail artistic render. Display layer only. |
| `provinces_map.png` | 3653 x 2855 RGBA. One flat unique colour per province. Pick + border source. |
| `provinces_manifest.json` | 600 KB, 1648 provinces. |
| `country-flag.jpg` | 735 x 490. A single sample flag. |

The two PNGs share a coordinate space (1 px width difference). **Screen -> map pixel
lookup is 1:1, no rescaling.** Treat `provinces_map.png` (3653 x 2855) as the
authoritative map size and letterbox/stretch `map.png` by 1 px.

### Manifest shape (exact)

```jsonc
{
  "format": "civitas.province-map",
  "version": 1,
  "map": { "source": "Karta_provintsiy.png", "width": 3653, "height": 2855 },
  "provinces": [
    {
      "id": 1,
      "name": "Province 1",
      "kind": "land",            // "land" | "sea" | "lake"; all 1648 are "land"
      "hex": "#98d7ab",
      "rgb": [152, 215, 171],
      "pixelCount": 1152,
      "bounds": { "x": 577, "y": 364, "width": 37, "height": 58 },
      "centroid": { "x": 598, "y": 391 }   // centre of mass, NOT bbox centre
    }
  ],
  "painted": { "pixelCount": 2756578, "coverage": 0.264311, "unregisteredColors": [] }
}
```

All 1648 province names are placeholder `"Province N"`. There is **no country data
anywhere** — countries are created by the user inside this app.

### Sibling prototype `../civitas-map`

The province-map *editor* that produced these assets. It is the reference for
rspack config, canvas layering, and the `ProvinceLayer` tile-upload pattern.
**Do not import from it and do not modify it.** Read-only reference.

## 3. Decisions (locked — do not relitigate)

1. **Persistence: `localStorage` only.** No export/import UI. Versioned schema key
   `civitas.state.v1`. Uploaded images are stored as data URLs.
2. **Economics: a full calculator engine.** Real formulas, not stubs. The formula
   spec is authored in T11-A and must be approved by the user before T11-B implements it.
3. **Countries live in their own store**, shaped like a `countries.json` document:
   country id -> `{ name, slogan, lore, flag, provinceIds[], economy }`. Seeded empty;
   the user builds countries in-app.
4. **Province -> country assignment is in scope** (T06). Without it nothing renders
   as a country. This is an addition to the original brief.
5. Stack: rspack + TypeScript + React 19 + `@preact/signals-react`. Canvas 2D, no WebGL.

## 4. Code conventions — MANDATORY

Every implementing agent must read `javascript/CLAUDE.md` before writing any code.
It is **not** auto-loaded into context. Its rules, restated:

- Always terminate statements with `;`.
- Never write single-line `if` / `else` / loops. Always use braces on their own lines.
- Never use single-quoted strings. Double quotes only.
- One grouped named export at the end of each file. No inline `export` keywords
  scattered through the file, no default exports.
- CSS: one declaration per line.

Package conventions, matched to `../civitas-map`:

- `package.json`: name `@hw/civitas-interactive-map`, `"private": true`, `"type": "module"`.
- Yarn 4.1.1 workspace, `node-modules` linker, **exact versions, no `^`**
  (`defaultSemverRangePrefix: ""`).
- Pin to the versions already used by `../civitas-map`: rspack 2.1.4, React 19.2.0,
  `@preact/signals-react` 3.9.0.
- `rspack.config.mjs` with `builtin:swc-loader` (`react.runtime: "automatic"`),
  `HtmlRspackPlugin` on root `index.html`, `css/auto` with `namedExports: false` +
  `camel-case-only`, `devServer.port: 0`.
- `tsconfig.json` standalone (does NOT extend `@hw/typescript-config`): `target ES2020`,
  `lib ES2024/DOM`, `moduleResolution bundler`, `noEmit`, `jsx: "react-jsx"`, `strict`,
  `noUnusedLocals`, `noUnusedParameters`, `include: ["src"]`. No path aliases.
- Entry `src/main.tsx` using `createRoot`, no `StrictMode`. Root `index.html` with
  `<div id="root" class="root">`. `src/env.d.ts` declaring `*.module.css`.
- CSS modules as `*.module.css` next to the component.
- Reactivity is opt-in per component: call `useSignals()` from
  `@preact/signals-react/runtime` at the top of any component that reads signals.
  There is no babel plugin.
- Scripts: `dev`, `build`, `typecheck`. Add `test` (see below).

### Testing

The monorepo has no vitest/jest. Use Node's built-in runner, as
`faenwald-battle` and `colony-sim-v1-core` do:

```json
"test": "tsx --test \"src/**/*.test.ts\""
```

Add `tsx` as a devDependency. Tests sit beside their source as `*.test.ts`.
Test **pure logic only** — manifest parsing, colour indexing, view transform maths,
border extraction on synthetic bitmaps, persistence migration, and above all the
economics calculator. Do not attempt DOM or canvas rendering tests.

## 5. Task list

Each task runs: **think -> implement -> review (loop, max 3) -> tests -> docs**.
Each agent writes `.plan/<task-id>/memory.md` summarising what it did, for the next agent.
The docs agent commits, so every task is independently revertible.

### Phase 1 — foundation

**T01 — Package scaffold**
Create the package skeleton per section 4 and register it in the workspace.
`yarn install` at `javascript/`. Deliver a blank app that boots.
Done when: `yarn typecheck` passes and `yarn build` emits a bundle.

**T02 — Manifest + asset loading**
`src/map/manifest.ts`: types mirroring section 2 exactly, a parser that validates
`format` and `version`, and fails loudly on mismatch.
`src/map/province-index.ts`: decode `provinces_map.png` to a `Uint32Array` once,
build a packed-RGB -> province id lookup (use a `Map<number, number>`; 1648 entries),
and expose `provinceAt(x, y)`. Load `map.png` as an `ImageBitmap`.
Assets are served from the package; wire rspack `asset/resource` or a `public/` copy.
Done when: unit tests prove parsing and colour lookup; a smoke render logs the
province id under a known pixel.

**T03 — Renderer, zoom and pan**
`src/map/view.ts`: pure view transform (scale + translate), screen<->map conversion,
zoom clamped to fit-scale..8x, pan clamped to keep the map on screen, DPR aware.
`src/ui/MapCanvas.tsx`: two stacked canvases (scene + overlay). Wheel zooms toward the
cursor, drag pans, double-click zooms. Disable image smoothing when magnified past 1:1.
Done when: view maths is unit tested; map pans and zooms smoothly at 3653x2855.

**T04 — Border extraction and rendering**
Worker (`src/map/borders.worker.ts`) that scans the province bitmap once and emits
edge pixels where a pixel's province differs from its right or bottom neighbour.
Emit two sets: province borders (any id change) and country borders (country id change,
recomputed when assignments change). Render as an overlay layer, thin for provinces,
thick for countries. Highlight hovered and selected province/country.
Done when: border extraction is unit tested on a small synthetic bitmap; borders align
with the province art at all zoom levels.

### Phase 2 — model, interaction, shell

**T05 — Persistent state store**
`src/state/`: signal-based stores for provinces (name, lore, image), countries, and
economics. Versioned `localStorage` persistence under `civitas.state.v1`, debounced
writes, a migration hook, and graceful recovery from corrupt or oversized payloads
(localStorage caps near 5 MB — data-URL images must be downscaled before storing;
reject and warn rather than throwing).
Done when: round-trip and migration are unit tested.

**T06 — Country model and province assignment**
Country CRUD. An assignment mode where the user paints/clicks provinces into the
selected country. Country colour is derived or user-chosen and tints the map.
Done when: assigning provinces updates country borders and the country layer live.

**T07 — Country labels on the map**
EU-map style country name labels: placed at the country's area-weighted centroid,
letter-spaced small caps, scaled with zoom, hidden when the country is too small to
fit its label at the current zoom, with simple overlap avoidance.
Done when: labels are readable at every zoom level and never overlap illegibly.

**T08 — Selection interaction and the UI shell**
Left click selects a province, right click selects its country (suppress the browser
context menu), hover previews. The EU-style shell: a top country panel showing flag,
name and slogan, and buttons that open the three panels. Panel chrome, theme tokens,
and the shared editable-field components used by T09-T12.
Done when: both selections drive the panels and the shell theme is consistent.

### Phase 3 — panels

**T09 — Country overview panel**
Editable flag (file upload -> downscaled data URL), name, slogan, lore.

**T10 — Provinces overview panel**
The list of provinces in the selected country. Each row has an editable image preview,
name and lore. Must stay responsive with hundreds of rows — virtualise the list.

**T11-A — Economics formula spec (DESIGN ONLY, no code)**
Author `.plan/T11/FORMULA-SPEC.md` covering all 12 sections of the brief: exact
formulas, units, ranges, rounding, and the [P]/[V]/[A] classification of every field.
Cover: GDP as the sum of 5 base sectors plus up to 2 custom ones; per-sector and
overall growth; the 7-tier credit rating (A+ down to F) driving borrowing capacity and
FR income; the 0-100 state control scale; FR and MIC point income; the FR reserve cap
of 2 last incomes and its growth penalty; MIC stockpile upkeep paid in FR; emission %
yielding FR while raising inflation and cutting growth; military spending % yielding
MIC while cutting FR; the emission/military step derived from the control scale
position and enforced as a hard cap; 8 resources with extraction, consumption and
shortage, where a full shortage zeroes dependent-sector growth; debt terms derived
from the credit rating; and the state flags including the once-per-2-years
nationalisation/privatisation 1-10 roll.
**This spec is a gate. It stops for user approval before T11-B runs.**

**T11-B — Economics calculator engine**
Pure, side-effect-free `src/economy/`. Implements the approved spec. No React, no
signals, no DOM. Heavily unit tested — this is the highest-value test target in the
project.

**T12 — Economics panel**
The EU-style sheet rendering all 12 sections. Editability is driven by the tag:
[P] fields are directly editable, [V] fields are locked behind a judge/event action,
[A] fields are read-only and recomputed by the engine. Show the legend.
Done when: every [A] value visibly updates as [P] inputs change.

## 6. Out of scope

- Multiplayer, networking, a backend, and any server-side persistence.
- Turn resolution, orders, and the judge's verdict workflow beyond the flags in T12.
- Editing province geometry. That is `../civitas-map`'s job.
