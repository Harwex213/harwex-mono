# @hw/battle-prototype

A battle configurator for the Faenwald game: pick a map, build attacker/defender
armies, place them, fight the battle.

**Architecture = the `vanilla-proto` skill** (`javascript/.claude/skills/vanilla-proto`):
no bundler, native ESM, one pub/sub store, pure state actions, factory components
`{ el, destroy }`, per-component CSS. Run with `yarn :static`, test with `yarn test`.
This file documents only what this app adds on top of the skill.

## Routing (skill doesn't cover it)

A hash router (`src/router.js`) swaps page components into `<main>`. The router
owns all knowledge of `location.hash` — pages and components never touch it.

- A page is a component factory `createXPage({ store, router, params })` →
  `{ el, mount?, destroy }`, registered in `index.js`. The registrar inserts
  `el`, calls the optional `mount()`, and calls `destroy()` on leave.
- `mount()` exists for pages that must measure layout or resolve computed
  styles (canvas) — creation time is too early, the element isn't in the
  document yet.
- Imperative navigation via `router.push(ROUTES.X, params)`; declarative via
  `<a>` hrefs from `ROUTE_LINKS`. Redirect guards run at factory time:
  `router.replace(...)` then return a noop page.
- `router.onChange(fn)` fires after every resolved navigation (top-nav uses it
  for its active link).

## App shell

`index.js` mounts `createTopNav({ store, router })` once above `<main>` —
pages never render navigation. The "Current Battle" item follows
`activeBattle.phase` through the store subscription.

## State (deltas from the skill)

Domains: `AppState = { maps, modifiers, battleConfig, activeBattle }`;
disposition-phase actions live in `state/battle-disposition.js` and act on
`activeBattle`.

- Mutators never throw: silently no-op on invalid input / stale ids; lookups
  return `null`. Cross-domain data is passed in by the caller.
- ids may arrive as strings (route params) or numbers (in-memory) — compare
  loosely.
- **Persistence**: actions stay pure. A mutator that must reach storage bumps
  its domain's `rev` counter; the persister in `index.js` (a store subscriber)
  writes the domain to localStorage when the rev moves. `hydrate*(state, raw)`
  takes the raw stored string; seeding bumps `rev` so seeds get written back.
  In-memory-only mutators (`setMapCell` during a paint stroke) don't bump.
  Keys live in `data/local-storage-keys.js` — never change them casually,
  stored user data must survive refactors.

## Events & rendering (deltas from the skill)

- One delegated listener per event type on the component's `el`, dispatched on
  `data-action`; `data-role` locates elements. A handled action calls
  `event.stopPropagation()` — an action may navigate, and the event must not
  leak into whatever mounts next.
- CLICK and CHANGE intent maps stay separate (battle-creation): radios/selects
  fire both events for one interaction.
- Live keystroke edits dispatch through the store but **muted** from repaint
  (`dispatchMuted` in modifiers-table, map-editor): the DOM already shows the
  typed text, and repainting a focused input mid-edit corrupts the caret.
  Structural changes repaint via the subscription.
- A store subscriber must not dispatch back into the store (see maps-store's
  thumbnail refresh — it runs once at creation instead).

## Canvas pages

`lib/abstract-canvas.js` owns camera/zoom/pan/hover and RAF-batched painting;
`lib/unit-render.js` holds the hex-scene constants and the shared unit painter
(disc, weight ring, group emoji, facing triangle, ruler crown). Canvas setup
resolves CSS tokens once via `getComputedStyle` — inside `mount()`. Page UI
state (selection, toggles, fire mode) reaches the canvas through a `hooks`
object; the canvas subscribes to the store and repaints on every change.

## Styling (deltas from the skill)

- Tokens live in `src/styles/tokens.css` (primitive → semantic layers),
  imported by `src/styles.css`. Non-negotiable, even on throwaway screens:
  every color/spacing/font/radius/opacity/shadow is a `var(--*)` semantic
  token (`--text-*`, `--bg-*`, …), never `--color-*` primitives, no raw
  values. Allowed literals: dimensions, `1px` borders, `z-index`,
  `line-height`, durations. Missing a token? Extend `tokens.css` first.
- Page CSS is scoped under the component root class (`.battle-active .panel`);
  leaf components use name-prefixed classes (`.top-nav-link`). No inline
  `style="..."`. The one sanctioned `<style>` block is map-editor's generated
  terrain-swatch rules — they're data-driven and can't live in static CSS.
- Self-check before finishing:
  `grep -nE '#[0-9a-f]{3,8}\b|rgba?\(|[0-9]+px' src/pages src/components`
  (dimension widths/heights are fine, colors are not).

## Structure

```
index.html          # shell: loads styles.css and src/index.js as an ES module
src/
├── index.js        # composition root: store, hydration, persister, top-nav, routes
├── store.js        # canonical pub/sub store (copied verbatim from the skill)
├── router.js       # hash router
├── pages/          # one file — or one folder (battle-creation, battle/) — per page
├── components/     # shared factory components (top-nav)
├── state/          # pure domain actions + co-located node:test files
├── lib/            # pure geometry / combat rules / canvas helpers + tests
├── data/           # pure constants only — no behavior
├── styles/         # tokens.css (primitive → semantic), base.css
├── styles.css      # @import root: styles/ + every component/page css
└── types.d.ts      # ambient domain types (referenced bare in JSDoc)
```

## Conventions

- Named exports only, one `export { ... }` block at the bottom of each file.
- Comments explain why, not what.
- Code style: `javascript/CLAUDE.md` applies.
