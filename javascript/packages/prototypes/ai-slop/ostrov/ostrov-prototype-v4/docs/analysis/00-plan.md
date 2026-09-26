# Toxic Island — prototype v4 implementation plan

Package: `javascript/packages/prototypes/ai-slop/ostrov/ostrov-prototype-v4`, name `@hw/ostrov-prototype-v4`.
Spec: `docs/01-spec.json` (whiteboard node/edge graph, Russian) + `docs/01-spec-images/`.
Everything below is what an implementer gets. Read the spec JSON too; this plan does not repeat the yield tables.

---

## 1. Findings

### 1.1 Repository rules

`javascript/CLAUDE.md` (mandatory, applies to every file we write):

- Always end statements with `;`.
- No single-line `if` / `else` / loop: always braces, body on its own line.
- No single-quote string literals. Double quotes only.
- One grouped named export at the end of the file (`export { a, b };`). Private helpers stay unexported.
  Type exports are written inline as `export type { T };` at the end too (see the lab `registry.ts`).
- CSS: one declaration per line, closing brace on its own line. Everywhere CSS lives.
- Default frontend stack: react + rspack + typescript + preact/signals.
- Default architecture: `@hw/frontend-plain-architecture-v2` at `javascript/packages/lab/frontend-plain-architecture`.
- `yarn :static` is a global script: `yarn http-server $INIT_CWD -p 0 -c-1`, random free port.

Additional conventions from `javascript/packages/projects/harwex-notes/harwex-notes-frontend/CLAUDE.md`, the fullest
written version of the same architecture: type names start with `T` and factories with `create`; `import type` for
type-only imports, listed after value imports; magic numbers become named constants carrying the unit
(`INSANE_DELAY_MS`); inside actions read with `.peek()` and write with `.value =`, because reading `.value` in an
action is a bug; in components call `useSignals()` first and then read `.value` in render, never `.peek()`; a
component declares only the registry slice it needs as a local type and types its `registry` prop with it; signal
contents are immutable and get replaced whole; JSX text is an expression (`{"Click me"}`); styling is one plain CSS
file with BEM-ish class names and design tokens as CSS variables on `:root`.

### 1.2 `setup-tsconfig` skill

File: `.claude/skills/setup-tsconfig/SKILL.md` (worktree-local; there is no copy in `~/.claude/skills/`).
Presets live in `javascript/packages/infrastructure/typescript-config` (`@hw/typescript-config`).
For a React frontend the prescribed recipe is exactly:

```json
{
  "extends": "@hw/typescript-config/react.json",
  "include": [
    "./src/**/*"
  ]
}
```

Plus, in `package.json`: `"@hw/typescript-config": "workspace:*"` and `"@types/react"` / `"@types/react-dom"`
in devDependencies, `"type": "module"`, and `"typecheck": "tsc --noEmit"` with `typescript` in the package.

Traps the skill names: `base.json` does not set `noEmit`, so a bare `tsc` writes `.js` next to the sources —
every ostrov package therefore adds `"compilerOptions": { "noEmit": true }`. `include` is required, because the
inherited `exclude` resolves against the preset package. A local `files` key would replace the inherited one.
Verify with `node_modules/.bin/tsc --noEmit -p packages/<path>/tsconfig.json` run from `javascript/`.

### 1.3 The architecture package

`javascript/packages/lab/frontend-plain-architecture`, name `@hw/frontend-plain-architecture-v2`, version 1.0.0.

- It has **no `exports`, no `main`, no `build` script and no README**. It is a runnable 12-file counter demo,
  not a library. Nothing in the monorepo depends on it, and nothing can. **Copy the pattern, do not depend on it.**
  Its two defects: `"typecheck"` references a `tsconfig.tests.json` that does not exist, and its rspack hardcodes
  `port: 8130`. Do not carry either over.
- Layout: `src/main.tsx`, `src/store/store.ts`, `src/domain/registry.ts`, `src/domain/registry-creator.ts`,
  `src/domain/<slice>-state.ts`, `src/ui/app.tsx`, `src/ui/components/*.tsx`. Wiring: `main.tsx` → `createStore()`
  → `createRegistry(store)` → `<StoreProvider value={store}><App registry={…}/>`. `StoreProvider` is literally the
  React context object; `useStore()` is `useContext(StoreProvider)`. `registry-creator.ts` binds every action with
  `newRegistry[name] = func.bind(null, store);`. `registry.ts` hand-writes `TAppRegistry` — the public contract of
  the domain layer, never inferred.
- There is **no routing layer and no router dependency anywhere in the monorepo.**

### 1.4 Sibling prototypes

All under `javascript/packages/prototypes/ai-slop/ostrov/`.

| package | last commit | src files | what it is | rendering | notable |
| --- | --- | --- | --- | --- | --- |
| `ostrov-prototype-v1` | 2026-08-22 | 33 | real-time tower-defence island builder, 5×4 sectors of 10×10 square cells, sea waves, boss | canvas 2D | no hex grid |
| `ostrov-prototype-v2` | 2026-08-22 | 52 | real-time hex-island city builder + walking-crate logistics, fog of war, minimap, camera inertia | canvas 2D + a WebGL cloud shader | richest renderer; hex math in `src/hex/` |
| `ostrov-prototype-v2-config` | 2026-08-22 | 12 | balance/config editor for v2, hash router, `GET/POST /api/config` dev-server middleware | canvas 2D graph | the only hash router in the set |
| `ostrov-prototype-v3` | **2026-09-07** | **104** | 5-package sub-monorepo; `ostrov-game-prototype-1` is a co-op PVE TBS with factions, deposit economy, shared tech tree, island engine and an **auto-battler with pre-battle deployment** | inline SVG | has `docs/gdd.md`, `smoke` + `probe` tsx scripts, the only ostrov `CLAUDE.md` |
| `ostrov-prototype-v5` | — | 0 | **empty directory** | — | — |
| `tbs-ostrov-prototype-3` | 2026-08-29 | 23 | turn-based floating islands on a sky hex grid, click-to-move anchors, AI opponents | inline SVG | `moveIsland(world, islandId, anchor)` |
| `tbs-ostrov-prototype-4` | 2026-08-29 | 37 | turn-based hex campaign: noise world gen, armies, fog, enemy AI turn, event log | canvas 2D | pointer→axial hit testing |
| `tbs-ostrov-prototype-6` | 2026-08-29 | 28 | **dedicated auto-battler**: hex arena radius 4, shop, squad placement, round simulation | canvas 2D | `src/domain/battle/simulation.ts` |
| `tbs-ostrov-prototype-7` | 2026-08-29 | 15 | tech tree as a snowflake on a pan+zoom canvas | canvas 2D | cleanest architecture-conformant leaf app |

