# M6 — Unit specials

Goal: the type identities from the doc. Dismount/mount is explicitly deferred (unformalized conversion
rule). Each special is a small, separately testable extension of `damage.js` / mutators.

## Spearmen — Closed formation (доc §1, «Сомкнутый строй»)

- Condition helper: spearman with at least one flank hex covered (ally, `impassable` terrain, or map
  edge) → incoming FRONT damage ×0.8; both flanks covered → ×0.6.
- May move into rear/flank hexes without rotating at ×2 MP cost (extra allowed moves in `advanceUnit`).
- Takes ×1.5 physical (HP) damage from the rear.
- Reflects charge damage back at a charging attacker when hit in the front with the formation bonus
  active (hook consumed by the charge logic below).

## Shock infantry — Breakthrough (§2, «Прорыв»)

- After a front-zone melee hit where dealt damage ≥ target's attack stat: attacker MAY push the target
  one hex toward the target's rear and occupy its hex. If the destination is occupied by another enemy,
  the push chains through the line; chain stops at impassable/edge (then no push). Player choice via a
  log-adjacent prompt on the active page. Not usable in an opportunity attack. Rear-zone damage dealt
  by shock infantry counts as flank damage (multiplier downgrade).

## Cavalry — Charge & Maneuverability (§3)

- Charge state on the unit: `chargeHexes` — consecutive FRONT-hex advances this activation (reset by
  rotation, non-front move, activation end). On melee attack: damage ×(1 + ramModifier×chargeHexes/100)
  (per doc §1.6: 48 → ×1.48, 120 → ×2.2). Charge ≥ 3 hexes additionally ×1.25 morale damage, morale
  applied before HP. Charge morale damage is EXEMPT from the ×3 cap.
- Maneuverability: `maneuverable` units may continue moving after attacking (attack no longer ends the
  activation for them).

## Done when

- Tests per special: formation cover detection and multipliers, breakthrough threshold + chain + refusal
  cases, charge accumulation/reset/cap-exemption, maneuver move-after-attack.
- `/verify`: stage one demonstrative skirmish per special.
