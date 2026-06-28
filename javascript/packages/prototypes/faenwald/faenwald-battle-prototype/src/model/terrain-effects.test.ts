/**
 * Tests for the §10 terrain/elevation effects: damage modifiers, line of fire
 * and movement cost. Run with the Node test runner:
 *   node --test src/model/terrain-effects.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, Hex } from './board.ts';
import {
  elevationAttackModifier,
  lineOfFireBlocked,
  moveCost,
  terrainPhysicalModifiers,
  type MovingUnit,
  type TerrainCombatant,
} from './terrain-effects.ts';
import type { Category, Subtype } from './catalog.ts';
import type { Elevation, HexState, TerrainType } from './terrain.ts';
import type { Axial } from './types.ts';

function hex(coord: Axial, terrain: TerrainType, elevation?: Elevation, state?: HexState): Hex {
  return new Hex({ coord, terrain, elevation, state });
}

function combatant(category: Category, subtype: Subtype, hex: Axial): TerrainCombatant {
  return { category, subtype, hex };
}

test('elevation modifier follows the delta table (§10.4–10.5)', () => {
  assert.equal(elevationAttackModifier(2, 0)?.value, 1.5); // hill over a two-down hex
  assert.equal(elevationAttackModifier(1, 0)?.value, 1.25);
  assert.equal(elevationAttackModifier(0, 1)?.value, 0.75);
  assert.equal(elevationAttackModifier(0, 2)?.value, 0.5); // striking a hill from low ground
  assert.equal(elevationAttackModifier(1, 1), null); // level ground
});

test('terrainPhysicalModifiers applies elevation for melee but not ranged (§5.4, §10)', () => {
  const attackerHex = { q: 0, r: 0 };
  const defenderHex = { q: 1, r: 0 };
  const board = new Board([hex(attackerHex, 'hill', 2), hex(defenderHex, 'plain', 0)]);

  const melee = terrainPhysicalModifiers(
    combatant('spear', 'heavy', attackerHex),
    combatant('shock', 'medium', defenderHex),
    board,
  );
  assert.deepEqual(melee.map((m) => m.value), [1.5]); // hill (2) vs plain (0)

  const ranged = terrainPhysicalModifiers(
    combatant('ranged', 'archer', attackerHex),
    combatant('shock', 'medium', defenderHex),
    board,
  );
  assert.deepEqual(ranged, []); // no hill attack bonus/debuff for ranged
});

test('mud lets a light unit deal ×2 to a heavy defender in mud (§10)', () => {
  const attackerHex = { q: 0, r: 0 };
  const defenderHex = { q: 1, r: 0 };
  const board = new Board([hex(attackerHex, 'plain'), hex(defenderHex, 'plain', 0, 'mud')]);

  const modifiers = terrainPhysicalModifiers(
    combatant('shock', 'light', attackerHex),
    combatant('spear', 'heavy', defenderHex),
    board,
  );
  assert.deepEqual(modifiers.map((m) => m.value), [2]);

  // No bonus when the heavy defender is not standing in mud.
  const dryBoard = new Board([hex(attackerHex, 'plain'), hex(defenderHex, 'plain')]);
  assert.deepEqual(
    terrainPhysicalModifiers(combatant('shock', 'light', attackerHex), combatant('spear', 'heavy', defenderHex), dryBoard),
    [],
  );
});

test('ranged fire picks up brush/forest cover on the target hex (§10)', () => {
  const a = { q: 0, r: 0 };
  const b = { q: 1, r: 0 };
  const brush = new Board([hex(a, 'plain'), hex(b, 'brush')]);
  const forest = new Board([hex(a, 'plain'), hex(b, 'forest')]);

  assert.equal(
    terrainPhysicalModifiers(combatant('ranged', 'archer', a), combatant('spear', 'light', b), brush)[0]?.value,
    0.75,
  );
  assert.equal(
    terrainPhysicalModifiers(combatant('ranged', 'archer', a), combatant('spear', 'light', b), forest)[0]?.value,
    0.5,
  );
});

test('a mountain between firer and target blocks line of fire; endpoints do not (§2.3)', () => {
  const from = { q: 0, r: 0 };
  const mid = { q: 1, r: 0 };
  const to = { q: 2, r: 0 };
  const blocked = new Board([hex(from, 'plain'), hex(mid, 'mountain'), hex(to, 'plain')]);
  assert.equal(lineOfFireBlocked(from, to, blocked), true);

  const clear = new Board([hex(from, 'plain'), hex(mid, 'plain'), hex(to, 'plain')]);
  assert.equal(lineOfFireBlocked(from, to, clear), false);

  // A mountain on the target's own hex does not block the shot reaching it.
  const onTarget = new Board([hex(from, 'plain'), hex(mid, 'plain'), hex(to, 'mountain')]);
  assert.equal(lineOfFireBlocked(from, to, onTarget), false);
});

test('moveCost reflects roads, bog, climbing, mud and cavalry brush/forest (§10)', () => {
  const plain = hex({ q: 0, r: 0 }, 'plain', 0);
  const infantry: MovingUnit = { category: 'shock', speed: 2 };
  const cavalry: MovingUnit = { category: 'cavalry', speed: 5 };

  assert.equal(moveCost(infantry, plain, hex({ q: 1, r: 0 }, 'plain', 0)), 1);
  assert.equal(moveCost(infantry, plain, hex({ q: 1, r: 0 }, 'road', 0)), 0.5);
  assert.equal(moveCost(infantry, plain, hex({ q: 1, r: 0 }, 'bog', 0)), 3);
  assert.equal(moveCost(infantry, plain, hex({ q: 1, r: 0 }, 'foothill', 1)), 2); // climbing
  assert.equal(moveCost(infantry, plain, hex({ q: 1, r: 0 }, 'plain', 0, 'mud')), 2);

  // Cavalry: brush costs a flat 2; forest consumes the whole turn (= speed → 1 hex).
  assert.equal(moveCost(cavalry, plain, hex({ q: 1, r: 0 }, 'brush', 0)), 2);
  assert.equal(moveCost(cavalry, plain, hex({ q: 1, r: 0 }, 'forest', 0)), 5);
  // Infantry walk brush/forest at the normal cost.
  assert.equal(moveCost(infantry, plain, hex({ q: 1, r: 0 }, 'forest', 0)), 1);
});
