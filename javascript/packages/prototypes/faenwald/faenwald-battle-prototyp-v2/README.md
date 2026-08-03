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

## Оппортун

Walking within reach of the enemy is paid for. A step hands the enemies who cover the
hexes it runs between a swing of their own, taken out of turn. Three things provoke one:

- **Leaving.** The unit is about to step off its hex. Everybody who could strike it
  there swings first, and the step is held back until the last of them has answered.
- **Arriving, by bow.** The unit has landed on its new hex. Every shooter whose cone
  covers that hex looses at once.
- **Arriving, by hand.** The same landing, answered by a melee enemy — which waits until
  the unit's whole turn is over and swings as it closes. A unit that stood still all
  turn provokes nobody.

An enemy gets one swing per turn of the unit that provoked it, whichever trigger handed
it out. That is why the second and third triggers are only ever answered by somebody the
unit walked *into* reach of: an enemy that already covered the hex it set off from has
spent its swing on the first trigger.

While a swing is open the board belongs to the enemy holding it. A panel over the board
says so, the turn order bar puts a card in front of the round for every enemy still to
answer — each under the word the mechanic is named after — and the two units the swing
stands between are ringed in a beating red. Every order the local player has is muted.
Two things end it: the blow, clicked on the unit under the ring, or the button under the
roster, which is that enemy letting the swing go. Either way the swing is spent, and the
step or the end of turn it was holding back happens next.

`battle-state.ts` holds all of it. A swing costs the enemy nothing of its own turn, and
the reach it is read against is the enemy's ordinary attack — so an Оппортун is a blow
the unit could have landed anyway, taken at a moment it does not own.

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
