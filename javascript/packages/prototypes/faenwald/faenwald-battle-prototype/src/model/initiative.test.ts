/**
 * Tests for the §6.1 initiative ordering. Run with the Node test runner:
 *   node --test src/model/initiative.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initiativeOrder, type Combatant } from './initiative.ts';
import type { Category } from './catalog.ts';
import type { Side } from './types.ts';

let seq = 0;
function unit(side: Side, category: Category, speed: number, over: Partial<Combatant> = {}): Combatant & { id: string } {
  return {
    id: `${side}-${category}-${(seq += 1)}`,
    side,
    category,
    speed,
    fights: true,
    isAlive: true,
    isRouted: false,
    ...over,
  };
}

test('orders by movement speed, fastest first (§6.1)', () => {
  const slow = unit('blue', 'spear', 1);
  const fast = unit('blue', 'spear', 5);
  const mid = unit('blue', 'spear', 3);
  assert.deepEqual(
    initiativeOrder([slow, fast, mid]).map((u) => u.id),
    [fast.id, mid.id, slow.id],
  );
});

test('breaks speed ties by category: cavalry → ranged → shock → spear (§6.1)', () => {
  const spear = unit('blue', 'spear', 3);
  const shock = unit('blue', 'shock', 3);
  const ranged = unit('blue', 'ranged', 3);
  const cavalry = unit('blue', 'cavalry', 3);
  assert.deepEqual(
    initiativeOrder([spear, shock, ranged, cavalry]).map((u) => u.category),
    ['cavalry', 'ranged', 'shock', 'spear'],
  );
});

test('alternates Blue then Red within a speed+category bracket (§6.1)', () => {
  const blue1 = unit('blue', 'cavalry', 4);
  const blue2 = unit('blue', 'cavalry', 4);
  const red1 = unit('red', 'cavalry', 4);
  const red2 = unit('red', 'cavalry', 4);
  assert.deepEqual(
    initiativeOrder([blue1, blue2, red1, red2]).map((u) => u.side),
    ['blue', 'red', 'blue', 'red'],
  );
});

test('matches the GDD worked example: Blue archers → Red archers → Blue spearmen → Red spearmen (§6.1)', () => {
  // Archers and light spearmen all move at speed 3; ranged sorts before melee.
  const blueArcher = unit('blue', 'ranged', 3);
  const redArcher = unit('red', 'ranged', 3);
  const blueSpear = unit('blue', 'spear', 3);
  const redSpear = unit('red', 'spear', 3);
  assert.deepEqual(
    initiativeOrder([redSpear, blueSpear, redArcher, blueArcher]).map((u) => u.id),
    [blueArcher.id, redArcher.id, blueSpear.id, redSpear.id],
  );
});

test('drops units that do not fight, are dead, or have routed (§4.5, §11.1)', () => {
  const fighter = unit('blue', 'shock', 2);
  const special = unit('red', 'special', 9, { fights: false });
  const dead = unit('blue', 'cavalry', 5, { isAlive: false });
  const routed = unit('red', 'ranged', 4, { isRouted: true });
  assert.deepEqual(
    initiativeOrder([special, dead, routed, fighter]).map((u) => u.id),
    [fighter.id],
  );
});
