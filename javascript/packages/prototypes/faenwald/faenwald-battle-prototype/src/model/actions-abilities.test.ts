/**
 * Tests for the phase-4 category abilities wired into the action layer (§5):
 * the cavalry charge run, Maneuverability, charge reflection, the lateral
 * shuffle, Breakthrough, ranged firing and Dismount/Mount. Run with:
 *   node --test src/model/actions-abilities.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  moveTargets,
  performAttack,
  performBreakthrough,
  performMove,
  performRangedAttack,
  performTurn,
} from './actions.ts';
import { Board, Hex } from './board.ts';
import { getUnitDef } from './catalog.ts';
import { neighbors } from './hex.ts';
import { UnitState } from './unit-state.ts';
import type { Axial, Facing } from './types.ts';
import type { Elevation, TerrainType } from './terrain.ts';

interface TileSpec {
  coord: Axial;
  terrain?: TerrainType;
  elevation?: Elevation;
}

function board(specs: TileSpec[]): Board {
  return new Board(specs.map((s) => new Hex({ coord: s.coord, terrain: s.terrain ?? 'plain', elevation: s.elevation })));
}

/** Plain board covering the origin, its neighbours and a few hexes east. */
function eastBoard(): Board {
  const coords: Axial[] = [
    { q: 0, r: 0 },
    ...neighbors({ q: 0, r: 0 }),
    { q: 2, r: 0 },
    { q: 2, r: -1 },
    { q: 3, r: 0 },
  ];
  return board(coords.map((coord) => ({ coord })));
}

function unit(id: string, defId: string, side: 'blue' | 'red', hex: Axial, facing: Facing): UnitState {
  return new UnitState({ id, def: getUnitDef(defId)!, side, rank: 2, count: 100, hex, facing });
}

test('a cavalry charge run accumulates per forward hex and a turn breaks it (§5.3)', () => {
  const cav = unit('c', 'cavalry.light', 'blue', { q: 0, r: 0 }, 0); // speed 5, front toward +q
  const grid = eastBoard();

  assert.equal(performMove(cav, { q: 1, r: 0 }, grid, [cav]), true);
  assert.equal(cav.chargeHexes, 1);
  assert.equal(performMove(cav, { q: 2, r: 0 }, grid, [cav]), true);
  assert.equal(cav.chargeHexes, 2);

  assert.equal(performTurn(cav, 2), true);
  assert.equal(cav.chargeHexes, 0); // turning ends the straight run
});

test('a built charge multiplies into the cavalry attack (§5.3, §9.3)', () => {
  const cav = unit('c', 'cavalry.heavy', 'blue', { q: 0, r: 0 }, 0); // atk 25, ram 24
  const target = unit('d', 'shock.medium', 'red', { q: 1, r: 0 }, 3);
  const grid = eastBoard();
  cav.chargeHexes = 2; // a 2-hex run → ×1.48

  const result = performAttack(cav, target, grid, [cav, target]);
  assert.ok(result);
  assert.equal(result.physical.raw, 25 * 1.48); // 37
  assert.equal(result.physical.damage, 37);
});

test('a charging cavalry is reflected by a close-formation spearman it hits frontally (§5.1.4)', () => {
  // Defender faces west (3); the attacker to its west is in its front.
  const cav = unit('c', 'cavalry.heavy', 'blue', { q: 0, r: 0 }, 0); // front includes {1,0}
  const def = unit('d', 'spear.heavy', 'red', { q: 1, r: 0 }, 3); // front includes {0,0}
  const allyA = unit('a', 'spear.heavy', 'red', { q: 1, r: 1 }, 3); // covers a flank
  const allyB = unit('b', 'spear.heavy', 'red', { q: 1, r: -1 }, 3); // covers the other flank
  const grid = board([
    { coord: { q: 0, r: 0 } },
    { coord: { q: 1, r: 0 } },
    { coord: { q: 1, r: 1 } },
    { coord: { q: 1, r: -1 } },
    { coord: { q: 2, r: 0 } },
    { coord: { q: 0, r: 1 } },
  ]);
  const units = [cav, def, allyA, allyB];
  cav.chargeHexes = 2;
  const hpBefore = cav.hp;

  const result = performAttack(cav, def, grid, units);
  assert.ok(result);
  assert.ok((result.reflected ?? 0) > 0);
  assert.equal(result.reflected, result.physical.damage);
  assert.equal(cav.hp, hpBefore - result.reflected!);
});

