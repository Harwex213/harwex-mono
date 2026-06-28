/**
 * Tests for the basic Attack / Move / Turn actions and HP→destroy /
 * morale→rout tracking (§7, §11.1). Run with the Node test runner:
 *   node --test src/model/actions.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAttack,
  moveTargets,
  performAttack,
  performMove,
  performTurn,
  targetableEnemies,
} from './actions.ts';
import { Board, Hex } from './board.ts';
import { getUnitDef } from './catalog.ts';
import { neighbors } from './hex.ts';
import { UnitState } from './unit-state.ts';
import type { Axial, Facing } from './types.ts';

/** A small all-plain board covering the origin, its neighbours and two hexes east. */
function plainBoard(): Board {
  const coords: Axial[] = [{ q: 0, r: 0 }, ...neighbors({ q: 0, r: 0 }), { q: 2, r: 0 }, { q: 2, r: -1 }];
  return new Board(coords.map((coord) => new Hex({ coord, terrain: 'plain' })));
}

function unit(id: string, defId: string, side: 'blue' | 'red', hex: Axial, facing: Facing): UnitState {
  return new UnitState({ id, def: getUnitDef(defId)!, side, rank: 2, count: 100, hex, facing });
}

test('a front-adjacent enemy is targetable; a distant or friendly one is not (§7.1)', () => {
  const attacker = unit('a', 'shock.medium', 'blue', { q: 0, r: 0 }, 0); // front: {1,0},{1,-1}
  const front = unit('d', 'spear.light', 'red', { q: 1, r: 0 }, 3);
  const distant = unit('e', 'spear.light', 'red', { q: 2, r: 0 }, 3);
  const ally = unit('f', 'spear.light', 'blue', { q: 1, r: -1 }, 3);

  assert.deepEqual(targetableEnemies(attacker, [attacker, front, distant, ally]).map((u) => u.id), ['d']);
  assert.equal(canAttack(attacker, ally), false);
});

test('performAttack subtracts dual-channel damage and marks the attacker acted (§9, §7.1)', () => {
  const attacker = unit('a', 'shock.medium', 'blue', { q: 0, r: 0 }, 0); // atk 25
  const defender = unit('d', 'spear.light', 'red', { q: 1, r: 0 }, 3); // front hit, hp 80 / morale 70

  const result = performAttack(attacker, defender);
  assert.ok(result);
  assert.equal(result.physical.damage, 25);
  assert.equal(result.morale.damage, 25); // front → no zone multiplier
  assert.equal(defender.hp, 55);
  assert.equal(defender.morale, 45);
  assert.equal(attacker.hasAttacked, true);
  assert.equal(attacker.hasActed, true);

  // A second attack the same turn is refused.
  assert.equal(performAttack(attacker, defender), null);
});

test('a rear hit raises only the morale channel (§2.2)', () => {
  // Defender faces 0 (front E); attacker to its west {-1,0} is in the rear, but
  // must be in the attacker's own front to strike. Place attacker facing 0 at {-1,0}.
  const attacker = unit('a', 'shock.medium', 'blue', { q: -1, r: 0 }, 0); // front {0,0},{0,-1}
  const defender = unit('d', 'spear.light', 'red', { q: 0, r: 0 }, 0); // faces E; attacker is W = rear
  const result = performAttack(attacker, defender);
  assert.ok(result);
  assert.equal(result.physical.damage, 25);
  assert.equal(result.morale.damage, 38); // 25 × 1.5 = 37.5 → 38
});

test('HP→0 destroys and morale→0 routs the defender (§11.1)', () => {
  const attacker = unit('a', 'shock.medium', 'blue', { q: 0, r: 0 }, 0); // atk 25
  const defender = unit('d', 'spear.light', 'red', { q: 1, r: 0 }, 3);
  defender.hp = 20;
  defender.morale = 15;

  performAttack(attacker, defender);
  assert.equal(defender.hp, 0);
  assert.equal(defender.isAlive, false);
  assert.equal(defender.morale, 0);
  assert.equal(defender.isRouted, true);
});

test('performMove steps into a front hex and spends one movement (§7.2)', () => {
  const mover = unit('m', 'shock.medium', 'blue', { q: 0, r: 0 }, 0); // speed 2, front {1,0},{1,-1}
  const board = plainBoard();

  assert.deepEqual(
    moveTargets(mover, board, [mover]).map((h) => `${h.q},${h.r}`).sort(),
    ['1,-1', '1,0'],
  );
  assert.equal(performMove(mover, { q: 1, r: 0 }, board, [mover]), true);
  assert.deepEqual(mover.hex, { q: 1, r: 0 });
  assert.equal(mover.movementLeft, 1);

  // A non-front hex is not a legal step.
  assert.equal(performMove(mover, { q: 0, r: 0 }, board, [mover]), false);
});

test('a front hex occupied by another unit is not a move target (§2.1)', () => {
  const mover = unit('m', 'shock.medium', 'blue', { q: 0, r: 0 }, 0);
  const blocker = unit('b', 'spear.light', 'red', { q: 1, r: 0 }, 3);
  const board = plainBoard();
  assert.deepEqual(moveTargets(mover, board, [mover, blocker]).map((h) => `${h.q},${h.r}`), ['1,-1']);
});

test('a unit cannot move after it has attacked (§7.1)', () => {
  const attacker = unit('a', 'shock.medium', 'blue', { q: 0, r: 0 }, 0);
  const defender = unit('d', 'spear.light', 'red', { q: 1, r: 0 }, 3);
  const board = plainBoard();

  performAttack(attacker, defender);
  assert.deepEqual(moveTargets(attacker, board, [attacker, defender]), []);
  assert.equal(performMove(attacker, { q: 1, r: -1 }, board, [attacker, defender]), false);
});

test('heavy units turn once for free, then pay movement (§7.2)', () => {
  const heavy = unit('h', 'spear.heavy', 'blue', { q: 0, r: 0 }, 0); // speed 1, heavy

  assert.equal(performTurn(heavy, 2), true); // free turn
  assert.equal(heavy.facing, 2);
  assert.equal(heavy.freeTurnUsed, true);
  assert.equal(heavy.movementLeft, 1);

  assert.equal(performTurn(heavy, 4), true); // costs the 1 movement
  assert.equal(heavy.movementLeft, 0);

  assert.equal(performTurn(heavy, 0), false); // no movement left → refused
});

test('a light unit pays movement to turn (§7.2)', () => {
  const light = unit('l', 'shock.light', 'blue', { q: 0, r: 0 }, 0); // speed 3, not heavy
  assert.equal(performTurn(light, 3), true);
  assert.equal(light.movementLeft, 2);
  assert.equal(light.freeTurnUsed, false);
});

test('beginTurn resets per-turn flags and movement (§6.2)', () => {
  const attacker = unit('a', 'shock.medium', 'blue', { q: 0, r: 0 }, 0);
  const defender = unit('d', 'spear.light', 'red', { q: 1, r: 0 }, 3);

  performAttack(attacker, defender);
  attacker.beginTurn();
  assert.equal(attacker.hasAttacked, false);
  assert.equal(attacker.hasActed, false);
  assert.equal(attacker.freeTurnUsed, false);
  assert.equal(attacker.movementLeft, attacker.def.speed);
});
