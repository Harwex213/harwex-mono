# M4 — Melee combat, morale, rout, victory

Goal: battles resolve. Melee attacks, both damage pools, death/rout, morale shock, FINISHED transition.

## Pure helpers

- `damage.js` — `resolveAttack({attacker, defender, zone, terrainMults})` →
  `{ hpDamage, moraleDamage }`. HP damage = attack × terrain mults; morale damage = attack × facing
  mult (front ×1, flank ×1.25, rear ×1.5) × terrain mults. All multipliers multiply together, round
  arithmetically, hard cap ×3 of natural (unmodified) damage. Cap exception hook for cavalry charge
  morale damage (M6). Doc's half-damage-below-half-health rule (§1.5) applies: attacker at < 50% max HP
  deals half damage.
- `flee-path.js` — shortest path (BFS over passable, unoccupied hexes) from a position to the unit's own
  deployment edge; used by the rout tick.

## Mutators

- `attack(state, targetId)` — active unit only, once per activation (`hasAttacked`), target must be in
  its attack zone (all 6 neighbors, zone from `zoneOf` for multipliers). Applies both damage pools, logs,
  then runs the post-hit cascade below. Attacking ends movement (no move after attack; M6 relaxes for
  maneuverable cavalry).
- Post-hit cascade, in order: HP ≤ 0 → destroyed (removed, marked); else morale ≤ 0 → `routed = true`.
  On either: **morale shock** — allies of the lost unit at distance 1 take −10, distance 2 take −5,
  doubled when the lost unit `isRulerUnit`; shock itself can chain routs (process as a queue). Ruler
  unit destroyed → aura ends (M7 owns aura bookkeeping; here just the flag + log).
- **Rout tick**: a routed unit is uncontrollable; when its activation slot comes it auto-moves along
  `flee-path` using its normal MP, then auto-ends. It can be attacked while fleeing. Reaching/leaving its
  deployment edge removes it as `routed off field`.
- `capitulate(state, side)` — that side loses immediately.
- **Victory check** after every removal/capitulation: a side with zero on-field units loses →
  `phase = FINISHED` (winner stored on state). Both sides empty simultaneously → draw.

## Pages

- battle-active: enemies inside the active unit's zone highlighted click-to-attack; damage/rout/death
  entries in the log panel; capitulate wired with a confirm step; FINISHED → router lands on
  `/battle/finished` via the dispatcher guard.

## Done when

- Tests: damage math (multiplier stacking, rounding, ×3 cap, half-damage rule), shock radii/doubling,
  chained routs, flee pathing, victory/draw detection, capitulate.
- `/verify`: fight a small battle to a finish through real clicks.
