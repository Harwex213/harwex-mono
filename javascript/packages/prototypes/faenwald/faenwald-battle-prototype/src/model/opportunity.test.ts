/**
 * Tests for opportunity attacks (§8): who may react to a mover, the four
 * restrictions, and the "may only turn after reacting" rule. Run:
 *   node --test src/model/opportunity.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveTargets, performTurn } from './actions.ts';
import { Board, Hex } from './board.ts';
import { getUnitDef } from './catalog.ts';
import { neighbors } from './hex.ts';
import { opportunityAttackers, opportunityKind, performOpportunityAttack } from './opportunity.ts';
import { UnitState } from './unit-state.ts';
import type { Axial, Facing } from './types.ts';

/** A plain board covering the origin, its neighbours and two hexes east. */
function plainBoard(): Board {
  const coords: Axial[] = [{ q: 0, r: 0 }, ...neighbors({ q: 0, r: 0 }), { q: 2, r: 0 }, { q: 2, r: -1 }];
  return new Board(coords.map((coord) => new Hex({ coord, terrain: 'plain' })));
}

function unit(id: string, defId: string, side: 'blue' | 'red', hex: Axial, facing: Facing): UnitState {
  return new UnitState({ id, def: getUnitDef(defId)!, side, rank: 2, count: 100, hex, facing });
}

test('an archer fires a reactive shot at an enemy entering its range (§8)', () => {
  const board = plainBoard();
  const archer = unit('a', 'ranged.archer', 'blue', { q: 0, r: 0 }, 0); // front cone covers the east
  const mover = unit('m', 'shock.medium', 'red', { q: 2, r: 0 }, 3); // two hexes east, in direct range
  const units = [archer, mover];

  assert.equal(opportunityKind(archer, mover, mover.hex, board, units, 1), 'direct');

  const hp0 = mover.hp;
  const shots0 = archer.shotsLeft;
  const outcome = performOpportunityAttack(archer, mover, board, units, 1);

  assert.ok(outcome);
  assert.equal(outcome.kind, 'direct');
  assert.ok(mover.hp < hp0); // the shot landed
  assert.equal(archer.shotsLeft, shots0 - 1); // and spent an arrow (§4.4)
  assert.equal(archer.hasAttacked, true);
  assert.equal(archer.madeOpportunityAttack, true);
});

test('a unit that already attacked this turn cannot react (§8)', () => {
  const board = plainBoard();
  const archer = unit('a', 'ranged.archer', 'blue', { q: 0, r: 0 }, 0);
  const mover = unit('m', 'shock.medium', 'red', { q: 2, r: 0 }, 3);
  archer.hasAttacked = true;

  assert.equal(opportunityKind(archer, mover, mover.hex, board, [archer, mover], 1), null);
});

test('light cavalry is immune to a ranged opportunity attack but not a melee one (§4.3, §8)', () => {
  const board = plainBoard();
  const archer = unit('a', 'ranged.archer', 'blue', { q: 0, r: 0 }, 0);
  const spear = unit('s', 'spear.medium', 'blue', { q: 0, r: 0 }, 0); // front hexes {1,0},{1,-1}
  const lightCav = unit('m', 'cavalry.light', 'red', { q: 2, r: 0 }, 3);

  // Ranged threat: no reaction against light cavalry.
  assert.equal(opportunityKind(archer, lightCav, lightCav.hex, board, [archer, lightCav], 1), null);

  // Melee threat: a spear that the light cavalry steps in front of still reacts.
  const adjacentCav = unit('m2', 'cavalry.light', 'red', { q: 1, r: 0 }, 3);
  assert.equal(opportunityKind(spear, adjacentCav, adjacentCav.hex, board, [spear, adjacentCav], 1), 'melee');
});

test('after reacting, the unit may only turn — no movement, but a turn is allowed (§8)', () => {
  const board = plainBoard();
  const archer = unit('a', 'ranged.archer', 'blue', { q: 0, r: 0 }, 0);
  const mover = unit('m', 'shock.medium', 'red', { q: 2, r: 0 }, 3);
  performOpportunityAttack(archer, mover, board, [archer, mover], 1);

  assert.deepEqual(moveTargets(archer, board, [archer, mover]), []); // movement is spent
  assert.equal(performTurn(archer, 2 as Facing), true); // but it may reorient
});

test('opportunityAttackers gathers every eligible enemy threat (§8)', () => {
  const board = plainBoard();
  const archer = unit('a', 'ranged.archer', 'blue', { q: 0, r: 0 }, 0);
  const ally = unit('f', 'ranged.archer', 'red', { q: -1, r: 0 }, 0); // same side as mover — never reacts
  const mover = unit('m', 'shock.medium', 'red', { q: 2, r: 0 }, 3);
  const units = [archer, ally, mover];

  const offers = opportunityAttackers(mover, mover.hex, board, units, 1);
  assert.deepEqual(offers.map((o) => o.threat.id), ['a']);
});
