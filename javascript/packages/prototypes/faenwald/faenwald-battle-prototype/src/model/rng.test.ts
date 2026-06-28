/**
 * Tests for the seeded RNG (§11.3, §15.3): determinism, range and replay. Run:
 *   node --test src/model/rng.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SEED, SeededRng } from './rng.ts';

test('the same seed replays the same sequence (§15.3)', () => {
  const a = new SeededRng(42);
  const b = new SeededRng(42);
  const seqA = [a.next(), a.next(), a.next(), a.next()];
  const seqB = [b.next(), b.next(), b.next(), b.next()];
  assert.deepEqual(seqA, seqB);
});

test('different seeds diverge', () => {
  const a = new SeededRng(1);
  const b = new SeededRng(2);
  assert.notEqual(a.next(), b.next());
});

test('next() stays within [0, 1)', () => {
  const rng = new SeededRng(DEFAULT_SEED);
  for (let i = 0; i < 1000; i++) {
    const x = rng.next();
    assert.ok(x >= 0 && x < 1, `out of range: ${x}`);
  }
});

test('roll(3) yields only 1, 2 or 3 and reaches every face (§11.3)', () => {
  const rng = new SeededRng(7);
  const seen = new Set<number>();
  for (let i = 0; i < 200; i++) {
    const r = rng.roll(3);
    assert.ok(r === 1 || r === 2 || r === 3, `unexpected d3 face: ${r}`);
    seen.add(r);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3]);
});
