# M5 — Ranged combat & line of sight

Goal: the three fire modes from the doc, ammo, elevation, LoS. Source of truth: doc «Дальняя атака»
(~lines 265-284) — implementer must re-read it; the interview left the exact direct-fire range wording
to be confirmed there.

## Pure helpers

- `line-of-sight.js` — hex-line traversal between two cells: `directLosBlocked(map, units, from, to,
  elevations)` (units block unless on lower elevation than the shooter; terrain with `blocksDirectLos`
  blocks), `arcBlocked(map, from, to)` (`blocksArcFire` terrain), plus range checks per mode.
- `damage.js` extension — ranged mode multipliers (arc ×1, direct ×2, ranged-melee ×0.5), target
  terrain `rangedDamageTakenMult`, elevation attack mults (higher ground ×1.25 dealt / ×0.75 taken;
  hill vs adjacent ×1.5 / ×0.5), targets on `noArcTarget` terrain can't be arc-targeted.

## Mutators

- `attack` gains a `mode` argument for ranged units: `arc` (range per unit data, over units), `direct`
  (LoS required), `melee` (adjacent, ×0.5, and the ranged unit takes ×1.5 morale damage in melee per
  the doc). Arc/direct decrement `ammo` (8); at 0 only melee remains. Crossbowman: no arc, `cooldown`
  enforces firing every 2nd turn; "full damage vs heavy" is deferred with the weight system.
- Facing: ranged modes still respect the shooter's facing (targets must be in the frontal arc);
  flank/rear morale multipliers apply to the target as in melee.

## Pages

- battle-active: fire-mode selector in the footer for the active ranged unit (modes greyed out when
  out of range/LoS/ammo/cooldown); valid targets per mode highlighted on canvas; ammo shown on the
  active-unit card.

## Done when

- Tests: LoS blocking (units, elevation, terrain flags), per-mode range/eligibility, ammo depletion,
  crossbow cooldown, elevation multiplier stacking under the ×3 cap.
- `/verify`: archer volleys over a friendly line (arc), direct shot blocked by an intervening unit,
  melee-locked archer takes the ×1.5 morale penalty.
