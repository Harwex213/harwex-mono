# S6 — world globe and exploration

The exploration phase: the 92-cell globe in three.js, cell picking, reveal / fly / stay, the toxic trail and
its events. `yarn workspace @hw/ostrov-prototype-v4 typecheck` and `build` both exit 0 with S5's tax files in
the tree.

## 1. Files

New:

```
src/domain/world-actions.ts
src/ui/world-globe/globe-mesh.ts
src/ui/world-globe/world-globe.tsx
src/ui/components/cell-panel.tsx
src/ui/components/event-modal.tsx
```

Taken over: `src/ui/pages/world-page.tsx` (the S1 stub is gone; the page no longer exports a registry slice
type, nothing imported it).

Edited, additively only: `src/store/ui-state.ts`, `src/domain/registry.ts`, `src/domain/registry-creator.ts`,
the `tax → exploration` branch of `endTurnAction` in `src/domain/game-actions.ts`, and one appended block at
the end of `src/ui/app.css`. Nothing of S5's was touched.

## 2. Registry additions

```ts
type TSelectCellAction = (cellId: number | null) => void;
type TRevealCellAction = (cellId: number) => void;
type TMoveIslandAction = (cellId: number) => void;
```

bound in `registry-creator.ts` as `selectCell`, `revealCell`, `moveIsland` from
`selectCellAction`, `revealCellAction`, `moveIslandAction`.

`world-actions.ts` also exports three pure helpers the UI reads directly, because a `computed` would have to
live in `store.ts` and that file is not mine:

```ts
cellDistance(cells: readonly TWorldCell[], fromId: number, toId: number): number   // -1 when unreachable
cellsWithinDistance(cells: readonly TWorldCell[], fromId: number, maxDistance: number): readonly number[]
moveRangeFor(researched: readonly TTechId[]): number    // 1, or 2 with levitation
revealCostFor(researched: readonly TTechId[]): number   // 2, or 1 with star_charts
applyTrailEventAction(store: TStore, event: TTrailEvent | null): void
beginExplorationAction(store: TStore): void
```

## 3. `ui-state` additions

Two signals, both additive, both initialised in `createUiState`:

```ts
readonly selectedCellId: Signal<number | null>;   // null
readonly explorationMoved: Signal<boolean>;       // false
```

## 4. The exploration rules as implemented

**When the phase opens.** The `tax → exploration` branch writes the phase, appends its log line, navigates to
`#/world` and then calls `beginExplorationAction`. That order matters: the log entry and the event modal read
the phase back.

`beginExplorationAction` clears `explorationMoved` and `selectedCellId`, then adds
`derived.toxicityPoints` to the trail of `islandCellId` (spec node-51) and logs it when the total is above
zero. It then rolls once against the *new* trail with `arrivedUnrevealed = false`.

**The trail grows** in exactly two places: at the start of the phase, by the island's whole toxicity, and
downward by 5 when the `empty` event fires. Flying adds nothing to the destination, so staying is the only way
to poison a cell — that is the choice spec node-50 asks for.

**Events roll** twice per turn at most: once at phase start, and once on arrival after a flight, against the
destination's trail with `arrivedUnrevealed` set when the destination was dark. `rollTrailEvent` itself returns
`null` when the trail is 0, so turn one is always quiet.

**Effects** (plan §3.6), all using the constants S2 exported:

| event | effect |
| --- | --- |
| `bandits` | food and stone each lose `max(1, floor(amount * 10 / 100))`, never more than the player holds; a resource at 0 loses nothing |
| `undead` | `pendingEnemies += 2` |
| `insane_growth` | `min(3, population)` citizens become insane |
| `garbage_worm` | a random hex from `builtHexIds` takes `+15 ☣️` through `addToxicity`; when it already stood at 85 or more, `setBuilding(…, null)` destroys the building |
| `empty` | the current cell loses 5 trail |

Every effect writes the modal (`ui.eventModal`) and one log line naming what it cost.

**Reveal** demands the exploration phase, a neighbour of `islandCellId`, an unrevealed target and
`2 🔭` (`1` with `star_charts`). Each refusal raises a toast and changes nothing.

**Flight** demands the exploration phase, `explorationMoved === false` and a BFS distance of 1 over
`neighbours` (2 with `levitation`). It calls `moveOccupant`, then `revealCell` on the destination, writes
`islandCellId`, sets `explorationMoved`, selects the destination, logs the flight, and rolls the arrival event.

**Determinism.** Every roll comes from `createRng(seed + turn * 1000 + 7 + salt)`: salt `0` at phase start,
`1 + cellId` on arrival, `500` for the garbage worm's pick. The salt is the one deviation from the brief's
formula, and it exists so the phase-start roll and an arrival roll in the same turn are not the same draw.

## 5. DOM hooks

| element | class | note |
| --- | --- | --- |
| page root | `world-page` | full viewport, the globe behind the panels |
| canvas slot | `world-page__canvas-slot` | `position: absolute; inset: 0` |
| the globe | `canvas.world-globe` | the WebGL canvas, `aria-label="Глобальная карта"` |
| cell panel | `panel cell-panel` | top right, only while `ui.selectedCellId` is set |
| close | `cell-panel__close` | clears the selection |
| rows | `cell-panel__title`, `cell-panel__biome`, `cell-panel__swatch`, `cell-panel__biome-name`, `cell-panel__row`, `cell-panel__row-label`, `cell-panel__row-value`, `cell-panel__row-value--toxic` | |
| buttons | `cell-panel__reveal`, `cell-panel__move` | "Разведать (N 🔭)" and "Лететь", `disabled` when the rule refuses |
| hints | `cell-panel__hint`, `cell-panel__here` | the stay cost, and "Остров стоит здесь" |
| event modal | `event-modal__backdrop`, `event-modal`, `event-modal__title`, `event-modal__text`, `event-modal__ok` | rendered by the world page only |
| toast | `world-page__toast` | same look as the island page's |

