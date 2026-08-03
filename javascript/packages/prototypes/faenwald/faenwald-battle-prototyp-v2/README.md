# @hw/faenwald-battle-prototyp-v2

Faenwald battle prototype, second iteration. React + TypeScript + rspack, state in
`@preact/signals-react`, UI from `@hw/faenwald-uikit`.

Current content, one page per tab:

- **Hex grid** — pointy-top hexes in an odd-r offset layout, drawn as one SVG, with
  click-to-select cells and a pan/zoom canvas.
- **Units disposition** — the local player places a roster on the grid, then moves and
  turns what is already down.
- **Active battle** — both armies deployed, the round in a turn order bar under the
  board, and move/rotate/attack on whichever unit is up. A header over the board opens
  the scenarios drawer, which names the position the battle is fought on.

Two attacks are on offer, one per kind of unit: a melee, which reaches the two hexes
the unit faces, and a canopy shot, which every bow makes instead. A shot is lobbed over
whatever stands in the way and comes down anywhere in the cone in front of the shooter,
four steps deep — `attack-strategies.ts` holds both, and a unit's kind is what picks
between them. The card of a shooter carries a switch that washes that cone over the
board; pointing at a unit inside it draws the flight the shot would take, and committing
it sends an arrow along that same curve.

```bash
yarn workspace @hw/faenwald-battle-prototyp-v2 dev        # rspack dev server, random free port
yarn workspace @hw/faenwald-battle-prototyp-v2 build      # bundle into dist/
yarn workspace @hw/faenwald-battle-prototyp-v2 typecheck  # tsc --noEmit
```

## Signals in components

rspack compiles TSX with swc, so the `@preact/signals-react-transform` Babel plugin is
not in the pipeline. Auto-tracking is therefore unavailable: a component that reads
`someSignal.value` during render must call `useSignals()` from
`@preact/signals-react/runtime` first, otherwise it never re-renders.

```tsx
function UnitCard() {
  useSignals();
  return <span>{round.value}</span>;
}
```

`useSignal`, `useComputed` and `useSignalEffect` install their own tracking and need no
extra call.

## Layout

- `src/App.tsx` — shell: page tabs plus the page currently routed to
- `src/router/` — hash route signal (`#/<page-id>`)
- `src/pages/` — one directory per page; `pages.ts` is the registry, its first entry is
  the default route
- `src/hex/` — hex primitives: layout math (`hex-layout.ts`), the pan/zoom `HexCanvas`,
  and the grid layer drawn inside it
- `src/units/` — the marker layer, the actions panel, and the portrait map
  (`unit-avatars.ts`)
- `src/session/` — panels every page shares, currently the chat
- `src/state/` — signal stores, no React imports
- `src/audio/` — the UI sounds (`sounds.ts`), one element per clip and one function per
  event the board answers with a sound
- `src/*.module.css` — component styles, built on the uikit's `--uk-*` tokens
- `assets/units-avatars/` — 1:1 unit portraits, imported through the `asset/resource`
  rule in `rspack.config.mjs`
- `assets/sounds/` — sound effects, imported through the same rule

## Adding a page

Create `src/pages/<id>/<Name>Page.tsx` and add it to `PAGES` in `src/pages/pages.ts`. The
shell then links to it from the tab bar.

The app fills the viewport and never scrolls: the shell is a flex column, and a page
gets its height from `flex: 1` plus `min-height: 0`. A page that needs more room should
scroll inside its own element, not the body.

`@hw/faenwald-uikit` is consumed from its `dist/`. After editing the kit, rebuild it with
`yarn workspace @hw/faenwald-uikit build`.