What the set does **not** contain, verified: no three.js, no 3D globe, no WASD steering, no bezier resource-flight
animation (bezier appears only as static art path drawing), no Playwright, no headless Chrome, no
`python3 -m http.server`, no `window.__*` dev hook, and **no eslint config in any ostrov package**.

Scripts inventory: only `ostrov-prototype-v3/ostrov-world-system/scripts/smoke.ts` and
`ostrov-prototype-v3/ostrov-game-prototype-1/scripts/{smoke,battle-probe}.ts` — pure Node through `tsx` 4.20.6,
no browser, no port. They print `PASS`/`FAIL` and exit non-zero on failure.

`CLAUDE.md` files inside the ostrov tree — there is exactly one, and this is it verbatim
(`ostrov-prototype-v3/CLAUDE.md`):

> The world system does its own rendering, so `ostrov-island-system` no longer exports its hex layout helpers or `coastlinePath`.

Neighbouring `ai-slop` packages carry trap lists worth obeying. `2d-shading/CLAUDE.md`, verbatim rules:

> - **Демо возвращает teardown и в нём убирает всё своё** — pixi-приложение, тикер, DOM. Роутер
>   других ручек не держит; забытый `app.destroy` = второй render-loop поверх первого.
> - **Сцена одна на все демо** (`lib/scene.ts`, фиксированный сид). Техники сравнивают между собой,
>   а не разные карты.
> - **Новая техника = файл в `demos/` + запись в `registry.ts`.** Навигация из реестра строится сама.

`fantasy-map-light/CLAUDE.md` is the only prior art for canvas zoom and pan, and it names the exact contract:

> `coordinates.ts` — контракт экран↔карта: `CanvasTransform`, `fitTransform` (contain-центрирование),
> `screenToMap`/`mapToScreen`, `isInsideMap`, `clampTransform` (пределы масштаба + карта не «улетает»),
> `zoomAt` (зум вокруг курсора: точка под курсором остаётся на месте).
> … зум по `Ctrl/Cmd+Wheel` (нативный listener `passive:false`).
> **Зум только отображение:** `zoomAt`/`clampTransform` меняют лишь `transform` (масштаб/сдвиг),
> буфер не трогается; `imageSmoothingEnabled=false` → пиксели чёткие.

### 1.5 Workspaces

- **There is no `package.json` at the repo root.** The JS workspace root is `javascript/`, package name
  `to-the-frontend-moon`.
- `"workspaces": { "packages": ["packages/**/*"] }` — a new package under
  `packages/prototypes/ai-slop/ostrov/` is picked up automatically. No glob edit is needed.
- `"packageManager": "yarn@4.1.1"`; the local binary reports `yarn 4.17.1`. `javascript/.yarnrc.yml` sets
  `nodeLinker: node-modules`, `defaultSemverRangePrefix: ""` (**write exact versions, never `^`**),
  `enableTransparentWorkspaces: false` (**`workspace:*` must be written explicitly**),
  `yarnPath: .yarn/releases/yarn-4.1.1.cjs`.
- `resolutions` pins only `@types/react` 19.2.0, `@types/react-dom` 19.2.0, `@types/pixi.js` 5.0.0.
  React itself is aligned by hand: everyone writes `"react": "19.2.0"`.
- Commands, all with cwd inside `javascript/`:
  `yarn` (install), `yarn workspace @hw/ostrov-prototype-v4 dev|build|typecheck|probe`,
  `yarn force` (= `yarn :rr **/node_modules && yarn`).
  There is no aggregate root typecheck/build script and no turbo/nx.

### 1.6 Libraries already in `javascript/yarn.lock`

| library | present | version |
| --- | --- | --- |
| `three` | yes | `0.185.1` |
| `@types/three` | yes | `0.185.4` |
| `@react-three/fiber`, `@react-three/drei` | **no** | — |
| `honeycomb-grid` or any hex library | **no** | hex math is hand-rolled everywhere |
| `react`, `react-dom` | yes | `19.2.0` |
| `@preact/signals-react` | yes | `3.9.0` (what every ostrov package uses) |
| `preact`, `@preact/signals` | yes | `10.29.7`, `2.9.4` |
| `playwright`, `playwright-core` | yes | `1.61.1` |
| `@playwright/test` | **no** | the one consumer uses the raw `chromium` API |
| `@rspack/core`, `@rspack/cli` | yes | `2.1.4` |
| `@rspack/dev-server` | yes | `2.1.0` |
| `typescript` | yes | `5.9.3` |
| `tsx` | yes | `4.20.6` |
| `pixi.js` | yes | `8.8.0` (not needed here) |
| `gsap`, `framer-motion`, `motion` | **no** | animate by hand with `requestAnimationFrame` |

Playwright: `javascript/node_modules/playwright-core/browsers.json` declares chromium revision **1228**
(browserVersion 149.0.7827.55) and `~/Library/Caches/ms-playwright/` holds `chromium-1228` and
`chromium_headless_shell-1228` only. **Pin `"playwright": "1.61.1"` and launch `chromium`**; anything else
triggers a browser download, and firefox/webkit are not installed. The existing usage pattern is
`javascript/packages/infrastructure/excalidraw-convert/src/renderer.ts`: `import { chromium } from "playwright"`,
`chromium.launch({ headless: true })`.

### 1.7 The spec images

Every image, with what it actually shows (the whiteboard labels are sloppy — trust this list):

- `01-spec-image-1.png` — **hex island reference.** Top-down 3/4 view of a floating island of ~6 pointy-top hexes,
  each hex a distinct biome (desert sand, mesa rocks, stone platform). A bright green outline traces the island
  border; small green markers dot the terrain. Buildings sit centred on their hex. Confirms: one building per hex,
  hexes visually distinct by biome, a glowing ownership outline around the island.
- `01-spec-image-2.png` — **end-turn reference.** A large circular medallion on a dark blue field, banner above
  reading "Ready", four quadrant glyphs (hammer, skull, sword, wheat) split by an X, ornate scrollwork frame.
  This is the end-turn button.