`TurnPill`, `PlayersPanel`, `ResourcesPanel` and `EndTurnPanel` are reused as they are, so every panel sits at
the island page's position and carries the island page's classes.

## 6. The globe

`globe-mesh.ts` is a pure builder: `createGlobeMesh(cells)` returns `{ group, cellMeshes, dispose }` with
`cellMeshes[cell.id]` the tile of that cell, and `updateGlobeColours(handle, cells, selectedCellId)` repaints
the materials without rebuilding a single buffer. A tile is a fan around the cell centre plus a skirt down to
`0.97`, flat-shaded `MeshStandardMaterial`, coloured by `BIOMES[biomeHint].colours[0]`, grey `#555b66` while
unrevealed, lerped toward `--toxic` by `min(1, trail / 50)`, and given a gold emissive while selected. One
`LineSegments` carries every cell outline.

`world-globe.tsx` owns the renderer, the camera, the starfield (800 seeded points at radius 40), the island
badge sprite, a pool of 24 pulsing reachable rings (green over a revealed cell, amber over a dark one), the
`Raycaster`, the RAF loop and one `effect()` that re-syncs colours, badge and rings from the signals. Drag
orbits with a clamped polar angle, the wheel dollies between 1.6 and 6, and a press under 4 px and 300 ms
raycasts against `cellMeshes` and calls `selectCell` — with `null` when it hits nothing. The camera is aimed at
the island cell on mount. The cleanup cancels the RAF, stops the signal effect, disconnects the
`ResizeObserver`, removes all four listeners, disposes every geometry, every material, the sprite texture and
the renderer.

## 7. Self-check

A throwaway Playwright script (1.61.1, the installed chromium, `--use-gl=swiftshader
--enable-unsafe-swiftshader`) against `python3 -m http.server 8402 --directory dist`, driving the real UI —
"Начать", then the end-turn medallion twice, waiting for it to be enabled again between clicks so S5's tax
animation is not cut short:

```
PASS route is #/world — #/world
PASS canvas.world-globe with a WebGL context — {"found":true,"ctx":"ok","w":1440,"h":900}
PASS event modal — no event this phase
PASS a click on the globe opens .cell-panel — ×Гекс №0Горы…Расстояние0…
PASS the panel names the island cell — the island cell is picked
PASS a neighbour offers Лететь — ×Гекс №10Бесплодные земли…Расстояние1…
PASS the island flew there — ×Гекс №10…ЗанятИгрок…Расстояние0
PASS a second flight is refused — Лететь is disabled
PASS Разведать spends 2 🔭 — 4 → 2
PASS no console or page errors — clean
ALL PASS
```

Screenshots, all looked at with the Read tool:

```
<scratchpad>/s6-02-globe.png        the globe as the phase opens
<scratchpad>/s6-03-cell-panel.png   the island cell picked, the panel open
<scratchpad>/s6-04-neighbour.png    a neighbour picked, Лететь enabled
<scratchpad>/s6-05-after-move.png   the island one cell further on
<scratchpad>/s6-06-after-reveal.png a scouted cell, amber rings over the dark ones
```

`<scratchpad>` is
`/private/tmp/claude-501/-Users-aleh-kaportsau-Projects-harwex-mono-worktrees-ostrov-prototype-01/53d19bd8-02b6-407f-af32-23464242a9f6/scratchpad`.

The first pass drew a faceted globe, because a fan of triangles whose corners all sit on the unit sphere gives
every triangle its own normal. The corners are now lifted onto the tangent plane at the cell centre, so a tile
is one flat plate. The badge was a green ring on the first pass and read as one more reachable ring; it is now
a filled disc in the player colour with a gold rim and a dark hex glyph.

`dist/` and the temporary script were deleted, port 8402 was released and `<scratchpad>/s6-browser-done` was
created.

## 8. Deviations

1. **The rng carries a salt.** The brief's `createRng(seed + turn * 1000 + 7)` would give the phase-start roll
   and an arrival roll in the same turn the identical draw. `+ 0`, `+ 1 + cellId` and `+ 500` keep them apart
   and stay deterministic.
2. **Three helpers are imported from `src/domain/world-actions.ts` into two components.** `cellDistance`,
   `moveRangeFor` and `revealCostFor` are pure functions of the cells and the tech list. The alternative was a
   `computed` in `src/store/store.ts`, which S6 does not own.
3. **One `LineSegments` for all 92 outlines**, not one per cell. It draws exactly the same picture in one call.
4. **The reachable rings come from a fixed pool of 24 meshes**, shown and hidden rather than created and
   destroyed. Eighteen is the most a levitating island can reach, and a pool has nothing to leak.
5. **The reveal and flight actions both require the exploration phase.** The brief spells that out for the
   flight only; a reveal outside the phase makes no sense either, and the refusal is a toast.
6. **No cell is preselected when the phase opens.** Preselecting the island cell would make "a click opens the
   cell panel" pass without a click ever being delivered.
7. **The world page renders its own toast** (`world-page__toast`), because every refusal in this phase raises
   one and the island page's toast is not on screen.
