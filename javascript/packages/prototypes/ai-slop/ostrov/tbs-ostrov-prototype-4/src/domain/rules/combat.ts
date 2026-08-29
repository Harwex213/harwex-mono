import { TERRAIN } from "../world/terrain";
import type { TRng } from "../world/rng";
import type { TArmy, TStructure, TTile } from "../world/types";

/**
 * Both sides take damage in every fight, in proportion to how the strengths
 * compare. Nothing is decided by a single roll, so a wounded stack is worth
 * pulling back rather than throwing away.
 */

type TCombatOutcome = {
  damageToDefender: number;
  damageToAttacker: number;
};

/** Wounds cut a strike in half at most: a survivor still bites. */
const effectivePower = (attack: number, hp: number, maxHp: number): number =>
  attack * (0.5 + 0.5 * (hp / maxHp));

const BASE_DAMAGE = 9;
const MIN_DEFENDER_DAMAGE = 2;
const MAX_DEFENDER_DAMAGE = 28;
const MIN_ATTACKER_DAMAGE = 1;
const MAX_ATTACKER_DAMAGE = 22;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const jitter = (rng: TRng): number => 0.85 + rng() * 0.3;

const damageFromRatio = (ratio: number, rng: TRng): TCombatOutcome => ({
  damageToDefender: Math.round(
    clamp(BASE_DAMAGE * Math.pow(ratio, 1.15) * jitter(rng), MIN_DEFENDER_DAMAGE, MAX_DEFENDER_DAMAGE)
  ),
  damageToAttacker: Math.round(
    clamp(BASE_DAMAGE * Math.pow(1 / ratio, 1.15) * jitter(rng), MIN_ATTACKER_DAMAGE, MAX_ATTACKER_DAMAGE)
  ),
});

const resolveArmyAttack = (attacker: TArmy, defender: TArmy, defenderTile: TTile, rng: TRng): TCombatOutcome => {
  const attackPower = effectivePower(attacker.attack, attacker.hp, attacker.maxHp);
  const defencePower = effectivePower(defender.attack, defender.hp, defender.maxHp) * TERRAIN[defenderTile.terrain].defence;

  return damageFromRatio(attackPower / Math.max(defencePower, 0.1), rng);
};

/**
 * Walls do not counter-attack, they grind: the attacker takes a fixed share of
 * what it deals, so a lone scout never chips a camp down for free.
 */
const resolveStructureAttack = (
  attacker: TArmy,
  structure: TStructure,
  structureTile: TTile,
  rng: TRng
): TCombatOutcome => {
  const attackPower = effectivePower(attacker.attack, attacker.hp, attacker.maxHp);
  const defencePower = effectivePower(structure.defence, structure.hp, structure.maxHp) * TERRAIN[structureTile.terrain].defence;
  const outcome = damageFromRatio(attackPower / Math.max(defencePower, 0.1), rng);

  return { damageToDefender: outcome.damageToDefender, damageToAttacker: Math.round(outcome.damageToAttacker * 0.6) };
};

export type { TCombatOutcome };
export { resolveArmyAttack, resolveStructureAttack };
