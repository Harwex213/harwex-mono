# M7 — Opportunity attacks & ruler

## Opportunity attacks (full doc timing, §«Оппортун»)

The hardest mechanic; model it as an explicit interrupt state on `ActiveBattle`
(`pendingOpportunity: { opportunerId, targetId, declaredAction } | null`).

- Trigger: during `advanceUnit`, the moving unit ENTERS a hex inside an enemy's attack zone. Eligible
  opportuner: hasn't attacked this turn. Multiple eligible enemies → doc is silent; ruling: resolve in
  unit-id order, each once.
- Timing: the reaction is NOT resolved at entry. It resolves after the entered unit DECLARES its next
  action but before that action executes. Implementation: entering the zone arms `pendingOpportunity`;
  the next mutator call by the target (advance/rotate/attack/accelerate/endActivation) first resolves
  the reaction, then proceeds. Target takes no further action this activation (ends it) → reaction is
  cancelled (doc: no oppo if the target takes no action).
- Strike-first exception: if the declared action is an attack ON the opportuner, the mover's attack
  resolves first; if the opportuner survives, its reaction then resolves.
- Aftermath: the opportuner counts as having ACTED this round (skipped by the group loop; may only
  rotate when its slot comes). Not usable by shock infantry for breakthrough (M6 rule).
- Breakthrough/maneuver interactions and shock-triggered routs mid-interrupt: process through the same
  post-hit cascade as M4.

## Ruler

- Disposition: crown toggle already stores `isRulerUnit` (M3). Aura: +10 morale to every unit of that
  side while the ruler's unit is on the field and not routed — implement as a recomputed bonus, not a
  baked-in stat, so losing the ruler cleanly removes it.
- Ruler's unit destroyed: log «ruler's unit destroyed — resolve d3 offline» (no in-app outcome, per
  interview), aura ends, morale shock doubled (already in M4). Ruler's unit routs: ruler escapes, aura
  ends, log it.
- Canvas: crown marker on the ruler's unit.

## Done when

- Tests: arming/resolving/cancelling the interrupt, strike-first ordering, opportuner acted-flag and
  rotate-only slot, multi-enemy ruling, aura add/remove, doubled shock.
- `/verify`: walk a unit through an enemy zone and exercise all three outcomes (acts, attacks the
  opportuner, stands still).
