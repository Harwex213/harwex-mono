# M2 — Data enrichment (terrains & unit types)

Goal: the static data carries every field the runtime milestones consume. Pure `data/` + `types.d.ts`
changes; no behavior yet. Follow `docs/terrain-shape.md` exactly for TerrainDef.

## Tasks

1. **`data/terrains.js`** — extend each terrain to the TerrainDef shape from `docs/terrain-shape.md`,
   populating the fields this iteration consumes (values per `docs/faenwald-cf-boevaya-sistema.md` §1.4):
   - `impassable` (mountain, water) — note: this **renames** today's inverted `passable` flag; update the
     existing consumers (map editor, disposition placement).
   - `elevation` (0 plain / 1 foothill / 2 hill), `entryCost` (thicket: `{ base: 1, cavalry: 2 }`),
     `occupantMoveCostMult` (bog ×3, road ×0.5), `speedCap`/`speedDelta` where the doc gives them
     (forest cavalry, settlement cavalry −2).
   - `rangedDamageTakenMult` (thicket ×0.75, forest ×0.5), `blocksDirectLos` (mountain),
     `blocksArcFire`, `noArcTarget` (settlement).
   - Skip: `crackChance`, `frozen`/`wet` (season/ground deferred).
2. **`data/unit.js`** — add per-type fields:
   - `terrainClass`: `"cavalry"` for the three cavalry tiers + horse archer; `"infantry"` otherwise.
   - `heavy: true` on the three heavy tiers (free-rotation rule, M3).
   - `ranged`: `{ arc: {range: 4, mult: 1}, direct: {mult: 2}, meleeMult: 0.5, shots: 8 }` on archer,
     horse-archer, longbowman; crossbowman gets `arc: null`, `cooldown: 2`. Implementer: confirm the
     exact direct-fire range semantics against the doc's «Дальняя атака» section (~lines 265-284)
     before hardcoding.
   - `ramModifier`: 8/16/24 on light/medium/heavy cavalry (charge, M6).
   - `maneuverable: true` on cavalry + horse archer (move after attack, M6).
3. **`modules/types.d.ts`** — update `TerrainDef` and `UnitType` ambient types to match; keep field docs
   one-liners.

## Done when

- `yarn test` passes; existing pages (map editor, creation, disposition) still work under `/verify` —
  especially the `passable → impassable` rename has no leftover readers (grep for `passable`).
