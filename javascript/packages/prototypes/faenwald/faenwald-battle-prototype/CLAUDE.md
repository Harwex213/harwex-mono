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

- **Domain / session state** → the `battleConfig` singleton in
  `modules/battle-config.js`. Imported directly by pages and **survives in-session
  navigation** (the draft army persists as you move between pages).
- **Transient UI state** → plain closure variables inside the `render*()` function
  (e.g. `comboForUnitId`). Discarded on teardown.
- **Static game data** → `data/catalog.js` (`MAPS`, `UNIT_TYPES`, `RANK_MODIFIERS`).

**Mutating `battleConfig`:** only through the exported helpers
(`createUnit`, `findUnit`, `removeUnit`, …), then call the page's local `render()`
to repaint. There is no reactive binding — re-rendering is manual and always
re-writes the whole page's `innerHTML`.

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
