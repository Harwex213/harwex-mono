# @hw/battle-prototype

A battle configurator for the Faenwald game: pick a map, build attacker/defender
armies from unit types and modifiers, then view the resulting battle.

Unlike its React/TypeScript siblings, this package is **plain vanilla JavaScript**:
ES modules loaded directly by the browser, **no build step, no dependencies, no
framework**. `index.html` loads `src/index.js` as `<script type="module">`.

Run it with `yarn :static` from this directory (see the root `javascript/CLAUDE.md`).

## Architecture

The app is a single `<main>` element that pages render into. A hash router swaps
one page for another.

### Routing

- `modules/router.js` — a custom hash router. It **only listens**: it matches
  `location.hash` against registered routes (regex, with `:param` support) and
  calls the matching handler. It never navigates on its own.
- `data/routing.js` — `ROUTES` (path constants) and `ROUTE_LINKS` (the same paths
  as `#`-prefixed hrefs).
- `src/index.js` — wires each route to a page and manages the teardown handshake.

**Navigation is done by setting `location.hash`**, e.g. `location.hash = ROUTES.BATTLE`,
or with a declarative `<a href="#/...">` built from `ROUTE_LINKS`. Pages do **not**
import the router. If a page ever needs the router programmatically, pass it as an
argument to the page's `render*()` function — do not turn it into a singleton.

### Page lifecycle

Every page is a `render*()` function that:

1. writes its markup into `<main>` via `root.innerHTML`,
2. attaches its event listeners to `root`,
3. **returns a teardown function** that removes those listeners and clears `root.innerHTML`.

`index.js` calls the previous page's teardown before rendering the next one. Always
return a teardown that undoes everything the page set up — forgetting to remove a
listener leaks it across navigations.

### State model

- **Domain / session state** → the `battleConfig` singleton in
  `modules/battle-config.js`. Imported directly by pages and **survives in-session
  navigation** (the draft army persists as you move between pages).
- **Transient UI state** → plain closure variables inside the `render*()` function
  (e.g. `comboForUnitId`). Discarded on teardown.
- **Static game data** → `data/catalog.js` (`MAPS`, `UNIT_TYPES`, `MODIFIERS`).

**Mutating `battleConfig`:** only through the exported helpers
(`createUnit`, `findUnit`, `removeUnit`, …), then call the page's local `render()`
to repaint. There is no reactive binding — re-rendering is manual and always
re-writes the whole page's `innerHTML`.

### Rendering & events

- Markup is built from **template literals** and injected with `innerHTML`.
- **Event delegation**: attach one listener per event type to `root`. Dispatch on
  `data-action` inside a `switch` (`event.target.closest("[data-action]")`). Use
  `data-role` to locate elements and `data-*` to carry ids (e.g. `data-unit-id`).

### Styling

**Design tokens** live in `src/styles/` and are loaded globally via `<link>` in
`index.html`: `tokens.css` (a two-layer system — primitive values named by what they
*are*, then semantic tokens named by what they *do*) and `base.css` (font `@import`,
`body` defaults, reset). The identity is the faenwald dark-fantasy palette: warm-neutral
surfaces, muted parchment gold accent, Playfair Display for headings, system sans for body.

**Always use `var(--*)` tokens — never raw hex, rgba, spacing, font-size, or
border-radius literals** in a page's CSS. If a needed token doesn't exist, add it to
`tokens.css` first (extend the primitive layer, then expose a semantic token).

Per-page CSS stays in a single scoped `<style>` block per page (see `battle-creation.js`):
every selector is prefixed with a short page class (`.bc` for battle-creation, `.mp` for
main-page, `.bt` for battle) that also wraps the page markup — poor-man's scoping without
a bundler. Give each page its own unique prefix. Only tokens/base are global; page layout
is not. Do **not** use inline `style="..."` — use a scoped block with tokens instead.

## Project structure

The skeleton is stable; the leaf files inside each directory change as the app
grows. Place a new file by directory *role*, not by copying the current listing
(the files that exist today are named in the Architecture section above).

```
index.html                     # the shell: loads src/index.js as an ES module
assets/                        # static binary assets (map images, …)
src/
├── index.js                   # app entry: creates Router, wires routes → pages
├── pages/                     # one file per page; renders into <main>
├── modules/                   # behavior & runtime state
└── data/                      # static or derived constants — no behavior
```

**What lands where** — classify by *primary role*:

- `pages/` — a screen the router renders. Exactly one exported `render<Name>()`
  per file (see [Page lifecycle](#page-lifecycle)).
- `modules/` — anything with behavior or runtime state: classes (`Router`),
  singletons (`battleConfig`), helper logic.
- `data/` — pure constants and values derived from them (`MAPS`, `ROUTES`).
  A file that mixes constants and logic (e.g. `battle-config.js` carries `SIDES`
  but exists to hold stateful logic) goes where its *primary role* is — here,
  `modules/`.

**Naming**

- Files are **kebab-case** (`battle-creation.js`, `battle-config.js`).
- A page file exports a single `render<PascalName>()` matching the file name
  (`battle-creation.js` → `renderBattleCreation`).
- `data/` files export **UPPER_SNAKE** constants.
- `modules/` files export a class or named helpers.

**Growth** — start flat. Add a new top-level directory under `src/` only when a
distinct category earns it (roughly 3+ files sharing a role, e.g. a `components/`
for reusable render helpers). Give a page its own folder only once it needs
private, non-shared helpers. New structure beyond this is a deliberate
architecture change — update this section when you make one.

**When building a new page, copy `pages/battle-creation.js`** — it's the
canonical example of the page lifecycle, event delegation, and scoped-style
conventions used across the app.

## Conventions

- **Named exports only**, no default; one `export { ... }` block at the bottom of each file.
- **Arrow functions** throughout. Class internals use private fields (`#`) — see `Router`.
- **Comments explain why, not what** — reserve them for non-obvious behavior.
- Follow the event-delegation and state rules above rather than reaching for
  per-element listeners or ad-hoc global variables.
