# Battle page implementation — overview

Target: full battle flow `battle-creation → /battle (dispatcher) → units-disposition → active → finished`,
implementing the combat system from `docs/faenwald-cf-boevaya-sistema.md` and the terrain data shape from
`docs/terrain-shape.md`. Decisions below were settled in a design interview and are binding for all milestones.

## Decisions

| Area | Decision |
| --- | --- |
| Scope | Near-full doc: core loop + all three ranged modes + terrain (movement & ranged effects) + all specials except dismount + opportunity attacks (full timing) + ruler (no d3) + full losses math. |
| Deferred | Dismount/mount, baggage-train resupply, season/ground (mud, ice, weight), engineers/medics, ruler d3 outcome, rank II baseline, doc's global per-unit initiative. |
| Turn order | Group cycling via existing `active-unit-group.js` (defender-first `GROUP_CYCLE`). Within the active (side, type) group: strict auto-advance, speed desc, tie by unit id. Player acts only the highlighted unit. |
| Actions | Move (advance into one of 2 front hexes), rotate (1 MP → ANY orientation; heavy units get 1 free rotation/turn), attack (once per activation), accelerate (−10 morale, ×2 remaining MP, once/turn, cavalry not in forest). |
| Facing | 6 vertex orientations on the pointy-top grid: 2 front / 2 flank / 2 rear neighbor partition. Set manually at disposition (default: toward enemy edge). |
| Damage | Attack deals `X` to HP and `X × facing mult` to morale (front ×1, flank ×1.25, rear ×1.5), × terrain/elevation mults, multipliers multiply then round arithmetically, hard cap ×3 of natural damage (exception: cavalry charge morale damage). |
| Movement | `movePoints = speed + carryover`; terrain entry costs (per terrainClass) and multipliers apply; unspent/partial cost accumulates across activations per the doc. |
| Ranged | Doc's three modes (arcing ×1 / direct ×2 / melee ×0.5 + takes ×1.5 morale in melee). 8 shots per battle (arc/direct decrement, melee free), no resupply. Crossbow: no arcing, fires every 2nd turn. |
| Terrain | Adopt `terrain-shape.md` TerrainDef now; implement movement fields (`impassable`, `entryCost`, `occupantMoveCostMult`, `speedCap/speedDelta`) and ranged fields (`rangedDamageTakenMult`, `blocksDirectLos`, `blocksArcFire`, `noArcTarget`, `elevation`). Map cell format unchanged (`cells: string[][]`). |
| Rout | Morale ≤ 0 → unit routs: uncontrollable, auto-flees by shortest path to its own deployment edge during its activation slot, attackable, removed when it exits. Morale shock on death/rout: −10 adjacent, −5 at two hexes; doubled when the lost unit is the ruler's. |
| Ruler | Optional, at most one per side, assigned at disposition (crown). +10 morale aura while alive. On destruction: log event ("resolve d3 offline"), aura ends. |
| Opportunity | Full doc timing: entering an enemy's attack zone triggers a reaction; resolved after the target declares its first action but before execution; opportuner counts as acted (may only rotate afterwards); can't react if it already attacked; a moving unit attacking the opportuner strikes first. |
| Victory | Auto: a side with zero on-field units loses → phase FINISHED. Plus a per-side capitulate action. |
| Losses | Finished page computes: survivors & routed-off-field → casualties = 50% of HP lost; destroyed → 100% of full HP, half of that taken prisoner by the winner. |
| Players | Hot-seat, one screen, no AI. |
| Persistence | ActiveBattle stays in-memory (no localStorage). |

## Architecture

- **Fat `ACTIVE_BATTLE_MODULE`**: all mutators (`moveUnit`, `rotateUnit`, `attack`, `accelerate`, `endActivation`, `capitulate`, `reset`, rout-tick, opportunity resolution) live in `modules/active-battle.js` — it owns the state, per the module pattern.
- **Pure flat-export helpers** (new files in `modules/`): facing zones / hex directions, line of sight, damage math, movement cost, turn order, losses. Plain values in/out; unit-tested with `node:test`.
- `active-unit-group.js` stays flat exports (pure) and supplies the group cycle.
- State shape changes go into `modules/types.d.ts` in the same milestone that introduces them.

## Routing (ground truth = code, not old CLAUDE.md)

- `/battle` = pure phase dispatcher (renders nothing): DISPOSITION → `/battle/units-disposition`, ACTIVE → `/battle/active`, FINISHED → `/battle/finished`, phase null → battle-creation. Uses the `BATTLE_PHASE_ROUTES` map already sketched in `battle.js`.
- The three subroutes get registered in `index.js`; each subpage guards a phase mismatch by `router.replace(ROUTES.BATTLE)`.
- Battle-creation bounces to `/battle` while a battle is in a non-finished phase.
- Page signature: the current `index.js` convention is canonical; the three unwired pages migrate to it.
- CLAUDE.md: remove the fictional `/game` routing and the stale `render*(params, router)` signature text. **CLAUDE.md diffs are API changes — present them to the user for review, not as drive-by edits.**

## Battle-active page UI (agreed)

3-column workspace: left — round counter, group queue, active-unit card (MP / ammo / morale); center — hex canvas; right — hovered/target unit info + scrolling battle log; footer — rotate, fire-mode selector, accelerate, end activation, capitulate. Canvas: active unit highlighted, its 2 front hexes click-to-advance, enemies in attack zone click-to-attack, rotation via 6 orientation handles. Scoped-style block, tokens only, own page prefix.

## Verification

Every milestone: `yarn test` green (helpers + mutators against plain/fake state), then a browser walkthrough with the project `/verify` skill. No milestone is done on self-report alone.

## Milestones

1. `01-routing-and-wiring.md` — dispatcher, subroutes, guards, signature migration, CLAUDE.md cleanup
2. `02-data-enrichment.md` — TerrainDef, unit ranged/ram/terrainClass fields, types.d.ts
3. `03-turn-engine-and-movement.md` — activation loop, MP, rotate/advance/accelerate, terrain costs, accumulation
4. `04-melee-and-morale.md` — attack zones, damage, death, rout & flee, morale shock, victory, capitulate
5. `05-ranged-and-los.md` — three fire modes, ammo, LoS, elevation, crossbow
6. `06-unit-specials.md` — closed formation, breakthrough, charge, maneuverability
7. `07-opportunity-and-ruler.md` — reaction-attack interrupt machine, ruler
8. `08-finished-and-losses.md` — finished page, losses math, log polish
