# S2 — core model

Pure TypeScript, no React, no DOM, no canvas. Every stub in `src/core/exports.ts` now has a body, and
`exports.ts` itself is a re-export barrel. No existing name or signature changed.

## 1. Modules

| file | purpose |
| --- | --- |
| `src/core/types.ts` | the data model; two fields added, see §4.1 |
| `src/core/rng.ts` | seeded mulberry32 plus a string hash for pure functions that hold no state |
| `src/core/hex.ts` | the only hex layout math in the prototype: pointy-top axial, cube rounding, corners, neighbours |
| `src/core/biomes.ts` | the 16 spec biomes with a Russian name, a two-stop gradient, a glyph and a best-building hint |
| `src/core/buildings.ts` | the 7 buildings, the spec yield tables verbatim, plan §3.5 costs, affordability and legal hexes |
| `src/core/techs.ts` | the 8 techs of plan §3.3 with costs, prerequisites and Russian descriptions |
| `src/core/toxicity.ts` | the toxic economy: hex yields, tax yields, the insane conversion, upkeep, riots, mana |
| `src/core/island-gen.ts` | island generation and every pure edit the store makes to an island |
| `src/core/world-gen.ts` | the Goldberg dual of a frequency-3 icosahedron: 92 cells, and the pure cell edits |
| `src/core/events.ts` | the toxic trail event roll of plan §3.6 and the constants its effects need |
| `src/core/battle-sim.ts` | the clearing phase: level setup, the 100 ms tick, footprints and absorption |
| `src/core/exports.ts` | the barrel; the only file the layers above import from |
| `scripts/core-smoke.ts` | 26 self-checks, `yarn workspace @hw/ostrov-prototype-v4 smoke` |

## 2. New exports beyond the stub contract

Every name below is additive; nothing in the S1 contract moved.

**`rng.ts`**

- `hashString(text: string): number` — stable 32-bit FNV hash.
- `hashUnit(text: string): number` — the same hash in `[0, 1)`; the battle wander uses it instead of state.

**`hex.ts`**

- `parseHexId(id: string): TAxialCoord | null` — the exact inverse of `hexId`.
- `hexDistance(aq: number, ar: number, bq: number, br: number): number`
- types `TAxialCoord = { q: number; r: number }`, `TPixelPoint = { x: number; y: number }`.

**`biomes.ts`**

- `BIOME_ORDER: readonly TBiomeId[]` — the 16 biomes in spec node-43 order.

**`buildings.ts`**

- `DEAD_HEX_TOXICITY = 100` — the toxicity at which a hex produces nothing and takes no building.
- `biomesForBuilding(building: TBuildingId): readonly TBiomeId[]` — for the card tooltip.

**`techs.ts`**

- `isTechAvailable(tech: TTechId, researched: readonly TTechId[]): boolean` — not yet researched and every
  prerequisite done.

**`toxicity.ts`**

- `applyYields(resources: TResources, yields: readonly TYieldEntry[]): TResources`
- `manaIncome(science: number): number` — `1 + floor(science / 10)`.
- `insaneMultiplier(insane: number): number` — `max(0.5, 1 - 0.02 * insane)`.
- `riotChancePercent(resources: TResources): number` — what `rollRiot` rolls against; `0` when no riot is possible.
- `FARM_DEAD_TOXICITY_PERCENT = 50`, `TOXICITY_FULL_PERCENT = 100`.

**`island-gen.ts`**

- `addHexesToIsland(island: TIsland, hexes: readonly THex[]): TIsland`
- `removeHex(island: TIsland, targetHexId: string): TIsland`
- `setBuilding(island: TIsland, targetHexId: string, building: TBuildingId | null): TIsland`
- `addToxicity(island: TIsland, targetHexId: string, delta: number): TIsland` — clamped to `0..100`.
- `builtHexIds(island: TIsland): readonly string[]`
- `MIN_START_HEX_COUNT = 12`, `MAX_START_HEX_COUNT = 20`, `MAX_ISLAND_HEX_COUNT = 25`,
  `MIN_ISLAND_HEX_COUNT = 7` (the demolition floor of plan §3.2).

