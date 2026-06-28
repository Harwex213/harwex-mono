/**
 * Tests for the axial/cube hex math (§2.1). Run with the Node test runner:
 *   node --test src/model/hex.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEX_DIRECTIONS,
  cubeS,
  distance,
  hexAdd,
  hexEquals,
  hexSubtract,
  lineDraw,
  neighbor,
  neighbors,
} from './hex.ts';
import type { Axial } from './types.ts';

const ORIGIN: Axial = { q: 0, r: 0 };

test('cubeS derives s = -q - r', () => {
  assert.equal(cubeS({ q: 0, r: 0 }), 0);
  assert.equal(cubeS({ q: 2, r: -3 }), 1);
  assert.equal(cubeS({ q: -1, r: 4 }), -3);
});

test('the six directions are distinct unit vectors summing to zero', () => {
  assert.equal(HEX_DIRECTIONS.length, 6);
  const sum = HEX_DIRECTIONS.reduce((acc, d) => hexAdd(acc, d), ORIGIN);
  assert.deepEqual(sum, ORIGIN);
  // Each direction is exactly distance 1 from the origin.
  for (const d of HEX_DIRECTIONS) {
    assert.equal(distance(ORIGIN, d), 1);
  }
});

test('neighbors returns all six adjacent hexes in direction order', () => {
  const result = neighbors(ORIGIN);
  assert.equal(result.length, 6);
  result.forEach((hex, i) => assert.deepEqual(hex, HEX_DIRECTIONS[i]));
});

test('neighbor wraps the direction index modulo 6', () => {
  assert.deepEqual(neighbor(ORIGIN, 0), neighbor(ORIGIN, 6));
  assert.deepEqual(neighbor(ORIGIN, 1), neighbor(ORIGIN, -5));
  assert.deepEqual(neighbor({ q: 3, r: -2 }, 3), { q: 2, r: -2 });
});

test('distance is symmetric and zero for identical hexes', () => {
  const a: Axial = { q: 1, r: -2 };
  const b: Axial = { q: -3, r: 4 };
  assert.equal(distance(a, a), 0);
  assert.equal(distance(a, b), distance(b, a));
});

test('distance counts single-step moves', () => {
  assert.equal(distance(ORIGIN, { q: 3, r: 0 }), 3);
  assert.equal(distance(ORIGIN, { q: 0, r: -2 }), 2);
  // Diagonal across the cube: not the sum of components.
  assert.equal(distance(ORIGIN, { q: 2, r: -1 }), 2);
  assert.equal(distance({ q: -1, r: 1 }, { q: 2, r: -2 }), 3);
});

test('lineDraw includes both endpoints and walks contiguous hexes', () => {
  const a: Axial = { q: 0, r: 0 };
  const b: Axial = { q: 3, r: -1 };
  const line = lineDraw(a, b);

  assert.equal(line.length, distance(a, b) + 1);
  assert.ok(hexEquals(line[0], a));
  assert.ok(hexEquals(line[line.length - 1], b));
  // Every consecutive pair is adjacent (distance 1).
  for (let i = 1; i < line.length; i++) {
    assert.equal(distance(line[i - 1], line[i]), 1);
  }
});

test('lineDraw of a single hex returns just that hex', () => {
  const line = lineDraw({ q: 2, r: 2 }, { q: 2, r: 2 });
  assert.deepEqual(line, [{ q: 2, r: 2 }]);
});

test('hexAdd / hexSubtract are inverses', () => {
  const a: Axial = { q: 5, r: -2 };
  const delta: Axial = { q: -3, r: 1 };
  assert.deepEqual(hexSubtract(hexAdd(a, delta), delta), a);
});
