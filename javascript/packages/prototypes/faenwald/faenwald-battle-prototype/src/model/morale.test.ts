/**
 * Tests for the cascade morale penalties, the ruler aura presence check and the
 * ruler fate table (§11.2–11.3). Run:
 *   node --test src/model/morale.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cascadePenalties,
  rollRulerFate,
  rulerPresent,
  type MoraleSubject,
} from './morale.ts';
import type { SeededRng } from './rng.ts';
import type { Axial, Side } from './types.ts';

function subj(id: string, side: Side, hex: Axial, over: Partial<MoraleSubject> = {}): MoraleSubject {
  return { id, side, hex, isAlive: true, isRouted: false, isRuler: false, ...over };
}

/** A SeededRng stand-in that always returns a fixed d-face — for testing the fate mapping. */
function fixedRng(face: number): SeededRng {
  return { roll: () => face } as unknown as SeededRng;
}

test('cascade hits adjacent allies −10 and one-hex-away allies −5 (§11.2)', () => {
  const lost = subj('lost', 'blue', { q: 0, r: 0 });
  const adjacent = subj('adj', 'blue', { q: 1, r: 0 }); // distance 1
  const near = subj('near', 'blue', { q: 2, r: 0 }); // distance 2
  const far = subj('far', 'blue', { q: 3, r: 0 }); // distance 3 — unaffected

  const penalties = cascadePenalties(lost, [lost, adjacent, near, far]);
  assert.deepEqual(penalties, [
    { unitId: 'adj', amount: 10 },
    { unitId: 'near', amount: 5 },
  ]);
});

test('losing the ruler doubles every cascade penalty to −20 / −10 (§11.2)', () => {
  const lost = subj('king', 'blue', { q: 0, r: 0 }, { isRuler: true });
  const adjacent = subj('adj', 'blue', { q: 1, r: 0 });
  const near = subj('near', 'blue', { q: 2, r: 0 });

  const penalties = cascadePenalties(lost, [lost, adjacent, near]);
  assert.deepEqual(penalties, [
    { unitId: 'adj', amount: 20 },
    { unitId: 'near', amount: 10 },
  ]);
});

test('the cascade spares enemies, the lost unit itself, and already-lost allies (§11.2)', () => {
  const lost = subj('lost', 'blue', { q: 0, r: 0 });
  const enemy = subj('enemy', 'red', { q: 1, r: 0 });
  const dead = subj('dead', 'blue', { q: 0, r: 1 }, { isAlive: false });
  const routed = subj('routed', 'blue', { q: -1, r: 0 }, { isRouted: true });

  assert.deepEqual(cascadePenalties(lost, [lost, enemy, dead, routed]), []);
});

test('rulerPresent reflects a live, un-routed ruler unit (§11.3)', () => {
  const ruler = subj('king', 'blue', { q: 0, r: 0 }, { isRuler: true });
  assert.equal(rulerPresent('blue', [ruler]), true);
  assert.equal(rulerPresent('red', [ruler]), false);
  assert.equal(rulerPresent('blue', [{ ...ruler, isAlive: false }]), false);
  assert.equal(rulerPresent('blue', [{ ...ruler, isRouted: true }]), false);
});

test('the ruler fate d3 maps 1→killed, 2→captured, 3→fled (§11.3)', () => {
  assert.equal(rollRulerFate(fixedRng(1)), 'killed');
  assert.equal(rollRulerFate(fixedRng(2)), 'captured');
  assert.equal(rollRulerFate(fixedRng(3)), 'fled');
});
