/**
 * Tests for the observable UnitState bits added by the reactive layer: the ruler
 * aura morale capacity (§11.3) and the opportunity-attack flag reset (§8). Run:
 *   node --test src/model/unit-state.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getUnitDef } from './catalog.ts';
import { UnitState } from './unit-state.ts';

function unit(): UnitState {
  return new UnitState({ id: 'u', def: getUnitDef('spear.medium')!, side: 'blue', rank: 2, count: 100, hex: { q: 0, r: 0 }, facing: 0 });
}

test('setAura lifts current morale and capacity, then restores them when revoked (§11.3)', () => {
  const u = unit();
  const baseMorale = u.morale;
  const baseMax = u.maxMorale;

  u.setAura(10);
  assert.equal(u.morale, baseMorale + 10);
  assert.equal(u.effectiveMaxMorale, baseMax + 10);
  assert.equal(u.auraMorale, 10);

  u.setAura(0);
  assert.equal(u.morale, baseMorale);
  assert.equal(u.effectiveMaxMorale, baseMax);
});

test('setAura is idempotent and never drops current morale below zero (§11.3)', () => {
  const u = unit();
  u.setAura(10);
  u.setAura(10); // re-applying does nothing
  assert.equal(u.morale, u.maxMorale + 10);

  u.morale = 4; // battered down while the aura held
  u.setAura(0); // losing the ruler clamps, not underflows
  assert.equal(u.morale, 0);
});

test('moraleRatio fills against the aura-boosted capacity (§11.3)', () => {
  const u = unit();
  u.setAura(10);
  assert.ok(Math.abs(u.moraleRatio - u.morale / (u.maxMorale + 10)) < 1e-9);
});

test('beginTurn clears the opportunity-attack flag (§8)', () => {
  const u = unit();
  u.madeOpportunityAttack = true;
  u.beginTurn();
  assert.equal(u.madeOpportunityAttack, false);
});
