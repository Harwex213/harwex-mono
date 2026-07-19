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
  `/` is a **redirect to `/game`** (the top nav replaced the old landing page), and
  `/battle` is a **redirect to the subpage for the current battle phase**
  (`/battle/units-disposition` → `/battle/active` → `/battle/finished`, or `/game`
  when no battle is running); both are registered outside the handshake because
  they render nothing.

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

- **Domain / session state** → per-module state objects created by module
  factories and held in the app-wide `MODEL` (`model/model.js`). **Survives
  in-session navigation** (the draft army persists as you move between pages).
- **Transient UI state** → plain closure variables inside the `render*()` function
  (e.g. `comboForUnitId`). Discarded on teardown.
- **Static game data** → `data/` constants (`UNIT_TYPES`, `RANK_MODIFIERS`,
  `TERRAINS`, `DEFAULT_MAPS`). User-editable catalogs (maps, modifier collections)
  live in localStorage-backed stores in `modules/`.

**`MODEL` is the app's only singleton** — the composition root that instantiates
every module's state (store state moves in as the legacy stores migrate). Modules
never import `model.js` (dependencies point one way: model → modules); pages import
`MODEL`, read it freely, and mutate it **only through module functions**, then call
the page's local `render()` to repaint. There is no reactive binding — re-rendering
is manual.

### Stateful module pattern

Modules in `modules/` that own domain state follow one pattern —
**`battle-config.js` and `active-battle.js` are the canonical examples**:

1. **No module-level mutable state.** State is a plain object built by a
   `create()` factory; even id counters live inside it (`nextUnitId`). The module
   file holds only functions and constants.
2. **Functions take state as parameters** — their own module's state first, then
   arguments. When a function needs *another* module's data, the caller passes that
   module's state object (or a value derived from it); a module may call another
   module's pure functions on state it received. Modules never reach into another
   module's storage on their own.
3. **Module functions are the only way to mutate module state.** Outside the module
   (pages, other modules) state is read-only. This is a convention, not enforced —
   an assignment to `MODEL.*` anywhere outside `modules/` is a violation.
4. **Public API is a namespace object** named `<FILE_NAME>_MODULE`
   (`battle-config.js` → `BATTLE_CONFIG_MODULE`). Functions are exported **only**
   through the namespace — never flat alongside it. Plain constants (`SIDES`,
   `BATTLE_PHASE`) may be exported separately.
5. **State and data shapes are declared in `modules/types.d.ts`** as ambient global
   types — JSDoc references them without imports. Nothing type-checks the code
   (no jsconfig/checkJs); types exist for editors and agents, so keep them in sync
   with the shapes you change.