- `01-spec-image-3.png` — **player list reference.** Four stacked rows. Each row: a coloured pennant on the left,
  the nickname in that colour ("Mom010", "Carribean Sorcerer", "Blue Sorcerer", "Orange Sorcerer"), a right-side
  status icon (hourglass + house = the human, still thinking; a chip icon = AI), and three counters underneath:
  `3 ⚔`, `10 🛡`, `16 🏆`.
- `01-spec-image-4.png` — **buildings panel reference.** A framed brown panel holding a 5×3 grid of square icon
  buttons (house, scales, workshop, field, fish, log, tree, jug+apple, timber cross, well, hedge, a greyed-out
  disabled one, market hall, golden statue, pool). Confirms: fixed grid of building cards, a disabled/greyed state.
- `01-spec-image-5.png` — **demolish and technology icons.** A narrow gold-framed vertical strip with two square
  slots: a pickaxe on top (demolish) and a purple potion flask below (technologies).
- `01-spec-image-6.png` — **resources panel reference** (the node calls it an island reference; it is not). A dark
  rounded panel with ten labelled counters in three columns: `69.9 Еда`, `28 Камень`, `0 Дерево`, `14 Население`,
  `3 Молотки`, `0 Наука`, `4 Разведка`, `4 Мана`, `5.4 Токсичность` (green), `0 Сумасшедшие` (pink). Confirms:
  fractional values are shown to one decimal, toxicity is green, insane population is pink.
- `01-spec-image-7.png` — **farm (ферма).** Isometric steampunk art on transparent background: stone farmhouse with
  a green glass greenhouse, a brass boiler with a glowing green gauge, a wooden silo, a hay barn, cabbage beds
  behind a fence, all on a round rocky base.
- `01-spec-image-8.png` — **mine (рудник).** A rocky hill with a timber headframe and pulley over a mine adit, ore
  carts on rails, crates of gold ore, green crystals in the rock, a brass boiler with a green gauge.
- `01-spec-image-9.png` — **sawmill (лесопилка).** A mill with a water wheel and falling water, a big circular saw
  under a timber roof, stacked logs and cut planks, a brass boiler with a green gauge.
- `01-spec-image-10.png` — **village (деревня).** A cluster of eight or so half-timbered houses with green roofs
  around a cobbled square, a market stall, a well, a small bridge over a waterfall, vegetable plots.
- `01-spec-image-11.png` — **world reference.** A 3D planet in starfield space, captioned "Select starting site",
  with hundreds of small settlement icons scattered over continents and an ocean label ("Sharpseal Ocean"). This is
  the target look of the exploration page: an orbitable sphere with per-cell markers.
- `01-spec-image-12.png` — **masons guild (гильдия масонов).** A stone hall with a masonic compass-and-square in the
  gable, blue banners, a crane hoisting a block, cut stone blocks, columns, trestle tables, a plan scroll.
- `01-spec-image-13.png` — **observatory (обсерватория).** A stone rotunda with a copper dome split open around a
  huge brass telescope with a green lens, a globe on a side tower, armillary spheres, star-carved standing stones.
- `01-spec-image-14.png` — **university (университет).** A cathedral-scale complex: library wing with tall windows
  and bookshelves, a clock tower topped by a green orb, purple book banners, an alchemy wing with coloured flasks,
  a greenhouse, a fountain and an armillary sphere in the courtyard.
- `01-spec-schema-1.svg` — **island page wireframe** (excalidraw, 1016×580). Exact geometry:
  - dashed viewport frame at (10,10)–(1006,570);
  - "Список игроков" — top left, x≈20 y≈19, 164×166;
  - "Ход" — top centre, x≈440 y≈19, 106×39, a small pill;
  - "Hero Object страницы - island canvas с pan & zoom, на котором изображены гексы летающего острова" — centred
    label at ≈(493,282), i.e. the canvas fills the whole page behind the panels;
  - "ресурсы" — bottom left, x≈20 y≈437, 228×122;
  - "иконка снести" — x≈296 y≈437, 101×54;
  - "иконка технологий" — x≈296 y≈502, 100×57 (directly under the demolish icon);
  - "панель построек" — x≈408 y≈437, 378×122;
  - "окончание хода" — bottom right, x≈892 y≈437, 101×122.

  The spec has wireframe nodes for the main menu, global map and battle pages too, but no image is attached to
  any of them. Those three layouts are ours to design.

---

## 2. Template choice

**Copy config from `tbs-ostrov-prototype-7`.** It is the cleanest architecture-conformant leaf app: flat
`src/main.tsx` entry, the six-line tsconfig the skill mandates, the canonical rspack with `port: 0` and a comment
explaining why, and a canvas 2D pan+zoom component that is almost exactly our island canvas. `ostrov-prototype-v3`
is newer and far more complete as a *game*, but its configs assume a lib+app split (`./src/app/main.tsx`,
`exports.ts` in `include`) that we do not want. Do **not** copy from the lab package; its two defects are listed
in §1.3.

Files to copy and what to change:

| copy from tbs-7 | change |
| --- | --- |
| `package.json` | `name` → `@hw/ostrov-prototype-v4`. Add `"description"`. Add `"three": "0.185.1"` to dependencies. Add `"@types/three": "0.185.4"`, `"playwright": "1.61.1"`, `"tsx": "4.20.6"` to devDependencies. Add scripts `"probe": "tsx scripts/probe.ts"` and `"serve": "python3 -m http.server 8401 --directory dist"`. Keep every existing version string exact, no `^`. |
| `tsconfig.json` | copy unchanged (`extends @hw/typescript-config/react.json`, `noEmit: true`, `include ["./src/**/*"]`). Add `"./scripts/**/*"` to `include` only if the probe needs typechecking; otherwise leave the probe out and keep `include` as is. |
| `rspack.config.mjs` | keep entry `./src/main.tsx`, keep `devServer.port: 0` **with its comment**. Add one rule: `{ test: /\.(png\|jpe?g\|webp\|svg)$/i, type: "asset/resource" }`. |
| `index.html` | `<title>` → `Toxic Island`, keep `lang="ru"` and `<div id="root"></div>`. |
| `src/main.tsx` | copy character-for-character, then add the dev-hook install line (§4.7). |
| `src/store/store.ts`, `src/domain/registry.ts`, `src/domain/registry-creator.ts` | copy the shape, replace the contents. |

No eslint. No ostrov package has one, and adding `@hw/eslint-config` is out of scope for a prototype.

