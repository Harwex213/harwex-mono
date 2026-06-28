/**
 * Tests for Close Formation (§5.1): flank coverage, shielding, rear
 * vulnerability and the formation-bonus trigger. Run with the Node test runner:
 *   node --test src/model/formation.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, Hex } from './board.ts';
import {
  closeFormationDefenseModifiers,
  coveredFlanks,
  hasFormationBonus,
  shieldingModifier,
} from './formation.ts';
import { neighbors } from './hex.ts';
import { flankHexes } from './zones.ts';
import type { Axial, Facing } from './types.ts';

/** A plain board covering the origin and its neighbours, plus the two hexes a flank reaches. */
function plainBoard(extra: Axial[] = []): Board {
  const coords: Axial[] = [{ q: 0, r: 0 }, ...neighbors({ q: 0, r: 0 }), ...extra];
  return new Board(coords.map((coord) => new Hex({ coord, terrain: 'plain' })));
}

function spear(side: 'blue' | 'red', hex: Axial, facing: Facing) {
  return { side, category: 'spear' as const, hex, facing };
}

test('shieldingModifier maps flank counts to the documented multipliers (§5.1.1)', () => {
  assert.equal(shieldingModifier(0), null);
  assert.equal(shieldingModifier(1)?.value, 0.8);
  assert.equal(shieldingModifier(2)?.value, 0.6);
});

test('an allied spearman facing the same way covers a flank (§5.1.1)', () => {
  const unit = spear('blue', { q: 0, r: 0 }, 0);
  const [flankA] = flankHexes(unit);
  const ally = spear('blue', flankA, 0); // same facing
  const board = plainBoard();
  assert.equal(coveredFlanks(unit, board, [unit, ally]), 1);
});

test('a flanking ally facing a different way does not cover the flank (§5.1.1)', () => {
  const unit = spear('blue', { q: 0, r: 0 }, 0);
  const [flankA] = flankHexes(unit);
  const ally = spear('blue', flankA, 3); // wrong facing
  const board = plainBoard();
  assert.equal(coveredFlanks(unit, board, [unit, ally]), 0);
});

test('the map edge / impassable terrain covers a flank (§5.1.1)', () => {
  const unit = spear('blue', { q: 0, r: 0 }, 0);
  const [flankA, flankB] = flankHexes(unit);
  // Board omits flankA entirely (map edge) and makes flankB a mountain (impassable).
  const coords: Axial[] = [{ q: 0, r: 0 }, ...neighbors({ q: 0, r: 0 }).filter((h) => h.q !== flankA.q || h.r !== flankA.r)];
  const board = new Board(
    coords.map((coord) => new Hex({ coord, terrain: coord.q === flankB.q && coord.r === flankB.r ? 'mountain' : 'plain' })),
  );
  assert.equal(coveredFlanks(unit, board, [unit]), 2);
  assert.equal(hasFormationBonus(unit, board, [unit]), true);
});

test('front hits are reduced on both channels; rear adds the spearman physical penalty (§5.1.1, §5.1.3)', () => {
  const unit = spear('blue', { q: 0, r: 0 }, 0);
  const [flankA, flankB] = flankHexes(unit);
  const allyA = spear('blue', flankA, 0);
  const allyB = spear('blue', flankB, 0);
  const board = plainBoard();
  const units = [unit, allyA, allyB];

  const front = closeFormationDefenseModifiers(unit, 'front', board, units);
  assert.equal(front.physical[0]?.value, 0.6); // both flanks
  assert.equal(front.morale[0]?.value, 0.6); // shielding applies to any incoming front damage

  const rear = closeFormationDefenseModifiers(unit, 'rear', board, units);
  assert.equal(rear.physical[0]?.value, 1.5);
  assert.deepEqual(rear.morale, []);
});

test('non-spearmen never form up (§5.1)', () => {
  const board = plainBoard();
  const cav = { side: 'blue' as const, category: 'cavalry' as const, hex: { q: 0, r: 0 }, facing: 0 as Facing };
  assert.equal(coveredFlanks(cav, board, [cav]), 0);
  assert.deepEqual(closeFormationDefenseModifiers(cav, 'front', board, [cav]).physical, []);
});
