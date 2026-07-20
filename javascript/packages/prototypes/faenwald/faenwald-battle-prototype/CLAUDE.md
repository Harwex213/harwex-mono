# @hw/battle-prototype

A battle configurator for the Faenwald game: pick a map, build attacker/defender
armies, view the resulting battle.

**Plain vanilla JavaScript** — ES modules loaded directly by the browser; no build
step, no dependencies, no framework. Run with `yarn :static` from this directory.

## Architecture

A single `<main>` element; a hash router (`modules/router.js`) swaps pages into it.

**Routing.** The router owns all knowledge of `location.hash` — pages and
components never touch it. Imperative navigation via `router.push(ROUTES.X,
params)`; the router instance is passed to every page — never a singleton.
Declarative navigation via `<a>` hrefs from `ROUTE_LINKS`; current route via
`router.currentPath()`. Redirects (`router.replace`) live in `src/index.js` only.

**Page lifecycle.** A page is `render<Name>(params, router)`: write markup via
`root.innerHTML`, attach listeners to `root`, **return a teardown** that undoes
everything — a forgotten listener leaks across navigations.

**State.** `MODEL` (`model/model.js`) is the app's only singleton — the
composition root holding each module's state object; domain state survives
in-session navigation. Pages read `MODEL` freely but mutate **only through module
functions**, then repaint via the page's local `render()` — there is no reactive
binding. Transient UI state is page-local (closure vars, or the `ctx.ui` bag in
folder pages) and dies on teardown.

**Stateful modules** (`modules/`) — canonical: `battle-config.js`,
`active-battle.js`; persistence-backed: `maps.js`, `modifiers.js`:

- No module-level mutable state — a `create()` factory builds the state object
  (id counters included).
- Functions take their own module's state first, then args; cross-module data is
  passed in by the caller.
- Mutating `MODEL.*` outside `modules/` is a violation (convention, not enforced).
- Mutators never throw: silently no-op on invalid input / stale ids; lookups
  return `null`.
- No environment access, ever: storage arrives as an injected
  `{ getItem, setItem }` adapter via `create({ storage })` + explicit `hydrate()`;
  keys live in `data/local-storage-keys.js`.
- Public API is one namespace export, `<FILE_NAME>_MODULE`; shapes are ambient
  types in `modules/types.d.ts` — nothing type-checks them, keep them in sync by
  hand.

Pure-function helpers (`hex-layout.js`) keep flat named exports instead.

**Testing.** Co-located `<module>.test.js` using `node:test` + `node:assert`; run
with `yarn test`. Build state with `MODULE.create()`, assert on plain objects —
no DOM, no mocks.

**Rendering & events.** Template literals injected with `innerHTML`. One delegated
listener per event type on `root`, dispatched on `data-action`
(`event.target.closest("[data-action]")`); `data-role` locates elements, `data-*`
carries ids.

**Page decomposition.** A page starts as one file; once it stops scanning, split
into the fixed folder shape (canonical: `pages/battle-creation/`):

```
pages/<name>/
├── <name>.js   # wiring: ctx, render(), listeners, teardown
├── actions.js  # CLICK_ACTIONS / CHANGE_ACTIONS intent maps
├── view.js     # pure HTML builders — data in via params, never MODEL
└── style.js    # scoped <style> string
```

- Handlers must call `ctx.render()` — nothing repaints automatically; forgetting
  it is the classic bug.
- CLICK and CHANGE maps stay separate: radios/selects fire both events for one
  interaction.
- `view.js` never imports `model.js`.

**Shared components** (`components/`) return HTML strings with their own scoped
`<style>` — no listeners, no teardown. **Every page embeds `${topNavHtml(router)}`
first in `root.innerHTML`, in every render path including empty/error states** —
nothing enforces it; a branch that forgets ships without navigation.

**Styling.** Tokens live in `src/styles/tokens.css` (primitive → semantic layers).
Non-negotiable, even on throwaway screens:

- Every color/spacing/font/radius/opacity/shadow value is a `var(--*)` token — no
  hex/rgb/named colors, no raw `px` spacing, fonts, radii. Allowed literals:
  dimensions, `1px` borders, `z-index`, `line-height`, durations.
- Colors via semantic tokens only (`--text-*`, `--bg-*`, …), never `--color-*`
  primitives. Missing a token? Extend `tokens.css` first — never inline "for now".
- One scoped `<style>` block per page, every selector prefixed with a unique page
  class (`.bc`, `.bt`). No inline `style="..."`.
- Self-check before finishing:
  `grep -nE '#[0-9a-f]{3,8}\b|rgba?\(|[0-9]+px' src/pages src/components`.

## Structure

```
index.html          # shell: loads src/index.js as an ES module
src/
├── index.js        # entry: creates Router, wires routes → pages
├── pages/          # one file — or one folder — per page
├── components/     # shared HTML-string helpers (needs listeners? → modules/)
├── modules/        # behavior & runtime state
├── data/           # pure constants only — no behavior
└── styles/         # global tokens & base styles
```

## Conventions

- Named exports only, one `export { ... }` block at the bottom of each file.
- Comments explain why, not what.
