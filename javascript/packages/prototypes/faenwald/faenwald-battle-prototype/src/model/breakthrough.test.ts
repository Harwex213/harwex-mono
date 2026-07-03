/**
 * Tests for Breakthrough (§5.2): the push threshold, the straight push, the
 * chain behind, and the flank-first fallback. Run with:
 *   node --test src/model/breakthrough.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, Hex } from './board.ts';
import { canBreakthrough, planBreakthrough, type Occupant } from './breakthrough.ts';
import type { Axial } from './types.ts';

function board(coords: Axial[], impassable: Axial[] = []): Board {
  return new Board(
    coords.map(
      (coord) =>
        new Hex({
          coord,
          terrain: impassable.some((h) => h.q === coord.q && h.r === coord.r) ? 'mountain' : 'plain',
        }),
    ),
  );
}

const attacker = { category: 'shock' as const, hex: { q: 0, r: 0 } };

test('the push threshold needs shock infantry meeting the target attack stat (§5.2)', () => {
  const target = { id: 'd', hex: { q: 1, r: 0 }, facing: 3 as const, attack: 15 };
  assert.equal(canBreakthrough(attacker, target, 15), true);
  assert.equal(canBreakthrough(attacker, target, 14), false);
  assert.equal(canBreakthrough({ category: 'spear', hex: { q: 0, r: 0 } }, target, 30), false);
});

test('a straight push moves the target into its rear and steps the attacker in (§5.2)', () => {
  const target = { id: 'd', hex: { q: 1, r: 0 }, facing: 3 as const, attack: 15 };
  const units: Occupant[] = [{ id: 'd', hex: { q: 1, r: 0 } }];
  const plan = planBreakthrough(attacker, target, board([{ q: 1, r: 0 }, { q: 2, r: 0 }]), units);
  assert.deepEqual(plan, { pushes: [{ id: 'd', to: { q: 2, r: 0 } }], attackerTo: { q: 1, r: 0 } });
});

test('a unit directly behind is chained, far-to-near (§5.2)', () => {
  const target = { id: 'd', hex: { q: 1, r: 0 }, facing: 3 as const, attack: 15 };
  const units: Occupant[] = [
    { id: 'd', hex: { q: 1, r: 0 } },
    { id: 'behind', hex: { q: 2, r: 0 } },
  ];
  const plan = planBreakthrough(attacker, target, board([{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }]), units);
  assert.deepEqual(plan?.pushes, [
    { id: 'behind', to: { q: 3, r: 0 } },
    { id: 'd', to: { q: 2, r: 0 } },
  ]);
});

test('a blocked chain cannot break through (§5.2)', () => {
  const target = { id: 'd', hex: { q: 1, r: 0 }, facing: 3 as const, attack: 15 };
  const units: Occupant[] = [
    { id: 'd', hex: { q: 1, r: 0 } },
    { id: 'behind', hex: { q: 2, r: 0 } },
  ];
  // {3,0} is off the board, so the rearmost unit has nowhere to go.
  const plan = planBreakthrough(attacker, target, board([{ q: 1, r: 0 }, { q: 2, r: 0 }]), units);
  assert.equal(plan, null);
});

test('a lone target with the rear blocked is shoved to a flank (§5.2)', () => {
  const target = { id: 'd', hex: { q: 1, r: 0 }, facing: 3 as const, attack: 15 };
  const units: Occupant[] = [{ id: 'd', hex: { q: 1, r: 0 } }];
  // Straight rear {2,0} is impassable; the target's neighbours include open flank hexes.
  const grid = board(
    [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 2, r: -1 }, { q: 1, r: 1 }, { q: 0, r: 1 }, { q: 1, r: -1 }],
    [{ q: 2, r: 0 }],
  );
  const plan = planBreakthrough(attacker, target, grid, units);
  assert.ok(plan);
  assert.notDeepEqual(plan!.pushes[0].to, { q: 2, r: 0 });
  assert.equal(plan!.pushes[0].id, 'd');
  assert.deepEqual(plan!.attackerTo, { q: 1, r: 0 });
});