**`world-gen.ts`**

- `WORLD_START_CELL_ID = 0`
- `revealCell(cells: readonly TWorldCell[], cellId: number): readonly TWorldCell[]`
- `moveOccupant(cells: readonly TWorldCell[], fromId: number, toId: number, occupantId: string): readonly TWorldCell[]`
- `addTrail(cells: readonly TWorldCell[], cellId: number, delta: number): readonly TWorldCell[]` — the trail never
  goes below 0.
- `WORLD_CELL_COUNT = 92`, `PENTAGON_CELL_COUNT = 12`.

**`events.ts`**

- `trailEventChancePercent(trail: number, arrivedUnrevealed: boolean): number`
- the effect constants the store applies: `BANDIT_LOSS_PERCENT = 10`, `BANDIT_MIN_LOSS = 1`,
  `UNDEAD_EXTRA_ENEMIES = 2`, `INSANE_GROWTH_COUNT = 3`, `GARBAGE_WORM_TOXICITY = 15`,
  `GARBAGE_WORM_DESTROY_TOXICITY = 85`, `EMPTY_TRAIL_RELIEF = 5`, `MAX_EVENT_CHANCE_PERCENT = 60`.

**`battle-sim.ts`**

- `UNIT_STATS: Readonly<Record<string, TUnitStats>>` with
  `TUnitStats = { hp: number; dmg: number; range: number; speed: number; air: boolean }` — 26 kinds.
- `BATTLE_WORLD_W = 1600`, `BATTLE_WORLD_H = 1200`, `BATTLE_TICK_MS = 100`,
  `BATTLE_HEX_SIZE_PX = 24`, `PLAYER_ISLAND_SPEED_PX_S = 120`, `PLAYER_ISLAND_ID = "player"`.
- `islandHexCentres(island: TBattleIsland): readonly { x: number; y: number }[]` — the footprint, for the renderer.
- `islandsOverlap(left: TBattleIsland, right: TBattleIsland): boolean`

## 3. Smoke output

`yarn workspace @hw/ostrov-prototype-v4 smoke`, exit 0:

```
PASS island size is 12..20 — 20 hexes
PASS island is connected — 20 reached
PASS island can host a farm, a sawmill and a mine on turn one — farm 4, sawmill 4, mine 12
PASS world has 92 cells — 92 cells
PASS world has 12 pentagons and 80 hexagons — 12 / 80
PASS every world neighbour relation is symmetric
PASS the start cell holds p1 and is revealed with its neighbours
PASS every building yield table matches the spec
PASS spot values farm/swamp 5-3, mine/volcano 10-5, sawmill/rainforest 8-4, village/badlands 1-4, university/cliffs 1-0
PASS 16 biomes, 7 buildings, 8 techs
PASS a clean grassland farm yields 4 food — 4
PASS a farm at 50 toxicity yields 0 food — 0
PASS a hex at 100 toxicity yields nothing
PASS irrigation adds 1 food to a farm — 5
PASS scrubbers and deep shafts give a volcano mine 12 stone at 5 toxicity — 12/5
PASS insane conversion is floor(points / 10), capped by population — 4 then 6
PASS upkeep eats 1 food per citizen and 2 per insane, then starves — 10, then 1 left and 4 insane
PASS the insane halve hammers but never food
PASS applyYields adds amounts and toxicity — 24 food, 2 toxicity
PASS island toxicity points sum the hexes
PASS the same seed reproduces and a different seed does not
PASS createIsland is deterministic
PASS pixelToHex inverts hexToPixel for q,r in -5..5
PASS a trail of 40 fires an event sometimes and not always — 108 of 200
PASS 300 ticks with the enemies removed absorb at least one island — 1 of 2 absorbed, 16 hexes
PASS the battle reports itself finished once no enemy lives
ALL PASS
```

Checks run outside the script, on a scratch file: 300 seeds of `createIsland` all produce 12 to 20 connected
hexes that can host a farm, a sawmill and a mine; `addHexesToIsland` stops at 25 and keeps the blob connected;
every one of the 92 cells is on the unit sphere with its corners wound counter-clockwise seen from outside;
ten `stepBattle(state, 10, …)` calls produce exactly the same units as one `stepBattle(state, 100, …)`.

