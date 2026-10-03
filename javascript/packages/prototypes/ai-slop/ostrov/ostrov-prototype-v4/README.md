# Toxic Island — `@hw/ostrov-prototype-v4`

A turn-based prototype of a floating hex island that poisons itself. The player builds on the island, collects
the payout, flies the island across a globe of 92 cells and clears the ground it lands on. Toxicity is the
antagonist: it grows with every building, cuts the payout of the hex it sits on, kills the hex at 100, and turns
citizens into 🤖 insane ones who eat twice as much and riot.

One turn runs four phases in a fixed order:

1. **build** — arm a building card and place it on a legal hex, or demolish a building or a whole hex
   (island page);
2. **tax** — the payout flies along beziers into the HUD, then, exactly 350 ms after the last glyph lands,
   toxicity turns part of the population insane, upkeep is eaten, research advances and a riot may fire
   (island page);
3. **exploration** — fly the island one cell, reveal a dark neighbour for 🔭, or stay and pour the island's
   whole toxicity into the cell's trail, which rolls a trail event (world page);
4. **clearing** — a real-time top-down level: steer the island with `WASD`, the units auto-fight, and an enemy
   island whose defenders are dead is absorbed when the player island flies over it (battle page).

Three AI players are rows in the list and nothing more: their counters advance on a seeded rule and their
islands are readonly.

## Stack

React 19 + rspack + TypeScript + `@preact/signals-react`, three.js for the globe, plain canvas 2D everywhere
else. The architecture is the monorepo default (`@hw/frontend-plain-architecture-v2`), copied rather than
depended on.

```
main.tsx  →  createStore()  →  createRegistry(store)  →  <StoreProvider><App registry={…} /></StoreProvider>
```

- `src/store/` — signal slices, state only. `TStore` is written by hand.
- `src/domain/` — actions `(store, …args) => void`; `registry-creator.ts` binds the store into them;
  `registry.ts` is the hand-written public contract of the domain layer.
- `src/core/` — the pure model and the rules, no React. `src/core/exports.ts` is its only public surface.
- `src/ui/` — components read the store through `useStore()` and change it only through `registry`.
- `src/dev/dev-hook.ts` — `window.__ostrov`, the handle the probe drives.

## Commands

Run them with cwd `javascript/`.

| command | what it does |
| --- | --- |
| `yarn workspace @hw/ostrov-prototype-v4 dev` | rspack dev server on an OS-picked free port |
| `yarn workspace @hw/ostrov-prototype-v4 build` | writes `dist/` (about 1.2 MB) |
| `yarn workspace @hw/ostrov-prototype-v4 typecheck` | `tsc --noEmit` over `src/` and `scripts/` |
| `yarn workspace @hw/ostrov-prototype-v4 smoke` | 26 pure-model checks of `src/core/`, no browser |
| `yarn workspace @hw/ostrov-prototype-v4 probe` | 38 browser checks over the built `dist/` |
| `yarn workspace @hw/ostrov-prototype-v4 serve` | serves a built `dist/` on port 8401 |

`probe` and `serve` need `dist/`, so run `build` first — the probe never builds by itself. The probe serves
`dist/` with `python3 -m http.server 8401`, drives headless chromium through `window.__ostrov`, prints one
`PASS`/`FAIL` line per check and a final `PASS n/n`, and exits non-zero on the first failure. It refuses to
start when something else already listens on 8401. Screenshots go to `$PROBE_SHOT_DIR`.

## Pages

The hash is the whole route; one `hashchange` listener lives in `main.tsx`.

| hash | page | what is on it |
| --- | --- | --- |
| `#/` | main menu | title, nickname input, `Начать` |
| `#/island` | own island | island canvas, player list, turn pill, resources, demolish and tech icons, buildings panel, end-turn medallion |
| `#/island/:playerId` | another player's island | canvas, player list, turn pill, end turn, back button; every build control is gone |
| `#/world` | global map | the three.js globe, the cell panel, the event modal |
| `#/battle` | clearing level | the battle canvas, the HUD, `Отступить` |

## Dev hook

`window.__ostrov` is always installed. `state()` is a plain JSON snapshot, so nothing signal-shaped crosses the
bridge.

```
store, registry
state()                       → { turn, phase, busy, route, resources, players, island: { hexes },
                                  camera, anim: { flights, taxStage, lastLandingMs, insaneAtMs },
                                  world: { cells, islandCellId }, battle, researching, researched,
                                  researchProgress, log }
navigate(target, playerId?)   — a page name ("island") or a whole hash ("#/island/p2")
endTurn()                     — advances one phase
fastForward()                 — ends the tax animation synchronously, keeping the 350 ms gap
setResources(patch)           — merges into game.resources
placeBuilding(hexId, id)      — the build action
seed(n)                       — pins the seed; only before startGame
killAllEnemies()              — drops every enemy unit to 0 hp
stepBattle(ticks)             — runs whole 100 ms ticks with the island flying right
addResearch(science)          — adds 📖 to the tech in research and completes it
setResearchTarget(techId)     — the tech modal's action; the same id again cancels
revealCell(id) / moveIsland(id)
firstHexWithBiome(biome)      → the first empty hex of that biome on the human island, or null
```

## Docs

- `docs/01-spec.json` and `docs/01-spec-images/` — the whiteboard spec this is built from.
- `docs/analysis/00-plan.md` — the implementation plan: game decisions, architecture, subtasks, acceptance.
- `docs/analysis/01..08-*.md` — one report per subtask, the contract each one left behind.
- `CLAUDE.md` — the trap list. Read it before changing anything here.

## Conventions

`javascript/CLAUDE.md` applies to every file: semicolons, braces on every `if` and loop, double quotes only,
one grouped named export at the end of the file, one CSS declaration per line. Type names start with `T`,
factories with `create`. Actions read with `.peek()` and write with `.value =`; components call `useSignals()`
first. Exact dependency versions, never `^`; workspace dependencies spell out `workspace:*`.
