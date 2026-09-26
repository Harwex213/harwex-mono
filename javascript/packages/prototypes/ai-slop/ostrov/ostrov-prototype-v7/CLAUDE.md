Four packages split a 2D strategy into layers. The game is a one-button clicker, small on purpose.

| package | role | imports |
| --- | --- | --- |
| `@hw/ostrov-prototype-v7-assets` | the palette, the type face, and the Canvas 2D manifests its harness paints | — |
| `@hw/ostrov-prototype-v7-core` | game logic, an observable model | — |
| `@hw/ostrov-prototype-v7-gui` | the four widgets | assets, react |
| `@hw/ostrov-prototype-v7-game` | the React app: layout and wiring | core, gui, react |

Run every command with cwd `javascript/`:

```bash
yarn workspace @hw/ostrov-prototype-v7-game dev         # rspack dev server on a free port
yarn workspace @hw/ostrov-prototype-v7-game build       # bundle into dist/
yarn workspace @hw/ostrov-prototype-v7-game serve       # serve dist/ on :8407
yarn workspace @hw/ostrov-prototype-v7-core test        # node:test over the model
yarn workspace @hw/ostrov-prototype-v7-core harness     # the class diagram, zoom and pan
yarn workspace @hw/ostrov-prototype-v7-gui harness      # the widget gallery
yarn workspace @hw/ostrov-prototype-v7-<pkg> typecheck  # tsc --noEmit
```

### Layers

`assets → gui → game`, `core → game`. Never import against an arrow.

- `core` imports no sibling package. No DOM, no timers. Its one dependency is `@preact/signals-core`. It never imports `@preact/signals-react`: that package pulls in React.
- `gui` imports `assets` only, and only for the palette and the type face. It must not learn what the game is: a widget takes `gold`, `label` or `onPress` from the layer above, never the model.
- `gui` and `game` are React. `core` and `assets` are not, and must stay that way.
- Cross-package imports go through `@hw/ostrov-prototype-v7-<pkg>`, never a deep path. `exports.ts` is the whole public API; `src/` is private.

### assets

- A manifest declares shapes against the frame it is painted into — `inset`, `radius`, palette color names. No absolute coordinates.
- `src/shape.ts` is the only Canvas-aware file. Keep it that way: a spritesheet backend replaces it and leaves the manifests alone.
- Hex codes live in `palette.ts` and nowhere else. Text sizes live in `Text.styles` and nowhere else. A widget names a color or a style, it never spells one out.
- A new asset is a new file with its manifest plus a line in `exports.ts`.
- The screen no longer paints a manifest: the widgets are DOM. What `assets`
  still feeds the game is `palette` and `Text`. The Canvas 2D side is alive for
  the harness, and for whatever draws the map later.

### gui

A widget is a React component and nothing else. It takes its data and its
actions as props, and it holds no state.

There are four. `ResourcePanel` is the grid of resource counts, `TurnPanel`
names the turn and its phase, `TurnEndPanel` is the phase wheel over the button
that ends the turn, `ExtraActionsPanel` is the strip of extra actions with a
tooltip on each. Add a fifth only when the screen grows a part none of these
covers.

- A widget never reads a signal and never imports `core`. The app reads, the
  widget receives: `gold={gold}` and `onPress={mine}`, never `game={game}`.
- A widget never spells a colour, a font or a size the palette owns. It reads a
  `--ostrov-*` variable. `themeVariables` builds them from `assets/palette.ts`,
  and the app puts them on one element above every widget.
- A widget owns a folder under `src/`, named after it. Inside: the component,
  its CSS, and an `exports.ts` naming what leaves the folder. Class names carry
  the `ostrov-` prefix.
- The folder is the unit of work. Two agents on two widgets share no file, and
  a widget may grow to five files inside its folder without the barrel above
  noticing. The shared files are `src/theme.ts` and the package `exports.ts`;
  a widget touches them only when it is added, removed or renamed.
- A widget never imports another widget's folder. A widget that has to hold
  another one takes `children`, so nesting is the app's call. What two widgets
  both need moves up to `src/`.
- A widget carries its own stories: `<widget>.stories.tsx` in its folder, one
  `WidgetStories` export. The harness picks them up.

### gui harness

`yarn workspace @hw/ostrov-prototype-v7-gui harness` opens the gallery: the
widgets down the left, one tile per story on the right, each tile on the page
background with the theme variables applied.

- A story is `{ id, title, note?, render() }`. `render` returns an element, so a
  story that needs state returns its own component and keeps the hooks inside
  it. `TurnEndPanel`'s `onEnd` story counts its presses that way.
- Cover what a caller can get wrong: the empty value, the number that overflows,
  the label too long for the box. A note under the title says what to look at.
- `harness/pages.ts` lists the widgets. It and `src/story.ts` are the only files
  a new widget touches outside its own folder.
- A story that composes several widgets lives in `harness/`, never in a widget
  folder, because assembling widgets is the app's job and a widget must not
  import another one.