`yarn workspace @hw/ostrov-prototype-v4 typecheck` exits 0 — no diagnostics anywhere, including `src/store`,
`src/domain` and `src/ui`. `scripts/core-smoke.ts` is outside the tsconfig `include`, so it was checked
separately with the same compiler flags plus `--types node`: clean.

## 4. Decisions taken beyond the plan

### 4.1 Two fields added to existing types

Both are required, because nothing outside `src/core` builds either object today (only
`src/store/game-state.ts` holds a `Signal<TBattleState | null>` initialised to `null`).

- `TUnit.homeIslandId: string` — the battle island the unit wanders around. A unit needs it to wander
  when no hostile is in range, and deriving it from the nearest island breaks once the player island flies over
  an enemy one.
- `TBattleState.absorbedHexes: readonly THex[]` — `stepBattle` stays pure and only collects the hexes of every
  absorbed island. **The store must append them with `addHexesToIsland` itself**; the battle never edits
  `TIsland`. The array is cumulative, not a per-step delta.

### 4.2 `stepBattle` keeps simulating after `finished`

`finished` is `true` when every enemy island is absorbed or when no enemy unit lives. It does not stop the
simulation: the player may still fly across a dead island and absorb it, which is exactly what plan §6 asks the
probe to verify. The caller decides when to leave the level.

### 4.3 Battle hex size is 24 px, not `HEX_SIZE_PX`

At 56 px a 20-hex island spans about 500 px, and four of them plus a 400 px separation do not fit in
1600×1200. The footprint uses `hexToPixel(q, r, BATTLE_HEX_SIZE_PX)` with `BATTLE_HEX_SIZE_PX = 24`.
The island page keeps `HEX_SIZE_PX = 56`.

### 4.4 Enemy count is per island

Plan §3.8 says `3 + floor(turn / 2)` enemies **per island**, capped at 12; the `extraEnemies` from trail events
are added after the cap, on every island. Enemy HP is multiplied by `1 + 0.1 * floor(turn / 5)` and rounded.

### 4.5 Cavalry names

The spec repeats the ranged list for cavalry, so `UNIT_STATS` holds `конный пращник`, `конный лучник`,
`конный длинный лучник` and `конный мушкетёр` at +25% HP (rounded) and +50% speed, same damage and range.
Nothing spawns them yet; they are there for later waves.

### 4.6 Tech bonuses are flat and land after the toxicity scaling

`hexYield` scales the spec amount by `1 - toxicity / 100`, then adds the flat tech bonus, then applies the
"a farm at 50 or more toxicity produces nothing" rule. So irrigation does not revive a poisoned farm.
Scrubbers subtract from the toxicity the building adds, floored at 0; `deep_shafts` adds its `+1` before
scrubbers subtract, which is why a volcano mine with both reads 12 stone at 5 toxicity.

### 4.7 The starting island guarantees a mine biome, not just a rocky one

The brief asks for at least one of mountains, hills or cliffs, but a mine cannot go on hills. The generator
therefore guarantees at least one of **mountains or cliffs** — a subset, so the looser rule holds too — plus
two of grassland/plains and one of forrest/taiga/rainforest/savanna. Biomes cluster because a new hex copies a
neighbour's biome 62% of the time.

### 4.8 `addHexesToIsland` relocates every hex it appends

Absorbed hexes come from another island's coordinate space and would collide or float away. Each one keeps its
biome, building and toxicity but is moved to the first free cell touching the island, so the blob stays
connected. Growth stops at 25 hexes.

### 4.9 `moveOccupant` does not reveal the destination

It only moves the occupant. Flying into an unrevealed cell is legal (plan §3.7), and the store decides whether
arrival reveals the cell, by calling `revealCell`.

### 4.10 `islandToxicityPercent` averages over the island's hexes

The plan says "the mean over non-empty hexes". `TIsland.hexes` is a sparse record, so every entry in it is a
real hex; the function divides the point total by the number of hexes and returns 0 for an empty island.
