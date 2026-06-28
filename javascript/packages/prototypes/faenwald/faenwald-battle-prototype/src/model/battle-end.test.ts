/**
 * Tests for the battle-end check (§11.4) and post-battle losses (§12): the 50%
 * retreat rule, lost-in-full + prisoner split, medic reduction and rank
 * chevrons. Run:
 *   node --test src/model/battle-end.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkBattleEnd,
  medicReduction,
  postBattleLosses,
  type BattleSubject,
} from './battle-end.ts';
import type { Rank, Subtype } from './catalog.ts';
import type { Side } from './types.ts';

function subj(id: string, side: Side, over: Partial<BattleSubject> = {}): BattleSubject {
  const maxHp = over.maxHp ?? 100;
  const hp = over.hp ?? maxHp;
  return {
    id,
    name: id,
    side,
    count: 100,
    rank: 2 as Rank,
    subtype: 'medium' as Subtype,
    maxHp,
    hp,
    isAlive: hp > 0,
    isRouted: false,
    fights: true,
    ...over,
  };
}

test('the battle is ongoing while both sides have a standing fighting unit (§11.4)', () => {
  const result = checkBattleEnd([subj('b', 'blue'), subj('r', 'red')]);
  assert.deepEqual(result, { isOver: false, winner: null, loser: null, outcome: 'ongoing' });
});

test('a side with all units destroyed or routed loses; the other wins (§11.4)', () => {
  const units = [
    subj('b1', 'blue'),
    subj('r1', 'red', { hp: 0 }), // destroyed
    subj('r2', 'red', { isRouted: true }), // routed
  ];
  assert.deepEqual(checkBattleEnd(units), {
    isOver: true,
    winner: 'blue',
    loser: 'red',
    outcome: 'decisive',
  });
});

test('both sides wiped at once is a draw (§11.4)', () => {
  const units = [subj('b1', 'blue', { hp: 0 }), subj('r1', 'red', { isRouted: true })];
  assert.deepEqual(checkBattleEnd(units), {
    isOver: true,
    winner: null,
    loser: null,
    outcome: 'draw',
  });
});

test('non-fighting special units do not keep a side in the battle (§4.5, §11.4)', () => {
  const units = [
    subj('b1', 'blue'),
    subj('medic', 'red', { fights: false, subtype: 'medic', maxHp: 0, hp: 0 }),
    subj('r1', 'red', { hp: 0 }),
  ];
  assert.equal(checkBattleEnd(units).winner, 'blue');
});

test('a unit that retreated loses 50% of the health it lost (§12.1)', () => {
  // Lost half its HP (100 → 50) ⇒ loses a quarter of its 100 soldiers.
  const report = postBattleLosses([subj('b1', 'blue', { hp: 50 }), subj('r1', 'red', { hp: 0 })]);
  const blue = report.blue.units[0];
  assert.equal(blue.escaped, true);
  assert.equal(blue.killed, 25);
  assert.equal(blue.prisoners, 0);
  assert.equal(blue.survivors, 75);
});

test('a destroyed unit is lost in full, ~half taken prisoner (§12.1–12.2)', () => {
  const report = postBattleLosses([subj('b1', 'blue'), subj('r1', 'red', { hp: 0 })]);
  const red = report.red.units[0];
  assert.equal(red.escaped, false);
  assert.equal(red.destroyed, true);
  assert.equal(red.prisoners, 50);
  assert.equal(red.killed, 50);
  assert.equal(red.survivors, 0);
});

test('an unhurt survivor loses nobody (§12.1)', () => {
  const report = postBattleLosses([subj('b1', 'blue'), subj('r1', 'red', { hp: 0 })]);
  const blue = report.blue.units[0];
  assert.equal(blue.killed, 0);
  assert.equal(blue.survivors, 100);
});

test('a medic reduces an escaped unit’s losses by 10% per rank from II (§12.3)', () => {
  // Rank III medic ⇒ 20% reduction: a 25-soldier loss becomes round(25 × 0.8) = 20.
  const units = [
    subj('b1', 'blue', { hp: 50 }),
    subj('medic', 'blue', { fights: false, subtype: 'medic', rank: 3 as Rank, maxHp: 0, hp: 0 }),
    subj('r1', 'red', { hp: 0 }),
  ];
  const blue = postBattleLosses(units).blue.units.find((u) => u.unitId === 'b1')!;
  assert.equal(blue.medicReduction, 0.2);
  assert.equal(blue.killed, 20);
});

test('medics cannot heal a unit that did not escape (§12.3)', () => {
  const units = [
    subj('b1', 'blue'),
    subj('medic', 'red', { fights: false, subtype: 'medic', rank: 6 as Rank, maxHp: 0, hp: 0 }),
    subj('r1', 'red', { hp: 0 }), // destroyed — full loss stands despite the medic
  ];
  const red = postBattleLosses(units).red.units.find((u) => u.unitId === 'r1')!;
  assert.equal(red.killed, 50);
  assert.equal(red.prisoners, 50);
  assert.equal(red.medicReduction, 0);
});

test('the medic reduction is 10% per rank from II, capped at 70% (§12.3)', () => {
  assert.equal(medicReduction(2 as Rank), 0.1);
  assert.equal(medicReduction(3 as Rank), 0.2);
  assert.equal(medicReduction(6 as Rank), 0.5);
});

test('survivors earn rank chevrons: +2 winning side, +1 losing side; destroyed units none (§13)', () => {
  const units = [
    subj('b1', 'blue'), // winner, survives
    subj('r1', 'red', { hp: 40, isRouted: true }), // loser, routed but escaped (HP > 0)
    subj('r2', 'red', { hp: 0 }), // loser, destroyed
  ];
  const report = postBattleLosses(units);
  assert.equal(report.blue.units[0].chevrons, 2);
  assert.equal(report.red.units.find((u) => u.unitId === 'r1')!.chevrons, 1);
  assert.equal(report.red.units.find((u) => u.unitId === 'r2')!.chevrons, 0);
});

test('side aggregates sum the per-unit losses (§12, §13)', () => {
  const units = [
    subj('b1', 'blue', { hp: 50 }), // killed 25
    subj('b2', 'blue', { hp: 0 }), // killed 50, prisoners 50
    subj('r1', 'red'),
  ];
  const blue = postBattleLosses(units).blue;
  assert.equal(blue.totalEntering, 200);
  assert.equal(blue.totalKilled, 75);
  assert.equal(blue.totalPrisoners, 50);
  assert.equal(blue.totalSurvivors, 75);
});

test('non-fighting units are excluded from the loss report (§4.5, §12)', () => {
  const units = [
    subj('b1', 'blue'),
    subj('medic', 'blue', { fights: false, subtype: 'medic', maxHp: 0, hp: 0 }),
    subj('r1', 'red', { hp: 0 }),
  ];
  const blue = postBattleLosses(units).blue;
  assert.equal(blue.units.length, 1);
  assert.equal(blue.units[0].unitId, 'b1');
});
