# Faenwald Battle — Web App Implementation Plan

> A single-sentence-per-step breakdown for building a web app that showcases the
> tactical battle from the [GDD](./gamedesign-doc.md), respecting the project's
> **API → Model → View (MobX)** architecture (see [README](../README.md)).

## 0. Foundations

1. ✅ Scaffold the unit **catalog** (§4) as a typed data table of
   `UnitDef`s (per-100, rank II) so every stat lives in data, not code. — `src/model/catalog.ts`
2. ✅ Implement **axial/cube hex math** (§2.1) — `distance`, `neighbors`,
   `lineDraw`, and direction vectors — as a pure, tested utility. — `src/model/hex.ts`
3. ✅ Model **facing and the three zones** (§2.2) with a
   `zoneOf(attackerHex, defender)` pure function returning front/flank/rear. — `src/model/zones.ts`

## 1. Board, units & rendering (GDD phase 1)

4. ✅ Build an observable `Hex`/board model (§15.1) carrying terrain type, elevation, and transient state (mud/frozen). —
   `src/model/terrain.ts`, `src/model/board.ts`
5. ✅ Build the observable `UnitState` model with `computeEffectiveStats` applying **rank → count → degradation
   ** in order (§3.2–3.4). — `src/model/stats.ts`, `src/model/unit-state.ts`
6. ✅ Render the **hex grid
   ** in the View (SVG/Canvas) with terrain colours, elevation shading, and impassable/LoS-blocking tiles (§10). —
   `src/ui/components/HexGrid.tsx`
7. ✅ Render **unit tokens** showing side colour, facing arrow, category icon, ruler crown, and live HP/morale bars. —
   `src/ui/components/UnitToken.tsx`
8. ✅ Add a **unit card panel
   ** displaying full effective stats, rank, count, ammo, and active modifiers for the selected unit. —
   `src/ui/components/UnitCard.tsx`

## 2. Damage pipeline & basic actions (GDD phase 2)

9. ✅ Implement `resolveAttack(attacker, defender, context)` as the **pure deterministic §9 pipeline
   ** (dual physical/morale channels, multiplier product, ×3 cap with cavalry-morale exemption, round-once). —
   `src/model/combat.ts`
10. ✅ Wire the **half-health degradation** flag (§3.4) and **round-half-up** rule (§9.6) into stat/damage computation. —
    `src/model/stats.ts`, `src/model/combat.ts`
11. ✅ Implement core **Attack / Move / Turn** actions (§7) with per-turn `hasActed`/
    `hasAttacked` flags and the free heavy-unit turn. — `src/model/actions.ts`, `src/model/battle-store.ts`
12. ✅ Track **HP→destroy and morale→rout** thresholds (§11.1) and remove/flag units accordingly. —
    `src/model/actions.ts`, `src/model/unit-state.ts`
13. ✅ Add a **damage-preview tooltip** that surfaces each applied multiplier so outcomes are *obvious and
    verifiable* (GDD goal). — `src/ui/components/DamagePreview.tsx`

## 3. Turn loop & terrain (GDD phase 3)

14. ✅ Implement `initiativeOrder` (§6.1) — speed desc → category → Blue/Red alternation — driving a turn-by-turn loop. —
    `src/model/initiative.ts`, `src/model/battle-store.ts`
15. ✅ Apply **terrain & elevation modifiers** (§10) and **line-of-fire
    ** blocking (mountains/forest) into the damage context and movement costs. — `src/model/terrain-effects.ts`,
    `src/model/actions.ts`
16. ✅ Add a **turn/initiative tracker UI** showing whose unit acts next and the current battle-turn number. —
    `src/ui/components/TurnTracker.tsx`

## 4. Category abilities (GDD phase 4)

17. ✅ Implement **Close Formation** (§5.1) — shielding, lateral shuffle, rear vulnerability, and charge reflection. —
    `src/model/formation.ts`, `src/model/zones.ts`, `src/model/actions.ts`
18. ✅ Implement **Breakthrough** push-and-chain logic (§5.2) for shock infantry. — `src/model/breakthrough.ts`,
    `src/model/actions.ts`
19. ✅ Implement **cavalry Ram Strike / Maneuverability / Dismount
    ** (§5.3) with per-hex charge accumulation and morale-before-physical ordering. — `src/model/charge.ts`,
    `src/model/unit-state.ts`, `src/model/actions.ts`
20. ✅ Implement **ranged attack modes, cone areas, ammo (8 shots) and resupply
    ** (§5.4, §4.4) plus crossbow/horse-archer special rules. — `src/model/ranged.ts`, `src/model/actions.ts`,
    `src/ui/components/ActionBar.tsx`

## 5. Reactive layer (GDD phase 5)

21. ✅ Implement **opportunity attacks** (§8) with their declare-before-execute timing and restrictions. —
    `src/model/opportunity.ts`, `src/model/actions.ts`, `src/model/battle-store.ts`
22. ✅ Implement **cascade morale penalties and the ruler aura/fate table** (§11.2–11.3) routed through a **seeded RNG
    ** for replayable dice. — `src/model/morale.ts`, `src/model/rng.ts`, `src/model/unit-state.ts`,
    `src/model/battle-store.ts`

## 6. Battle end & output (GDD phase 6)

23. ✅ Implement `checkBattleEnd` (§11.4) and **post-battle losses** (§12) including medic reduction and prisoner split. —
    `src/model/battle-end.ts`, `src/model/battle-store.ts`
24. ✅ Add a **battle-result screen
    ** summarising survivors, rank changes, losses, and ruler fate (the strategic outputs of §13). —
    `src/ui/components/BattleResult.tsx`

## 7. Showcase polish

25. ✅ Ship a few **preset scenarios** (the §9.9 hill/charge worked example, a ranged line-of-fire duel,
    and the full battle) loadable via the mock API to demonstrate distinct mechanics. — `src/api/mock.ts`,
    `src/api/battle-api.ts`
26. ✅ Add **playback controls** (step, auto-play, reset, seed input) driven by a deterministic auto-battler so
    a viewer can replay a battle end-to-end. — `src/model/battle-store.ts` (`autoStep`),
    `src/ui/components/PlaybackControls.tsx`
27. ✅ Add a **modifier/legend cheat-sheet overlay** (Appendix A/B + terrain legend) so viewers can map on-screen
    numbers back to GDD rules. — `src/ui/components/CheatSheet.tsx`
