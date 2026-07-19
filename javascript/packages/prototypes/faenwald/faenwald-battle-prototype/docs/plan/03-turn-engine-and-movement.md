# M3 — Turn engine & movement

Goal: the battle-active page exists as the agreed 3-column workspace; units activate in order and move.
No combat yet (attack button disabled).

## State (types.d.ts + `ACTIVE_BATTLE_MODULE.create`/`startBattleDisposition`/`startBattle`)

- `ActiveBattleUnit` += `facing` (0-5 vertex orientation), `movePoints`, `mpCarry` (accumulation),
  `hasAttacked`, `accelerated`, `freeRotationUsed`, `ammo`, `cooldown`, `routed`, `isRulerUnit`.
- `ActiveBattle` += `round`, `activeGroup` (from `createActiveUnitGroup`), `activeUnitId`,
  `actedUnitIds` (this group activation), `log: string[]`.

## Pure helpers (new flat-export modules, each with a co-located test)

- `hex-facing.js` — vertex-facing math on the pointy-top odd-r grid: `frontHexes/flankHexes/rearHexes
  (position, facing)`, `zoneOf(attackerPos, attackerFacing, targetPos)`, neighbor iteration.
- `movement-cost.js` — `advanceCost(fromTerrain, toTerrain, unitType)` combining `entryCost` (per
  terrainClass), `occupantMoveCostMult` of the exited hex, `speedCap`/`speedDelta`.
- `turn-order.js` — `unitActivationOrder(units, group)`: group members, speed desc, tie by id.

## Mutators (ACTIVE_BATTLE_MODULE)

- `startBattle` additionally seeds `round = 1`, `activeGroup = createActiveUnitGroup(units)`, first
  `activeUnitId`, resets per-activation fields.
- `advanceUnit(state, targetPos)` — must be one of the 2 front hexes, unoccupied, not impassable;
  spends MP incl. accumulation (partial cost carried in `mpCarry` per the doc).
- `rotateUnit(state, facing)` — any orientation for 1 MP; free once per activation for `heavy` types.
- `accelerate(state)` — once per activation: −10 morale, remaining MP ×2; forbidden for cavalry in forest.
- `endActivation(state)` — next unit in group order; group exhausted → `nextActiveUnitGroup`, all groups
  done → `round += 1`. Every mutator appends a log line.

## Pages

- **battle-disposition**: facing picker for the placed unit (default: toward the enemy edge) + ruler crown
  toggle (at most one per side, optional). Both stored on the ActiveBattleUnit at placement.
- **battle-active**: the agreed workspace — left: round, group queue, active-unit card (MP/ammo/morale);
  center: hex canvas reusing `hex-layout`/`hexagon-render`/abstract-canvas exactly as battle-disposition
  does, drawing units with facing indicators; right: hover/target info + log; footer: rotate handles
  toggle, accelerate, end activation, capitulate (stub until M4). Active unit highlighted; front hexes
  click-to-advance; 6 orientation handles for rotation. Scoped style block, unique prefix, tokens only.

## Done when

- Helper + mutator tests green (facing partition 2/2/2, costs incl. accumulation, order, group/round
  advance).
- `/verify`: place armies with facings → start → units activate strictly in order, move/rotate/accelerate
  within MP, rounds advance, log fills.