test('Maneuverability lets cavalry move after attacking; other categories cannot (§5.3)', () => {
  const grid = eastBoard();
  const cav = unit('c', 'cavalry.light', 'blue', { q: 0, r: 0 }, 0);
  const enemy = unit('e', 'spear.light', 'red', { q: 1, r: 0 }, 3);
  performAttack(cav, enemy, grid, [cav, enemy]);
  assert.ok(moveTargets(cav, grid, [cav, enemy]).length > 0); // {1,-1} still open

  const shock = unit('s', 'shock.medium', 'blue', { q: 0, r: 0 }, 0);
  const enemy2 = unit('e2', 'spear.light', 'red', { q: 1, r: 0 }, 3);
  performAttack(shock, enemy2, grid, [shock, enemy2]);
  assert.deepEqual(moveTargets(shock, grid, [shock, enemy2]), []);
});

test('a spearman lateral-shuffles into a flank hex at ×2 cost without turning (§5.1.2)', () => {
  const spear = unit('s', 'spear.medium', 'blue', { q: 0, r: 0 }, 0); // speed 2; flank hex {0,-1}
  const grid = eastBoard();
  const targets = moveTargets(spear, grid, [spear]).map((h) => `${h.q},${h.r}`);
  assert.ok(targets.includes('0,-1')); // a flank shuffle target

  assert.equal(performMove(spear, { q: 0, r: -1 }, grid, [spear]), true);
  assert.deepEqual(spear.hex, { q: 0, r: -1 });
  assert.equal(spear.movementLeft, 0); // 2 × 1 hex
  assert.equal(spear.facing, 0); // facing unchanged
});

test('Breakthrough pushes the target and advances the attacker into the vacated hex (§5.2)', () => {
  const shock = unit('s', 'shock.medium', 'blue', { q: 0, r: 0 }, 0); // atk 25
  const def = unit('d', 'spear.light', 'red', { q: 1, r: 0 }, 3); // atk 12, hp 80
  const grid = eastBoard();
  const units = [shock, def];

  const result = performAttack(shock, def, grid, units);
  assert.ok(result);
  assert.equal(performBreakthrough(shock, def, result.physical.damage, grid, units), true);
  assert.deepEqual(def.hex, { q: 2, r: 0 });
  assert.deepEqual(shock.hex, { q: 1, r: 0 });
});

test('a ranged unit fires direct for ×2, spends a shot, and cannot fire twice a turn (§5.4, §4.4)', () => {
  const archer = unit('r', 'ranged.archer', 'blue', { q: 0, r: 0 }, 0); // atk 6
  const target = unit('t', 'shock.medium', 'red', { q: 2, r: 0 }, 3); // hp 90
  const grid = eastBoard();
  const units = [archer, target];

  const result = performRangedAttack(archer, target, 'direct', grid, units, 1);
  assert.ok(result);
  assert.equal(result.physical.damage, 12); // 6 × 2
  assert.equal(target.hp, 78);
  assert.equal(archer.shotsLeft, 7);
  assert.equal(archer.lastFiredTurn, 1);
  assert.equal(performRangedAttack(archer, target, 'direct', grid, units, 1), null); // already fired
});

test('Dismount swaps to the foot unit preserving HP ratio; Mount re-saddles (§5.3)', () => {
  const cav = unit('c', 'cavalry.light', 'blue', { q: 0, r: 0 }, 0); // hp 70, speed 5
  cav.hp = 35; // half health → ratio 0.5

  assert.equal(cav.dismount(), true);
  assert.equal(cav.def.id, 'spear.light');
  assert.equal(cav.maxHp, 80);
  assert.equal(cav.hp, 40); // 0.5 × 80
  assert.equal(cav.movementLeft, 4); // 5 − 1 hex spent dismounting
  assert.equal(cav.dismounted, true);

  assert.equal(cav.mount(), true);
  assert.equal(cav.def.id, 'cavalry.light');
  assert.equal(cav.maxHp, 70);
  assert.equal(cav.hp, 35); // 0.5 × 70
});
