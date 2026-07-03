/**
 * Tests for effective stat computation (§3.2–3.4, §9.6). Run with the Node
 * test runner:
 *   node --test src/model/stats.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEffectiveStats,
  computeEnteringStats,
  roundHalfUp,
  scaleByRank,
} from './stats.ts';

test('roundHalfUp rounds .5 upward', () => {
  assert.equal(roundHalfUp(62.5), 63);
  assert.equal(roundHalfUp(75.5), 76);
  assert.equal(roundHalfUp(2.4), 2);
});

test('scaleByRank reproduces the GDD §3.3 worked example (base 50/20/100)', () => {
  // HP base 50.
  assert.equal(scaleByRank(50, 1), 38); // round(0.75 × 50) = round(37.5)
  assert.equal(scaleByRank(50, 2), 50); // baseline
  assert.equal(scaleByRank(50, 3), 63); // round(50 + 12.5)
  assert.equal(scaleByRank(50, 4), 76); // round(63 + 12.5) — "76, not 78"
  assert.equal(scaleByRank(50, 5), 89);
  assert.equal(scaleByRank(50, 6), 102);

  // Attack base 20 → +5 per step.
  assert.deepEqual([3, 4, 5, 6].map((r) => scaleByRank(20, r as 3 | 4 | 5 | 6)), [25, 30, 35, 40]);

  // Morale base 100 → +25 per step.
  assert.equal(scaleByRank(100, 3), 125);
  assert.equal(scaleByRank(100, 4), 150);
});

test('rank scaling is iterative-with-rounding, not a single compounded multiply', () => {
  // A naive ×1.5 of base 63 would give 94.5 → 95; the iterative rule gives 76.
  assert.notEqual(scaleByRank(50, 4), roundHalfUp(50 * 1.5));
  assert.equal(scaleByRank(50, 4), 76);
});

test('count scales HP/atk/morale linearly (§3.2)', () => {
  // Rank II so rank scaling is identity; 50 soldiers → ×0.5.
  const stats = computeEnteringStats({ baseHp: 80, baseAtk: 12, baseMorale: 70, rank: 2, count: 50 });
  assert.deepEqual(stats, { maxHp: 40, maxMorale: 35, attack: 6 });
});

test('rank applies before count (§3.3 ordering)', () => {
  // Rank IV of base 80 = round(80→100→120) ... compute via scaleByRank, then ×0.5.
  const ranked = scaleByRank(80, 4); // 80 +20 +20 = 120
  const stats = computeEnteringStats({ baseHp: 80, baseAtk: 0, baseMorale: 0, rank: 4, count: 50 });
  assert.equal(ranked, 120);
  assert.equal(stats.maxHp, roundHalfUp(120 * 0.5));
});

test('strength modifier folds into entering stats (§3.5)', () => {
  const stats = computeEnteringStats({
    baseHp: 100,
    baseAtk: 20,
    baseMorale: 100,
    rank: 2,
    count: 100,
    strengthMod: 0.8,
  });
  assert.deepEqual(stats, { maxHp: 80, maxMorale: 80, attack: 16 });
});

test('half-health degradation halves attack output (§3.4)', () => {
  const base = { baseHp: 100, baseAtk: 20, baseMorale: 100, rank: 2 as const, count: 100 };

  const healthy = computeEffectiveStats({ ...base, currentHp: 50 }); // exactly half — not yet bloodied
  assert.equal(healthy.bloodied, false);
  assert.equal(healthy.effectiveAttack, 20);

  const bloodied = computeEffectiveStats({ ...base, currentHp: 49 });
  assert.equal(bloodied.bloodied, true);
  assert.equal(bloodied.effectiveAttack, 10);
  assert.equal(bloodied.attack, 20, 'entering attack is unchanged by degradation');
});

test('degradation is measured against the entering max, not the pristine 100-max (§3.5)', () => {
  // Entered at 80% strength: maxHp 80, so the bloodied threshold is 40, not 50.
  const base = { baseHp: 100, baseAtk: 20, baseMorale: 100, rank: 2 as const, count: 100, strengthMod: 0.8 };
  assert.equal(computeEffectiveStats({ ...base, currentHp: 45 }).bloodied, false);
  assert.equal(computeEffectiveStats({ ...base, currentHp: 39 }).bloodied, true);
});