---

## 3. Game design decisions

### 3.1 Insane population (🤖) — the mechanic the spec asks us to invent

Toxicity is tracked per hex as an integer 0–100 (a percentage of that hex being dead). The island's
`toxicityPoints` is the sum over hexes; `toxicityPercent` is the mean over non-empty hexes.

Output scaling, from the spec (`50-100` node):

- a building's yield is `floor(base * (1 - hexToxicity / 100))`, minimum 0;
- at `hexToxicity >= 50` a farm produces **0 🍗** regardless of the formula;
- at `hexToxicity >= 100` the hex is dead: it produces nothing, cannot be built on, and is drawn grey.

Conversion, run once per tax phase, exactly `350 ms` after the last resource lands:

```
newInsane = min(floor(islandToxicityPoints / 10), population)
population -= newInsane
insane     += newInsane
```

What 🤖 does:

1. **Eats.** A 🧍 eats 1 🍗 per turn, a 🤖 eats 2 🍗. Upkeep is subtracted right after the conversion.
2. **Starves.** If food would go negative, the deficit `d = -food` is resolved as: `food = 0`,
   `population -= floor(d / 2)`, `insane += floor(d / 5)`.
3. **Drags output down.** ⚒️, 📖 and 🔭 gained next tax phase are multiplied by `max(0.5, 1 - 0.02 * insane)`.
4. **Riots.** At the end of the tax phase, if `insane > population / 2`, a riot fires with chance
   `min(80, round(insane / max(1, population) * 100) - 50)` percent. A riot destroys the building on one random
   built hex and adds `+5` toxicity to that hex. The riot is logged and shown in the event modal.
5. **Feeds phase 4.** Every riot queues one hostile "мародёр" unit that spawns on the player's own island in the
   next clearing phase.

Cure: an action on the resources panel, "Успокоить", costs `3 💠 + 2 🍗` and converts `1 🤖 → 1 🧍`, at most 5
uses per turn. With the `asylum` tech it converts 3 per use and costs `2 💠`.

Mana has no producer in the spec, so: `mana += 1 + floor(science / 10)` each tax phase.

### 3.2 The blank interaction sections

**Buildings panel** (bottom centre, 378×122 in the wireframe; reference `01-spec-image-4.png`). A single row of
seven cards. Each card shows the building art thumbnail, its name, and its cost in 🪨🪵⚒️.

- Clicking a card **arms** it. The island canvas then highlights every legal hex (biome listed in that building's
  table, hex empty, hex toxicity < 100) with a green pulse and dims the rest.
- Clicking a highlighted hex places the building, deducts the cost, and disarms the card.
- Clicking the armed card again, pressing `Esc`, or right-clicking disarms it.
- A card the player cannot afford is greyed, the missing resource shown in red. It can still be armed to preview
  legal hexes; placement is refused with a shake and a toast.
- Hovering a card opens a tooltip with that building's full per-biome yield table from the spec.

**Demolish icon** (pickaxe, `01-spec-image-5.png` top slot). Toggles demolish mode; the canvas tints own hexes red.

- Click a hex **with** a building → the building is removed, 50% of its 🪨 and 🪵 are refunded (floored), the hex
  keeps its toxicity.
- Click a hex **without** a building → the hex itself is destroyed, which is the core-loop's
  "уменьшении токсичности через уничтожение других гексов": the hex leaves the island, its toxicity points leave
  the island total, its neighbours become coast. Cost `2 ⚒️`, or `1 ⚒️` if the hex is already at 100 toxicity.
- The island may never drop below 7 hexes; below that, demolition is refused.
- `Esc` or a second click on the icon leaves the mode.

**Technologies icon** (purple flask, `01-spec-image-5.png` bottom slot). Opens a full-screen modal with the tech
list as cards plus prerequisite arrows. One tech is "in research" at a time; each tax phase adds the turn's 📖 to
it; it completes when the accumulated 📖 reaches its cost. Clicking an available tech sets it as the target;
clicking it again cancels, and the accumulated 📖 stays on that tech. `Esc` or the X closes the modal.

**End-turn panel** (bottom right; reference `01-spec-image-2.png`). One round medallion button, the only
phase-advance control. Its label follows the phase: `Собрать налоги` (build → tax), `В разведку` (tax →
exploration), `Зачистка` (exploration → clearing), `Следующий ход` (clearing → build of turn N+1). It is disabled
while an animation or a battle runs. `Space` and `Enter` are bound to it. The turn number and the phase name live
in the "Ход" pill at the top centre.

### 3.3 Tech tree (8 techs)

| id | name | 📖 | requires | effect |
| --- | --- | --- | --- | --- |
| `irrigation` | Ирригация | 20 | — | every farm `+1 🍗` |
| `scrubbers` | Скрубберы | 30 | — | every building produces `1` less ☣️ (floor 0) |
| `deep_shafts` | Глубокие шахты | 30 | `scrubbers` | every mine `+2 🪨`, `+1 ☣️` |
| `star_charts` | Звёздные карты | 35 | — | every observatory `+1 🔭`; global-map reveal costs `1 🔭` instead of `2` |
| `asylum` | Лечебница | 40 | `irrigation` | "Успокоить" cures 3 🤖 per use and costs `2 💠` |
| `conscription` | Рекрутский набор | 45 | `irrigation` | every village also yields 1 militia per turn; battle units `+10` HP |
| `levitation` | Левитация | 60 | `star_charts` | the island moves 2 global cells per turn instead of 1 |
| `purge_ritual` | Ритуал очищения | 80 | `asylum`, `scrubbers` | an action: spend `5 💠` to remove `20 ☣️` from one hex |

### 3.4 Turn structure and the AI players

Four players. `p1` is the human, nickname editable in the main menu, default `Игрок`. `p2`–`p4` are
`Carribean Sorcerer`, `Blue Sorcerer`, `Orange Sorcerer`, straight from `01-spec-image-3.png`, with the pennant
colours from that image (teal, blue, orange; the human gets green).

The AI players exist **only as rows in the player list**. They take no turn. On each end-turn their three
displayed counters advance by a seeded rule: `army += rng(0..2)`, `buildings += rng(0..1)`,
`techs += 1` every 4th turn. Clicking a row opens that player's island page in readonly mode: per spec node-58 the
buildings panel, the demolish icon, the technologies icon and the resources panel all disappear; the player list,
the turn pill, the island canvas and a back button remain. Their islands are generated from the same generator
with a different seed and never change.