6. **JSDoc**: every namespace (public) function carries typed `@param`/`@returns`.
   Private helpers get a comment only when behavior is non-obvious (the "why, not
   what" rule) — no boilerplate blocks that restate a signature.
7. **Errors**: mutators guard and silently no-op on invalid input or stale refs
   (ids pointing at a deleted collection are normal, not exceptional); lookups
   return `null`. Module functions don't throw.
8. **No side effects at module import.** A persistence-backed module exposes
   explicit `hydrate`/`persist` functions; `model.js` hydrates at startup. Never
   touch `localStorage` (or any environment API) at the top level of a module.

The pattern applies to **stateful domain modules only**. Pure-function helpers
(for example `hex-layout.js`, `hexagon-render.js`) keep flat named exports; 
If a module owns mutable domain state, it follows the pattern.

### Testing

Unit tests are co-located `<module>.test.js` files using `node:test` + `node:assert`;
run them with `yarn test` (`node --test 'src/**/*.test.js'`). The module pattern is
what keeps them cheap: build state with `MODULE.create()`, call module functions
with plain objects, assert on the result — no DOM, no localStorage, no mocks.
Legacy modules with import-time side effects can't be imported under Node; don't
add tests for them until they're migrated.

### Rendering & events

- Markup is built from **template literals** and injected with `innerHTML`.
- **Event delegation**: attach one listener per event type to `root`. Dispatch on
  `data-action` inside a `switch` (`event.target.closest("[data-action]")`). Use
  `data-role` to locate elements and `data-*` to carry ids (e.g. `data-unit-id`).

### Shared components

`components/` holds shared render helpers that return **HTML strings** — they carry
their own scoped `<style>` block (unique prefix, tokens only) but attach **no
listeners and need no teardown**; the embedding page's `innerHTML` lifecycle covers
them.

`components/top-nav.js` exports `topNavHtml()`, the top navigation bar. **Every page
must embed `${topNavHtml()}` as the first thing it writes into `root.innerHTML`, in
every render path** — including empty/error states (battle-disposition's "No battle
awaiting disposition", modifiers-table's "Collection not found"). There is no
enforcement point: the nav is re-rendered by each page, so a page (or render branch)
that forgets it silently ships without navigation. Treat it as part of the page
skeleton when creating a new page.
Active-link state is derived from `location.hash` at build time with a prefix match,
so a section link stays lit on its child routes.

### Styling

**Design tokens** live in `src/styles/` and are loaded globally via `<link>` in
`index.html`: `tokens.css` (a two-layer system — primitive values named by what they
*are*, then semantic tokens named by what they *do*) and `base.css` (font `@import`,
`body` defaults, reset). The identity is the faenwald dark-fantasy palette: warm-neutral
surfaces, muted parchment gold accent, Spectral for headings, system sans for body.

**Non-negotiable rules** — they apply to *every* page, including throwaway prototype
screens; there is no "wireframe first, style later" mode:

1. Every color, spacing, font, and radius value is a `var(--*)` token.
   - **Banned literals:** hex / `rgb(a)` / named colors; `padding`, `margin`, `gap`;
     `font-size`, `font-weight`, `font-family`; `border-radius`; `opacity`; shadows.
   - **Allowed literals:** `width` / `height` / `min-*` / `max-*` dimensions,
     `1px` border widths, `z-index`, `line-height`, transition durations.
2. Colors go through the **semantic layer only** (`--text-*`, `--bg-*`, `--border-*`);
   never reference a `--color-*` primitive from a page. Prefer a component token
   (`--card-*`) where one exists. Spacing / typography / radius primitives
   (`--space-*`, `--font-*`, `--radius-*`) *are* used directly.
3. Missing a token? Extend `tokens.css` first — add the primitive, expose a semantic
   token — then use it. Never inline the raw value "for now".
4. Per-page CSS stays in a single scoped `<style>` block per page (see
   `battle-creation.js`): every selector is prefixed with a short page class (`.bc`
   for battle-creation, `.bt` for battle, `.tn` for the top-nav component) that also
   wraps the page markup — poor-man's scoping without a bundler. Give each page its
   own unique prefix. Only tokens/base are global; page layout is not. Do **not**
   use inline `style="..."` — use a scoped block with tokens instead.
5. Before finishing any change to a `<style>` block, re-read it and verify no banned
   literal slipped in — `grep -nE '#[0-9a-f]{3,8}\b|rgba?\(|[0-9]+px' src/pages src/components`
   (hits outside `width/height/min/max/1px-border` are violations; fix before you're done).

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
├── components/                # shared render helpers returning HTML strings
├── modules/                   # behavior & runtime state
├── data/                      # static or derived constants — no behavior
└── styles/                    # global design tokens & base styles (see Styling)
```

**What lands where** — classify by *primary role*:

- `pages/` — a screen the router renders. Exactly one exported `render<Name>()`
  per file (see [Page lifecycle](#page-lifecycle)).
- `components/` — shared render helpers used by multiple pages (see
  [Shared components](#shared-components)). HTML-string builders only — a helper
  that needs its own listeners or state belongs in `modules/` instead.
- `modules/` — anything with behavior or runtime state: classes (`Router`),
  stateful domain modules (`battle-config.js`), helper logic.
- `data/` — pure constants and values derived from them (`UNIT_TYPES`, `ROUTES`).
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
distinct category earns it (roughly 3+ files sharing a role). `components/` was
created ahead of that threshold as a deliberate exception for the shared top nav —
new shared render helpers go there rather than into a new home. Give a page its own
folder only once it needs private, non-shared helpers. New structure beyond this is a deliberate
architecture change — update this section when you make one.

**When building a new page, copy `pages/battle-creation.js`** — it's the
canonical example of the page lifecycle, event delegation, and scoped-style
conventions used across the app.

## Conventions

- **Named exports only**, no default; one `export { ... }` block at the bottom of each file.
- **Arrow functions** throughout. Class internals use private fields (`#`) — see `Router`.
- **Comments explain why, not what** — reserve them for non-obvious behavior.
- **Multiline comments use `/** */`** with a `*`-prefixed line per row; split a
  large one into paragraphs separated by a blank `*` line. Single-line comments
  stay `//`.
- Follow the event-delegation and state rules above rather than reaching for
  per-element listeners or ad-hoc global variables.
