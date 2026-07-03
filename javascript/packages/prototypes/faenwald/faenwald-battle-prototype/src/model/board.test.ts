/**
 * Tests for the observable Hex / Board model (§10, §15.1). Run with the Node
 * test runner:
 *   node --test src/model/board.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, Hex, coordKey } from './board.ts';

test('a hex defaults its elevation from its terrain type (§10)', () => {
  assert.equal(new Hex({ coord: { q: 0, r: 0 }, terrain: 'plain' }).elevation, 0);
  assert.equal(new Hex({ coord: { q: 0, r: 0 }, terrain: 'foothill' }).elevation, 1);
  assert.equal(new Hex({ coord: { q: 0, r: 0 }, terrain: 'hill' }).elevation, 2);
});

test('an explicit elevation overrides the terrain default', () => {
  const hex = new Hex({ coord: { q: 0, r: 0 }, terrain: 'plain', elevation: 2 });
  assert.equal(hex.elevation, 2);
});

test('mountains and water are impassable; mountains block line of fire (§10/#6)', () => {
  const mountain = new Hex({ coord: { q: 0, r: 0 }, terrain: 'mountain' });
  const water = new Hex({ coord: { q: 1, r: 0 }, terrain: 'water' });
  assert.equal(mountain.isPassable, false);
  assert.equal(mountain.blocksLineOfFire, true);
  assert.equal(water.isPassable, false);
  assert.equal(water.blocksLineOfFire, false);
});

test('frozen water behaves like a plain and becomes passable (§10/#6)', () => {
  const frozen = new Hex({ coord: { q: 0, r: 0 }, terrain: 'water', state: 'frozen' });
  assert.equal(frozen.isPassable, true);
});

test('the board indexes hexes by coordinate for lookup', () => {
  const board = new Board([
    new Hex({ coord: { q: 0, r: 0 }, terrain: 'plain' }),
    new Hex({ coord: { q: 1, r: -1 }, terrain: 'hill' }),
  ]);
  assert.equal(board.get({ q: 1, r: -1 })?.terrain, 'hill');
  assert.equal(board.has({ q: 0, r: 0 }), true);
  assert.equal(board.has({ q: 5, r: 5 }), false);
  assert.equal(board.get({ q: 9, r: 9 }), undefined);
});

test('the board reports its axial bounding box', () => {
  const board = new Board([
    new Hex({ coord: { q: -2, r: 1 }, terrain: 'plain' }),
    new Hex({ coord: { q: 3, r: -4 }, terrain: 'plain' }),
  ]);
  assert.deepEqual(board.bounds, { minQ: -2, maxQ: 3, minR: -4, maxR: 1 });
});

test('coordKey is stable and round-trips a coordinate', () => {
  assert.equal(coordKey({ q: 2, r: -1 }), '2,-1');
});
