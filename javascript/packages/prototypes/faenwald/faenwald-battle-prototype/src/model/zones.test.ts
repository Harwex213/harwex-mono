/**
 * Tests for facing and the three zones (§2.2). Run with the Node test runner:
 *   node --test src/model/zones.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directionOf, zoneOf, type Facer } from './zones.ts';
import { HEX_DIRECTIONS, hexScale } from './hex.ts';
import type { Axial, Facing, Zone } from './types.ts';

const ORIGIN: Axial = { q: 0, r: 0 };

test('directionOf recovers the index of each adjacent neighbour', () => {
  HEX_DIRECTIONS.forEach((dir, i) => {
    assert.equal(directionOf(ORIGIN, dir), i);
  });
});

test('directionOf returns -1 for a coincident hex', () => {
  assert.equal(directionOf(ORIGIN, ORIGIN), -1);
});

test('directionOf is stable for distant hexes along a direction', () => {
  HEX_DIRECTIONS.forEach((dir, i) => {
    assert.equal(directionOf(ORIGIN, hexScale(dir, 4)), i);
  });
});

test('facing 0 splits the six neighbours into the documented 2/2/2 zones', () => {
  const defender: Facer = { hex: ORIGIN, facing: 0 };
  const expected: Record<number, Zone> = {
    0: 'front', // E
    1: 'front', // NE
    2: 'flank', // NW
    3: 'rear', // W
    4: 'rear', // SW
    5: 'flank', // SE
  };
  HEX_DIRECTIONS.forEach((dir, i) => {
    assert.equal(zoneOf(dir, defender), expected[i], `neighbour ${i}`);
  });
});

test('every facing yields exactly two hexes in each zone', () => {
  for (let facing = 0; facing < 6; facing++) {
    const defender: Facer = { hex: ORIGIN, facing: facing as Facing };
    const counts: Record<Zone, number> = { front: 0, flank: 0, rear: 0 };
    for (const dir of HEX_DIRECTIONS) {
      counts[zoneOf(dir, defender)]++;
    }
    assert.deepEqual(counts, { front: 2, flank: 2, rear: 2 }, `facing ${facing}`);
  }
});

test('zones rotate with facing — front follows the spear tip', () => {
  // Facing 3 points opposite facing 0, so its front is facing-0's rear.
  const frontFacing0 = HEX_DIRECTIONS[0];
  assert.equal(zoneOf(frontFacing0, { hex: ORIGIN, facing: 0 }), 'front');
  assert.equal(zoneOf(frontFacing0, { hex: ORIGIN, facing: 3 }), 'rear');
});

test('zone is judged from the attacking hex, not from the defender position alone', () => {
  // Defender off-origin, facing 0; an attacker two hexes to the front is still front.
  const defender: Facer = { hex: { q: 5, r: -2 }, facing: 0 };
  const farFront: Axial = { q: 7, r: -2 }; // +2 along direction 0 from the defender
  assert.equal(zoneOf(farFront, defender), 'front');
});

test('a coincident attacker hex defaults to front', () => {
  assert.equal(zoneOf(ORIGIN, { hex: ORIGIN, facing: 2 }), 'front');
});