The four phases run in a fixed order per turn: `build → tax → exploration → clearing → build(N+1)`. The build and
tax phases live on the island page, exploration on the world page, clearing on the battle page. Navigation between
phases is automatic on end-turn; the player may still navigate freely between pages by hand, but the end-turn
button only advances the current phase.

### 3.5 Building costs (the spec gives yields, not costs — these are ours)

| building | 🪨 | 🪵 | ⚒️ |
| --- | --- | --- | --- |
| ферма / farm | 0 | 10 | 1 |
| лесопилка / sawmill | 5 | 5 | 1 |
| рудник / mine | 10 | 10 | 2 |
| деревня / village | 10 | 15 | 2 |
| гильдия масонов / masons guild | 20 | 10 | 3 |
| обсерватория / observatory | 15 | 20 | 4 |
| университет / university | 25 | 25 | 5 |

Demolishing a building refunds 50% of 🪨 and 🪵, floored, and no ⚒️. Starting resources:
`🍗 20, 🪨 30, 🪵 30, 🧍 6, ⚒️ 5, 📖 0, 🔭 4, 💠 2, ☣️ 0, 🤖 0`.

### 3.6 Toxic trail events

At the start of the exploration phase the island's total toxicity is added to the `trail` of the cell it stands on
(spec node-51). Then, if that cell's `trail > 0`, an event rolls with chance `min(60, trail * 2)` percent —
doubled when the island has just flown into an unrevealed cell. Roll d100:

| d100 | event | effect |
| --- | --- | --- |
| 1–30 | Налёт бандитов | lose 10% of 🍗 and 10% of 🪨, floored, at least 1 of each you hold |
| 31–55 | Налёт нечисти | 2 extra enemy units spawn in the next clearing phase |
| 56–80 | Прирост сумасшедших | `+3 🤖` immediately, converted out of 🧍 |
| 81–95 | Мусорный червь | one random built hex takes `+15 ☣️`; if it was already at 85 or more, its building is destroyed |
| 96–100 | Пустой шлейф | nothing happens and the cell loses 5 trail |

Every event is appended to the log and shown in a modal on the exploration page.

### 3.7 Exploration phase

The global map is a sphere of hexes (spec node `3d`, reference `01-spec-image-11.png`). Build it as the dual of a
subdivided icosahedron: subdivision level 3 gives 92 cells — 12 pentagons and 80 hexagons. Each cell carries
`revealed`, `biomeHint`, `trail`, `occupant`.

- Revealing an unrevealed neighbour costs `2 🔭` (`1` with `star_charts`).
- Moving to a revealed neighbour flies the island there and adds nothing to the trail.
- Moving to an **unrevealed** neighbour is allowed — "лететь в них на свой страх и риск" — and doubles the event
  chance on arrival.
- Staying puts the island's whole toxicity into the current cell's trail.
- Camera: drag to orbit, wheel to dolly. Picking is a three.js `Raycaster` against the cell meshes.

### 3.8 Clearing phase (phase 4)

2D top-down canvas, **not** three.js. World 1600×1200 px, camera follows the player island.

- The player island is drawn as its hex footprint and moves on `WASD` at `120 px/s`. No rotation.
- 2 to 4 enemy islands are placed at random, at least 400 px apart.
- Player units: one `ополченец` per village, plus `conscription` extras. Units wander inside their island's
  footprint and walk toward the nearest enemy island when the gap drops under `200 px` (spec node-24).
- Unit stats, `HP / DMG / RANGE px / SPEED px·s⁻¹`:
  - melee — ополченец `20/3/12/40`, копейщик `28/5/16/38`, мечник `36/7/12/42`, алебардист `44/9/18/36`,
    рыцарь `60/11/12/55`;
  - ranged — пращник `16/3/70/40`, лучник `20/4/90/40`, длинный лучник `24/6/120/36`, мушкетёр `28/9/100/34`;
  - cavalry — the spec repeats the ranged names, so treat cavalry as mounted variants of those four: `+25%` HP,
    `+50%` speed, same damage and range;
  - air — ворона `14/2/12/70`, великий орёл `30/6/14/80`, грифон `45/9/16/75`;
  - enemies — волк `18/4/12/60`, паук `16/5/14/45`, пиявка `12/3/10/30`, скелет `24/5/12/38`, зомби `30/4/12/26`,
    огр `70/12/16/28`, ведьма `26/7/90/34`, вампир `50/10/14/50`, моль (air) `14/3/12/65`,
    летучая мышь (air) `12/2/10/70`.
- Auto-battle tick every `100 ms`: each unit attacks the nearest hostile within `range`, otherwise steps
  `speed * dt` toward the nearest hostile within `250 px`, otherwise wanders. No pathfinding, no unit collision.
- Enemies get stronger over time (spec node-26): `3 + floor(turn / 2)` enemies per island, capped at 12, and
  `+10%` HP per 5 turns elapsed.
- **Absorption**: when the player island's footprint overlaps an enemy island's footprint and that island has no
  live enemies, it is absorbed — its hexes are appended to the player island with their biomes, up to a cap of 25
  hexes total.
- The level ends when every enemy island is absorbed or dead, or when the player presses `Отступить`. Either way
  the turn advances to the next build phase.

---

## 4. Architecture

### 4.1 Package skeleton

```
ostrov-prototype-v4/
  package.json  tsconfig.json  rspack.config.mjs  index.html  README.md
  docs/01-spec.json  docs/01-spec-images/  docs/analysis/00-plan.md      (the first two exist)
  scripts/probe.ts
  src/main.tsx
  src/types/assets.d.ts
  src/assets/buildings/{farm,mine,sawmill,village,masons-guild,observatory,university}.webp
  src/store/{store,route-state,game-state,ui-state,anim-state}.ts
  src/domain/{registry,registry-creator}.ts
  src/domain/{route,build,tax,tech,world,battle}-actions.ts
  src/core/{types,rng,hex,biomes,buildings,techs,toxicity,island-gen,world-gen,events,battle-sim,exports}.ts
  src/ui/{app.tsx,app.css,palette.ts}
  src/ui/pages/{main-menu,island,world,battle}-page.tsx
  src/ui/components/{turn-pill,players-panel,resources-panel,buildings-panel,demolish-icon,tech-icon,
                     tech-modal,end-turn-panel,hex-popup,biome-modal,event-modal}.tsx
  src/ui/island-canvas/{island-canvas.tsx,camera.ts,draw-island.ts,hit-test.ts}
  src/ui/world-globe/{world-globe.tsx,globe-mesh.ts}
  src/ui/battle-canvas/{battle-canvas.tsx,draw-battle.ts}
  src/ui/tax-flight/{tax-flight-layer.tsx,bezier.ts}
  src/dev/dev-hook.ts
```

