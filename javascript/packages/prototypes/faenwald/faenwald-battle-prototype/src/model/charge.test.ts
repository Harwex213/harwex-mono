/**
 * Tests for the cavalry charge modifiers (§5.3, §9.3): the ram multiplier, the
 * ≥3-hex morale bonus, anti-charge reduction and rear-deal. Run with:
 *   node --test src/model/charge.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  antiChargeModifier,
  chargeModifiers,
  chargeMoraleModifier,
  chargePhysicalModifier,
  isCharging,
  type ChargeAttacker,
} from './charge.ts';

function cav(over: Partial<ChargeAttacker> = {}): ChargeAttacker {
  return { category: 'cavalry', ramMod: 24, chargeHexes: 0, perks: {}, ...over };
}

test('the charge physical multiplier is 1 + ramMod·hexes/100 (§9.3)', () => {
  const heavy2 = chargePhysicalModifier(cav({ ramMod: 24, chargeHexes: 2 }));
  assert.equal(heavy2?.value, 1.48); // 1 + 24·2/100

  const light1 = chargePhysicalModifier(cav({ ramMod: 8, chargeHexes: 1 }));
  assert.equal(light1?.value, 1.08);
});

test('no charge multiplier without a run, or for non-cavalry (§5.3)', () => {
  assert.equal(chargePhysicalModifier(cav({ chargeHexes: 0 })), null);
  assert.equal(isCharging(cav({ chargeHexes: 0 })), false);
  assert.equal(chargePhysicalModifier({ category: 'shock', chargeHexes: 3, perks: {} }), null);
});

test('a run of ≥3 hexes adds the ×1.25 charge morale bonus (§5.3)', () => {
  assert.equal(chargeMoraleModifier(cav({ chargeHexes: 2 })), null);
  assert.equal(chargeMoraleModifier(cav({ chargeHexes: 3 }))?.value, 1.25);
});

test('anti-charge reduction applies only when actually charged (§4.1–4.3)', () => {
  const defender = { perks: { takesFromCharge: 0.5 } };
  assert.equal(antiChargeModifier(cav({ chargeHexes: 2 }), defender)?.value, 0.5);
  assert.equal(antiChargeModifier(cav({ chargeHexes: 0 }), defender), null);
});

test('chargeModifiers bundles physical (charge + anti-charge + rear) and morale per channel (§5.3)', () => {
  const attacker = cav({ ramMod: 8, chargeHexes: 3, perks: { dealsToRear: 1.5 } });
  const defender = { perks: { takesFromCharge: 0.75 } };
  const { physical, morale } = chargeModifiers(attacker, defender, 'rear');

  assert.deepEqual(
    physical.map((m) => m.value),
    [1.24, 0.75, 1.5], // charge (1+8·3/100), anti-charge, rear-deal
  );
  assert.equal(morale.length, 1);
  assert.equal(morale[0].value, 1.25); // ≥3-hex charge morale
});

test('rear-deal only applies on a rear hit (§4.3)', () => {
  const attacker = cav({ chargeHexes: 1, perks: { dealsToRear: 1.5 } });
  assert.equal(chargeModifiers(attacker, { perks: {} }, 'front').physical.some((m) => m.label.includes('rear')), false);
  assert.equal(chargeModifiers(attacker, { perks: {} }, 'rear').physical.some((m) => m.label.includes('rear')), true);
});
