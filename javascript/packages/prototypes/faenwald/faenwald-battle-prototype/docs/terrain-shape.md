## TerrainDef (`data/terrains.js`, JSDoc typedef; defaults omitted)

```js
/**
 * @typedef {Object} TerrainDef
 * @property {string} id
 * @property {string} name                  // RU display name
 * @property {string} color                 // tokens.css semantic token
 * @property {string} [description]         // RU rules summary from §1.4, for tooltips
 * @property {0|1|2} [elevation]            // default 0; foothills 1, hills 2
 * @property {boolean} [impassable]         // mountain, water; also ⇒ flank cover for сомкнутый строй
 * @property {number} [occupantMoveCostMult] // exit-side: mud 2, swamp 3, road 0.5
 * @property {number|ByClass} [entryCost]   // thicket { base: 1, cavalry: 2 }
 * @property {ByClass} [speedCap]           // forest { cavalry: 1 }
 * @property {ByClass} [speedDelta]         // settlement { cavalry: -2 }
 * @property {number} [rangedDamageTakenMult] // thicket 0.75, forest 0.5
 * @property {boolean} [blocksDirectLos]    // forest, mountain
 * @property {boolean} [blocksArcFire]      // mountain
 * @property {boolean} [noArcTarget]        // settlement
 * @property {Object} [crackChance]         // ice: {infantry:{light:.05,medium:.05,heavy:.10}, cavalry:{light:.15,medium:.15,heavy:.25}}
 * @property {string} [frozen]              // water → 'ice'
 * @property {string} [wet]                 // plain → 'mud'
 * @property {string[]} [specialRules]      // coded-rule tags: forestArchery, bogCombat, settlementMods, iceCrack, noCavalryBoost
 */
```

## Derived in the engine, not stored

- Climb: `to.elevation > from.elevation → entry ×2`
- Elevation damage: delta +1 → ×1.25/×0.75, +2 → ×1.5/×0.5
- Archer range bonus: `+shooter.elevation`
- `moveCost(unit, from, to) = from.occupantMoveCostMult × entryCost(unit, to) × climbMult(from, to)`; `speedCap`/`speedDelta` applied at turn start
- Flank cover = `impassable` or map edge

## Ripple effects (agreed)

- **UnitType** gains `weight: light|medium|heavy` and `terrainClass: infantry|cavalry` (horse archers = cavalry for terrain)
- **battleConfig** gains `season`/`ground`; setup swaps ids via `frozen`/`wet` links; author may also paint mud/ice directly
- **Map format unchanged** — `cells` stays `string[][]` of terrain ids; battle-time divergence (cracked ice) lives in battle runtime state
- Irregular rules stay coded, registered by `specialRules` tag; defs stay editor-readable

One doc ambiguity left open for a judge/design call (doesn't affect the shape): settlement's "копейщики +5% бонуса за сомкнутый строй" — whether ×0.8→×0.75 or a flat +5% — lives inside the `settlementMods` coded rule.