- A widget whose part only appears on hover or focus is absolutely positioned,
  and the tile clips what leaves it. The story adds the room, in its own wrapper:
  that is story code, not widget code.

### core

The model of Toxic Island, from `docs/human/01-first-look`. A class per model, a
file per class. A class keeps its state in signals and exposes each one as a
`ReadonlySignal` getter. Only a method on the class writes to a signal.

`Game` is the only surface the game layer needs. It holds the `Player`, the
`World` and the `Turn`, and every action it takes belongs to a phase: `build`
and `demolish` in the building phase, `collectTaxes` in the tax phase, `scout`,
`moveTo` and `stay` in the scouting phase, `fight` in the cleanup phase. An
action out of its phase returns `false`, not an error.

- `Hex` is one tile of the island: a biome, a building and its own toxicity.
  `produce` rolls one of the combos of the building, adds the bonus of the
  biome, scales the result by the toxicity of the hex, and poisons the hex with
  what the building emits. From 50 toxicity a hex grows no food; at 100 it is
  dead and produces nothing.
- `Island` holds the hexes, sums the toxicity, and refuses a building the biome
  or the treasury cannot take.
- `Resources` holds the eight resources. `Madness` holds the mad: every ten
  points of island toxicity take one man out of the population, the mad eat half
  a ration each, and mana brings them back.
- `World` is the global map: hexes with neighbours, a scouting cost, a move to a
  free neighbour, and the toxic trail. The trail only grows, and past its
  thresholds it rolls the events of `trailEvents`.
- `Army` and `Battle` settle the cleanup phase. The enemies of a raid come from
  `enemyKinds`, by the tier the turn has reached.
- The catalogs — `biomes`, `buildingKinds`, `unitKinds`, `enemyKinds`,
  `trailEvents` — are data, and the GDD is their source.

The core keeps no timer and no randomness of its own: `Game` takes a
`Random` (`() => number`) and hands it to whoever rolls. A test passes a
sequence and gets the same game twice.

Two things the GDD leaves open. Building costs are invented, and so is the
madness rule above. Mana has no producer yet: no building in the GDD makes it.

### harness

The core harness paints every class in the package on a zoom and pan canvas: its
properties, its methods and the dependencies between them. A click opens the
panel with the private fields and the full types; the search dims everything
that does not match. A card follows the cursor when dragged, and `format` throws
the drags away and lays the columns out again.

- The diagram is generated, never drawn by hand. `tools/extract-model.mjs` reads
  `src/*.ts` with the TypeScript compiler API and writes
  `harness/model.generated.json`. The rspack plugin runs it before every compile
  and watches `src/`, so a new class appears on save.
- A node is a class or a type. A constant, a function and an external package
  are not drawn.
- The tool reads syntax, not types. An edge is a name one declaration mentions
  and the package declares elsewhere: a heritage clause, a `new`, a type
  reference.
- An edge remembers the members that mention the target, so it leaves the row
  that declares the dependency. The card is scanned top down: a property wins
  over a method, and the constructor is the last resort.
- The comment directly above a class becomes the description on its card. The
  author writes it, in a sentence or two; nothing generates it.
- `harness/` has its own tsconfig with the DOM lib. The package tsconfig stays
  DOM-free, so `src/` cannot reach a browser API by accident. `typecheck` runs
  both.

### react

- `main.tsx` mounts `<App game={new Game()} />` on `#root`. `index.html` holds
  `<div id="root">` and nothing else.
- `App` calls `useSignals` first, reads each signal it needs into a const, and
  passes the values down. It is the only file that touches both the model and
  the widgets.
- State is never copied into `useState`. A press calls a method on `Game`, and
  the re-render follows from the signal.
- `src/app.css` places the app and paints the page. What a widget looks like
  lives in `gui`, never here.

### signals

One copy of `@preact/signals-core` has to reach the whole bundle. Two copies
give two tracking contexts, and then a model signal is invisible to
`useSignals`: the canvas keeps updating, the DOM silently stops. Two things
guard it, and the version pin alone is not enough because hoisting depends on
what the rest of the monorepo pins:

- `core` pins the exact version `@preact/signals-react` depends on. Bump both
  together.
- `game`'s rspack config aliases `@preact/signals-core` to the copy
  `@preact/signals-react` resolves.

The symptom is a screen that stands still while the model moves: the button
responds, `Game.score` grows, and nothing on the page changes.

### Style

Follow `javascript/CLAUDE.md`. In this prototype that means double quotes, semicolons, always-braced `if`, and one grouped `export { ... }` plus `export type { ... }` at the end of the file.

`exports.ts` is the exception. A barrel re-exports with `export ... from`, never
`import` then `export`. One block per module, blank line between blocks, the
values first and the types under them:

```ts
export { Panel } from "./src/panel";
export type { PanelManifest, PanelPlacement, PanelVariant } from "./src/panel";
```

A reader then sees where a name comes from on the line that exports it.
