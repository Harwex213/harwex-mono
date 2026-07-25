import { HEX_ZONE } from "./hex-facing.js";

const MORALE_ZONE_MULT = { [HEX_ZONE.FRONT]: 1, [HEX_ZONE.FLANK]: 1.25, [HEX_ZONE.REAR]: 1.5 };

/**
 * Elevation multiplier applied to both damage pools (doc §1.4 rules 4/5).
 * @param {number} attackerElev
 * @param {number} defenderElev
 * @returns {number}
 */
const elevationDamageMult = (attackerElev, defenderElev) => {
  const diff = (attackerElev ?? 0) - (defenderElev ?? 0);
  if (diff === 1) {
    return 1.25;
  }
  if (diff >= 2) {
    return 1.5;
  }
  if (diff === -1) {
    return 0.75;
  }
  if (diff <= -2) {
    return 0.5;
  }
  return 1;
};

/**
 * Charge (ram) damage multiplier: +ramModifier% per consecutive front hex
 * advanced this activation (doc §1.6/§3: ram 48 → ×1.48, 120 → ×2.2).
 * @param {number} [ramModifier]
 * @param {number} [chargeHexes]
 * @returns {number}
 */
const chargeDamageMult = (ramModifier, chargeHexes) => {
  const ram = ramModifier ?? 0;
  const hexes = chargeHexes ?? 0;
  return 1 + (ram * hexes) / 100;
};

/**
 * Closed-formation incoming FRONT-damage multiplier (doc «Сомкнутый строй»):
 * one flank covered ×0.8, both ×0.6, none ×1.
 * @param {number} coveredFlanks 0..2
 * @returns {number}
 */
const formationCoverMult = (coveredFlanks) => {
  if (coveredFlanks >= 2) {
    return 0.6;
  }
  if (coveredFlanks === 1) {
    return 0.8;
  }
  return 1;
};

/**
 * @param {{ attacker: {attack:number, hp:number, maxHp:number}, defender: object, zone: string,
 *   terrainMults?: number, attackMult?: number, extraMoraleMult?: number, hpMult?: number,
 *   moraleCapExempt?: boolean }} args
 *   `attackMult` (fire-mode multiplier) and `extraMoraleMult` (the ranged-in-melee ×1.5
 *   morale penalty) both default to 1 and are subject to the same ×3-natural cap as
 *   `terrainMults`, unless `moraleCapExempt`. `hpMult` (e.g. spearman-rear ×1.5) applies
 *   to the HP pool only and stays under the ×3 cap.
 * @returns {{ hpDamage: number, moraleDamage: number }}
 */
const resolveAttack = ({ attacker, defender, zone, terrainMults, attackMult, extraMoraleMult, hpMult, moraleCapExempt }) => {
  const natural = attacker.attack;
  const half = attacker.hp < attacker.maxHp / 2 ? 0.5 : 1;
  const zoneMult = MORALE_ZONE_MULT[zone] ?? 1;
  const tm = terrainMults ?? 1;
  const am = attackMult ?? 1;
  const em = extraMoraleMult ?? 1;
  const hm = hpMult ?? 1;
  const cap = natural * 3;
  const rawHp = natural * half * tm * am * hm;
  const rawMorale = natural * half * tm * am * zoneMult * em;
  const hpDamage = Math.round(Math.min(rawHp, cap));
  const moraleDamage = Math.round(moraleCapExempt ? rawMorale : Math.min(rawMorale, cap));
  return { hpDamage, moraleDamage };
};

export { resolveAttack, elevationDamageMult, chargeDamageMult, formationCoverMult, MORALE_ZONE_MULT };