### 4.2 State model (`src/core/types.ts`)

```ts
type TBiomeId = "grassland" | "plains" | "forrest" | "savanna" | "rainforest" | "taiga" | "tundra"
  | "desert" | "polar_desert" | "swamp" | "badlands" | "crater" | "volcano" | "hills" | "mountains" | "cliffs";
type TBuildingId = "farm" | "mine" | "sawmill" | "village" | "masons_guild" | "observatory" | "university";
type TResourceId = "food" | "stone" | "wood" | "population" | "hammers" | "science" | "scouting" | "mana"
  | "toxicity" | "insane";
type TResources = Record<TResourceId, number>;
type TPhase = "build" | "tax" | "exploration" | "clearing";

type THex = { readonly id: string; readonly q: number; readonly r: number; readonly biome: TBiomeId;
  readonly building: TBuildingId | null; readonly toxicity: number };          // id = `${q}:${r}`, toxicity 0..100
type TIsland = { readonly ownerId: string; readonly hexes: Readonly<Record<string, THex>> };
type TPlayer = { readonly id: string; readonly nickname: string; readonly colour: string;
  readonly isHuman: boolean; readonly army: number; readonly buildingCount: number; readonly techCount: number };
type TWorldCell = { readonly id: number; readonly centre: readonly [number, number, number];
  readonly corners: readonly (readonly [number, number, number])[]; readonly neighbours: readonly number[];
  readonly revealed: boolean; readonly biomeHint: TBiomeId; readonly trail: number;
  readonly occupantId: string | null };
type TUnit = { readonly id: string; readonly kind: string; readonly side: "player" | "enemy";
  readonly x: number; readonly y: number; readonly hp: number; readonly maxHp: number; readonly dmg: number;
  readonly range: number; readonly speed: number; readonly air: boolean };
```

The store slices mirror these: `route-state.ts` (`page`, `viewedPlayerId`), `game-state.ts`
(`turn`, `phase`, `players`, `islands`, `resources`, `worldCells`, `islandCellId`, `researching`,
`researched`, `researchProgress`, `log`, `pendingEnemies`), `ui-state.ts` (`armedBuilding`, `demolishMode`,
`hoveredHexId`, `selectedHexId`, `techModalOpen`, `eventModal`), `anim-state.ts` (`flights`, `hudAnchors`,
`taxStage`). Derived values (`toxicityPercent`, `affordable`, `legalHexes`, `hexYield`) live in `store.derived`
as `computed(...)`.

### 4.3 Routing

There is no router in the monorepo. Use a hash router, the way `ostrov-prototype-v2-config/src/editor/router.ts`
does, driven through the store:

- `store.route.page` is a signal; `navigateAction(store, page, playerId?)` sets it and writes `location.hash`.
- One `hashchange` listener installed in `main.tsx` reads the hash back into the signal.
- Routes: `#/` main menu, `#/island` own island, `#/island/:playerId` readonly other player, `#/world` global map,
  `#/battle` clearing level.
- `app.tsx` is a switch on `store.route.page.value` rendering one page component. Each page owns its own teardown
  (this is the `2d-shading` rule: a forgotten teardown leaves a second render loop running).

### 4.4 Island canvas

HTML canvas 2D, one canvas filling the page behind the panels, per the wireframe.

- DPR-aware: `canvas.width = round(rect.width * devicePixelRatio)`, re-measured through a `ResizeObserver`, exactly
  as `tbs-ostrov-prototype-7/src/ui/components/tech-canvas.tsx` does it.
- Pointy-top axial layout, `HEX_SIZE_PX = 56`:
  `x = size * sqrt(3) * (q + r / 2)`, `y = size * 1.5 * r`. `hit-test.ts` inverts it and rounds in cube space.
- `camera.ts` exports `TCamera = { x, y, scale }`, `worldToScreen`, `screenToWorld`,
  `zoomAt(camera, screenPoint, factor)` keeping the point under the cursor fixed, and
  `clampCamera` holding `scale` in `[0.4, 3]` and the island on screen.
- Wheel is registered natively: `canvas.addEventListener("wheel", onWheel, { passive: false })`, never the React
  `onWheel` prop. Dispatch inside `onWheel`:
  - `event.ctrlKey === true` → touchpad pinch (the browser reports pinch as ctrl+wheel) → zoom, factor
    `exp(-event.deltaY * 0.01)`;
  - `event.deltaX !== 0` or a small `deltaY` with `deltaMode === 0` → two-finger pan, `camera.x -= deltaX / scale`;
  - otherwise → mouse wheel zoom, factor `event.deltaY < 0 ? 1.1 : 1 / 1.1`.
- Drag with the left button pans. A pointerdown/up inside 4 px and 300 ms counts as a click, not a drag.
- Hover sets `ui.hoveredHexId`; `hex-popup.tsx` is a DOM element positioned near the cursor showing the building
  name and its resource combination for that biome (spec node `island-canvas`).
- Click sets `ui.selectedHexId`; `biome-modal.tsx` opens on the right with the biome swatch, its name and a
  description that hints at the best building.
- Biome art does not exist in the spec, so `biomes.ts` generates each swatch procedurally: a two-stop gradient plus
  a glyph, drawn once into an offscreen canvas and cached. Building art is the seven docs PNGs downscaled to
  384 px webp into `src/assets/buildings/` (they are 3.5–4 MB each at source; shipping them raw would be a 25 MB
  bundle).

### 4.5 Tax-phase animation

`tax-flight-layer.tsx` is a fixed-position canvas over the island page with `pointer-events: none`.

1. `startTaxPhaseAction` computes every `(hexId, resourceId, amount)` yield and every `(hexId, toxicity)` and
   pushes them into `anim.flights`.
2. Each flight has `from` = the hex centre in screen space (via the island camera), `to` = the centre of that
   resource's HUD chip (measured once with `getBoundingClientRect` into `anim.hudAnchors`), and a control point at
   the midpoint lifted 160 px and offset `±60 px` by index. That is a quadratic bezier —
   `bezier.ts` exports `quadPoint(from, control, to, t)`.
