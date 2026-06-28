/**
 * Tests for the §9 damage pipeline. Run with the Node test runner:
 *   node --test src/model/combat.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttack, type Attacker, type Defender } from './combat.ts';
import type { UnitPerks } from './catalog.ts';

function attacker(over: Partial<Attacker> = {}): Attacker {
  return { category: 'shock', attack: 20, perks: {}, ...over };
}

function defender(perks: UnitPerks = {}, category: Defender['category'] = 'spear'): Defender {
  return { category, perks };
}

test('a front hit deals natural damage to both channels (§3.1, §9)', () => {
  const result = resolveAttack(attacker({ attack: 20 }), defender(), { zone: 'front' });
  assert.equal(result.physical.damage, 20);
  assert.equal(result.morale.damage, 20);
  assert.deepEqual(result.morale.modifiers, []);
});

test('flank and rear apply the morale multipliers, leaving physical untouched (§2.2)', () => {
  const flank = resolveAttack(attacker({ attack: 20 }), defender(), { zone: 'flank' });
  assert.equal(flank.physical.damage, 20);
  assert.equal(flank.morale.damage, 25); // 20 × 1.25

  const rear = resolveAttack(attacker({ attack: 20 }), defender(), { zone: 'rear' });
  assert.equal(rear.physical.damage, 20);
  assert.equal(rear.morale.damage, 30); // 20 × 1.5
});

test('shock infantry treat a rear hit as a flank for morale (§4.2)', () => {
  const target = defender({ rearActsAsFlank: true }, 'shock');
  const rear = resolveAttack(attacker({ attack: 20 }), target, { zone: 'rear' });
  assert.equal(rear.morale.damage, 25); // ×1.25, not ×1.5
  assert.equal(rear.morale.modifiers[0]?.label, 'Rear hit (counts as flank)');
});

test('a ranged attacker applies the defender takesFromRanged matchup (§4.1)', () => {
  // Light spearman takes ×1.5 from ranged; archer natural 6.
  const archer = attacker({ category: 'ranged', attack: 6 });
  const lightSpear = defender({ takesFromRanged: 1.5 });
  const result = resolveAttack(archer, lightSpear, { zone: 'front' });
  assert.equal(result.physical.damage, 9); // 6 × 1.5
  assert.equal(result.physical.modifiers.length, 1);
});

test('light cavalry deals dealsToRanged against a ranged defender (§4.3)', () => {
  const lightCav = attacker({ category: 'cavalry', attack: 10, perks: { dealsToRanged: 1.5 } });
  const archer = defender({}, 'ranged');
  const result = resolveAttack(lightCav, archer, { zone: 'front' });
  assert.equal(result.physical.damage, 15); // 10 × 1.5
});

test('extra context modifiers multiply in and appear in the breakdown (later phases)', () => {
  const result = resolveAttack(attacker({ attack: 20 }), defender(), {
    zone: 'flank',
    physicalModifiers: [{ label: 'Hill vs foothill', value: 1.25 }],
    moraleModifiers: [{ label: 'Charge ≥3 hexes', value: 1.25 }],
  });
  assert.equal(result.physical.damage, 25); // 20 × 1.25
  assert.equal(result.morale.damage, 31); // 20 × 1.25 (flank) × 1.25 (charge) = 31.25 → 31
  assert.equal(result.morale.modifiers.length, 2);
});

test('multipliers are commutative — order does not change the product (§9.3)', () => {
  const forward = resolveAttack(attacker({ attack: 12 }), defender(), {
    zone: 'rear',
    physicalModifiers: [{ label: 'a', value: 0.5 }, { label: 'b', value: 1.25 }],
  });
  const reversed = resolveAttack(attacker({ attack: 12 }), defender(), {
    zone: 'rear',
    physicalModifiers: [{ label: 'b', value: 1.25 }, { label: 'a', value: 0.5 }],
  });
  assert.equal(forward.physical.damage, reversed.physical.damage);
});

test('the ×3 cap clamps both channels for a non-cavalry attacker (§9.5)', () => {
  const result = resolveAttack(attacker({ attack: 10 }), defender(), {
    zone: 'rear', // ×1.5 morale
    physicalModifiers: [{ label: 'huge', value: 10 }],
    moraleModifiers: [{ label: 'huge', value: 10 }],
  });
  assert.equal(result.physical.raw, 100);
  assert.equal(result.physical.damage, 30); // capped at 3 × 10
  assert.equal(result.physical.capped, true);
  assert.equal(result.morale.damage, 30); // capped
  assert.equal(result.morale.capped, true);
});

test('cavalry morale is exempt from the ×3 cap, physical is not (§9.5)', () => {
  const cav = attacker({ category: 'cavalry', attack: 25 });
  const result = resolveAttack(cav, defender(), {
    zone: 'rear',
    physicalModifiers: [{ label: 'charge', value: 5 }],
    moraleModifiers: [{ label: 'charge', value: 5 }],
  });
  assert.equal(result.physical.damage, 75); // 25 × 5 = 125 → capped to 75
  assert.equal(result.physical.capped, true);
  // Morale: 25 × 1.5 (rear) × 5 = 187.5 → 188, never capped.
  assert.equal(result.morale.capped, false);
  assert.equal(result.morale.damage, 188);
});

test('damage rounds once at the end with round-half-up (§9.6)', () => {
  // 18 × 1.25 = 22.5 → 23.
  const result = resolveAttack(attacker({ attack: 18 }), defender(), {
    zone: 'front',
    physicalModifiers: [{ label: 'hill', value: 1.25 }],
  });
  assert.equal(result.physical.raw, 22.5);
  assert.equal(result.physical.damage, 23);
});