3. Duration `FLIGHT_MS = 700`, stagger `FLIGHT_STAGGER_MS = 60`, easing `easeInOutCubic`.
4. On each arrival the matching counter increments and the chip pulses.
5. When the last flight lands, wait exactly `INSANE_DELAY_MS = 350`, then run `generateInsaneAction` (§3.1) and
   pulse the 🤖 chip red.
6. The sequence is skippable: a click completes every flight instantly but **keeps** the 350 ms pause.
   `window.__ostrov.fastForward()` ends the whole sequence synchronously for the probe.

### 4.6 World globe

three.js `0.185.1` is in the lockfile, so build the real thing — no fallback needed.
`globe-mesh.ts` builds the Goldberg dual (subdiv 3 → 92 cells) as one `BufferGeometry` per cell with flat-shaded
`MeshStandardMaterial`, colour by `biomeHint`, grey when unrevealed. `world-globe.tsx` owns a `WebGLRenderer`, a
`PerspectiveCamera`, a `Raycaster` and its own RAF loop, and **disposes all three plus every geometry and material
in its cleanup** — the `2d-shading` teardown rule. Markers for the island and the trail are small sprites at the
cell centroids. `01-spec-image-11.png` is the look to aim for.

### 4.7 Dev hook

`src/dev/dev-hook.ts` exports `installDevHook(store, registry)`, called at the end of `main.tsx`. It sets
`window.__ostrov` with `{ store, registry, state(), navigate(page), endTurn(), fastForward(), setResources(patch),
placeBuilding(hexId, buildingId), seed(n) }`. `state()` returns a plain JSON snapshot so the probe can assert on it
without touching signals. The hook is always installed; a prototype has no production build to protect.

---

## 5. Subtasks

Shared resources: `dist/` is written by `yarn build`, and port `8401` is this worktree's probe port. Only one
subtask may run `build` at a time, and only S8 uses the browser or the port. Everyone may run `typecheck` freely.

| # | name | owns | depends on | parallel with | done when |
| --- | --- | --- | --- | --- | --- |
| S1 | **Skeleton and build pipeline** | `package.json`, `tsconfig.json`, `rspack.config.mjs`, `index.html`, `README.md`, `src/main.tsx`, `src/types/assets.d.ts`, `src/store/store.ts`, `src/store/route-state.ts`, `src/domain/registry.ts`, `src/domain/registry-creator.ts`, `src/domain/route-actions.ts`, `src/ui/app.tsx`, `src/ui/app.css`, `src/ui/palette.ts`, all four `src/ui/pages/*.tsx` as stubs | — | none (must finish first) | `yarn` from `javascript/` succeeds; `yarn workspace @hw/ostrov-prototype-v4 typecheck` and `build` both exit 0; the hash router switches between four placeholder pages |
| S2 | **Core model** (pure TS, no React) | `src/core/*.ts` (types, rng, hex, biomes, buildings, techs, toxicity, island-gen, world-gen, events, battle-sim, exports) | S1 | S3 | every spec yield table is encoded verbatim; `typecheck` green; `createIsland(seed)` returns 12–20 hexes, `createWorld()` returns 92 cells with 12 pentagons |
| S3 | **Shell UI** | `src/store/game-state.ts`, `src/store/ui-state.ts`, `src/ui/components/turn-pill.tsx`, `players-panel.tsx`, `resources-panel.tsx`, `end-turn-panel.tsx`, `src/ui/pages/main-menu-page.tsx` | S1 | S2 | the island page shows the wireframe layout at the wireframe positions; the player list has four rows and the three AI rows open readonly islands; the end-turn button cycles the four phase labels |
| S4 | **Island canvas and build phase** | `src/ui/island-canvas/*`, `src/ui/components/buildings-panel.tsx`, `demolish-icon.tsx`, `hex-popup.tsx`, `biome-modal.tsx`, `src/domain/build-actions.ts`, `src/assets/buildings/*` | S2, S3 | none | pan, zoom by wheel and by pinch, hover popup, click modal, arm a card and place a building, demolish both a building and an empty hex |
| S5 | **Tax phase** | `src/ui/tax-flight/*`, `src/domain/tax-actions.ts` | S4 | S6 | resources fly along beziers to the HUD, the counters land, there is a 350 ms gap, then 🤖 appears; `fastForward()` short-circuits it |
| S6 | **World globe and exploration** | `src/ui/world-globe/*`, `src/domain/world-actions.ts`, `src/ui/components/event-modal.tsx` | S2, S3 | S5 | the globe orbits, a cell picks on click, reveal spends 🔭, moving and staying behave differently, the trail grows and events fire |
| S7 | **Clearing phase** | `src/ui/battle-canvas/*`, `src/domain/battle-actions.ts`, `src/ui/pages/battle-page.tsx` | S2, S5, S6 | none | WASD moves the island, units auto-fight, an enemy island is absorbed once its enemies are dead, the level ends and the turn advances |
| S8 | **Tech modal, dev hook and probe** | `src/ui/components/tech-icon.tsx`, `tech-modal.tsx`, `src/domain/tech-actions.ts`, `src/dev/dev-hook.ts`, `scripts/probe.ts` | S7 | none (owns the browser and port 8401) | `yarn workspace @hw/ostrov-prototype-v4 probe` exits 0 and prints `PASS n/n` |

Order: **S1 → (S2 ∥ S3) → S4 → (S5 ∥ S6) → S7 → S8.**

`scripts/probe.ts` recipe (the monorepo pattern, from
`javascript/packages/infrastructure/excalidraw-convert/src/renderer.ts`): `yarn build` has already produced
`dist/`; `spawn("python3", ["-m", "http.server", "8401", "--directory", "dist"])` and wait for the port to answer;
`import { chromium } from "playwright"` and `chromium.launch({ headless: true })`;
`page.goto("http://127.0.0.1:8401/index.html", { waitUntil: "domcontentloaded" })`; drive everything through
`page.evaluate(() => window.__ostrov…)` and never through synthetic clicks; print one `PASS`/`FAIL` line per check,
kill the server's process group, `process.exit(failures ? 1 : 0)`.

---

## 6. Acceptance checks

Commands, all run with cwd `javascript/`:

| command | pass means |
| --- | --- |
| `yarn` | exit 0; `javascript/node_modules/@hw/ostrov-prototype-v4` is a symlink to the package; `yarn.lock` gained the `@hw/ostrov-prototype-v4@workspace:…` entry |
| `yarn workspace @hw/ostrov-prototype-v4 typecheck` | exit 0, no diagnostics |
| `yarn workspace @hw/ostrov-prototype-v4 build` | exit 0; `dist/index.html`, `dist/main.*.js` and `dist/main.*.css` exist; the whole `dist/` is under 12 MB |
| `yarn workspace @hw/ostrov-prototype-v4 probe` | exit 0 and a final `PASS n/n` line with `n >= 12` |
| `node_modules/.bin/tsc --noEmit -p packages/prototypes/ai-slop/ostrov/ostrov-prototype-v4/tsconfig.json` | exit 0 (proves the tsconfig, independent of the script) |

Browser checks, each one an assertion the probe makes through `window.__ostrov`:

- **Main menu** — `#/` renders a title, a nickname input and a `Начать` button; clicking it navigates to `#/island`
  and `state().turn === 1`, `state().phase === "build"`.
- **Island page, own** — the DOM holds exactly one `<canvas class="island-canvas">`; the player list has 4 rows;
  the resources panel shows 10 counters; the buildings panel has 7 cards; the demolish icon, the tech icon and the
  end-turn button are present. After `placeBuilding(firstGrasslandHexId, "farm")`, `state().resources.wood`
  dropped by 10 and that hex reports `building === "farm"`.
- **Island page, readonly** — `navigate("#/island/p2")` hides the buildings panel, the demolish icon, the tech icon
  and the resources panel, and keeps the canvas and the player list.
- **Canvas interaction** — dispatching a `wheel` event with `ctrlKey: true` changes `state().camera.scale`;
  dispatching one with a non-zero `deltaX` changes `state().camera.x` and leaves `scale` alone.
- **Tax phase** — `endTurn()` from `build` sets `phase === "tax"` and `anim.flights.length > 0`; after
  `fastForward()`, every counter equals the precomputed yield, `state().resources.insane` equals
  `floor(toxicityPoints / 10)` capped at the pre-conversion population, and the elapsed time between the last
  flight landing and the insane count changing is at least 350 ms when not fast-forwarded.
- **Exploration** — `phase === "exploration"` renders a `<canvas>` with a WebGL context;
  `state().world.cells.length === 92`; revealing a neighbour drops `scouting` by 2; staying raises the current
  cell's `trail` by the island's toxicity.
- **Battle** — `phase === "clearing"` renders the battle canvas; a `keydown` of `KeyD` moves
  `state().battle.playerIsland.x` to the right; running the sim 300 ticks with all enemies zeroed absorbs at least
  one enemy island; finishing the level sets `phase === "build"` and `turn === 2`.
- **Technologies** — opening the modal lists 8 techs; setting `irrigation` as the target and adding 20 📖 marks it
  researched and raises every farm's food yield by 1.

---

## 7. Traps

From the sibling `CLAUDE.md` files:

- **A page must return its teardown and use it** (`2d-shading`). A forgotten `destroy` leaves a second render loop
  running on top of the first. This bites the world globe hardest: dispose the renderer, the raycaster, every
  geometry and every material, and cancel the RAF handle.
- **One scene, one fixed seed** (`2d-shading`). Use one seeded RNG (`src/core/rng.ts`) for the island, the world
  and the battle, so two runs of the probe see the same board.
- **Zoom changes only the transform** (`fantasy-map-light`). `zoomAt` and `clampCamera` touch the camera, never the
  data. The point under the cursor must not move.
- **The wheel listener must be native with `passive: false`** (`fantasy-map-light`). The React `onWheel` prop is
  passive, so `preventDefault()` silently fails and the page scrolls instead of zooming.
- **A system that renders should not also export its layout helpers** (`ostrov-prototype-v3`). Hex layout lives in
  `src/core/hex.ts` and in nothing else.

From the monorepo:

- `defaultSemverRangePrefix: ""` — write **exact** versions. A `^` in a new dependency is a review failure.
- `enableTransparentWorkspaces: false` — a workspace dependency needs `workspace:*` spelled out.
- `verbatimModuleSyntax` is on — type-only imports must be `import type`.
- `base.json` does not set `noEmit`, so the package tsconfig must (`tbs-7` does).
- `include` is mandatory in the package tsconfig; without it the inherited `exclude` points at the preset package
  and `tsc` compiles our `node_modules`.
- Keep `devServer.port: 0`. The comment in the tbs-7 rspack config explains why: a fixed dev port lets a forgotten
  server from an earlier run answer with a stale bundle. The probe's `8401` is a *different* thing — a plain
  `python3 -m http.server` over the freshly built `dist/`.
- `yarn :static` overwrites `$INIT_CWD` and can only serve paths inside `javascript/`. It is unusable for the
  probe, which needs a fixed port; use `python3 -m http.server 8401 --directory dist`.
- Killing an `npx http-server` leaves the child alive on the port. Use `python3 -m http.server` and kill the
  process group.
- Playwright must stay at exactly `1.61.1`: the installed browser is `chromium-1228` and nothing else. Firefox and
  webkit are not installed at all.
- Parallel sessions share the git index. Never `git add -A`; stage by explicit path. Never bare `git stash`.
- Another session may be running an http server; before binding `8401`, check the listening PID and fail loudly
  rather than assuming a restart succeeded.

New, found while reading this spec:

- The source building PNGs are 3.5–4 MB each. Downscale them to 384 px webp before importing, or the bundle blows
  past 25 MB. rspack needs an explicit `asset/resource` rule for them plus `declare module "*.webp";` in
  `src/types/assets.d.ts` — no ostrov package imports an image today, so there is no rule to copy.
- The spec ships **no biome art**, only building art and the world reference. Biome swatches must be generated.
- The whiteboard labels lie in two places: node-9 says "референс острова из гексов" but points at the resources
  panel image, and `image-37` duplicates `image-7` with no edge. Trust §1.7, not the node text.
- `💠 мана` has no producer anywhere in the spec. §3.1 invents one; do not go looking for it.
- The cavalry list in the spec (node-31) is a copy of the ranged list (node-29). §3.8 resolves it as mounted
  variants rather than treating it as a bug to fix.
- `ostrov-prototype-v5` and `ostrov-prototype-v3/ostrov-island-mover-prototype` are empty directories. There is
  nothing there to learn from and nothing to copy.
