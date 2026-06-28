/**
 * Tests for Ranged Attack (§5.4, §4.4): modes, range, the firing arc, line of
 * fire, the elevation range bonus and the crossbow/horse-archer rules. Run with:
 *   node --test src/model/ranged.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, Hex } from './board.ts';
import { getUnitDef } from './catalog.ts';
import {
  availableModes,
  canFireAt,
  modeRange,
  rangedModeModifiers,
  RANGED_MODE_MULTIPLIER,
  reloaded,
  type RangedFirer,
} from './ranged.ts';
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

/** A straight east-west row from {0,0} to {len,0}, all plain unless overridden. */
function row(len: number, overrides: TileSpec[] = []): Board {
  const specs: TileSpec[] = [];
  for (let q = 0; q <= len; q++) {
    const over = overrides.find((o) => o.coord.q === q && o.coord.r === 0);
    specs.push({ coord: { q, r: 0 }, terrain: over?.terrain, elevation: over?.elevation });
  }
  // Add the off-row neighbours used for rear/flank tests.
  specs.push({ coord: { q: -1, r: 0 } }, { coord: { q: 0, r: -1 } }, { coord: { q: -1, r: 1 } });
  return board(specs);
}

function firer(defId: string, hex: Axial, facing: Facing, over: Partial<RangedFirer> = {}): RangedFirer {
  const def = getUnitDef(defId)!;
  return { def, category: def.category, hex, facing, shotsLeft: 8, lastFiredTurn: null, ...over };
}

test('mode multipliers are ×1 arcing / ×2 direct / ×0.5 close (§5.4)', () => {
  assert.deepEqual(RANGED_MODE_MULTIPLIER, { arcing: 1, direct: 2, close: 0.5 });
});

test('archer ranges: arcing 4, direct 2, close 1; crossbow has no arc and +1 direct (§5.4, §4.4)', () => {
  const archer = getUnitDef('ranged.archer')!;
  assert.equal(modeRange(archer, 'arcing', 0), 4);
  assert.equal(modeRange(archer, 'direct', 0), 2);
  assert.equal(modeRange(archer, 'close', 0), 1);

  const crossbow = getUnitDef('ranged.crossbow')!;
  assert.equal(modeRange(crossbow, 'arcing', 0), null);
  assert.equal(modeRange(crossbow, 'direct', 0), 3);
  assert.deepEqual(availableModes(crossbow), ['direct', 'close']);
});

test('elevation extends range +1 on foothill / +2 on hill, but not for horse archers (§5.4, §4.4)', () => {
  const archer = getUnitDef('ranged.archer')!;
  assert.equal(modeRange(archer, 'arcing', 1), 5);
  assert.equal(modeRange(archer, 'arcing', 2), 6);

  const horse = getUnitDef('ranged.horseArcher')!;
  assert.equal(modeRange(horse, 'arcing', 2), 2); // no hill bonus
});

test('a front target within range can be fired on; out of range or out of arc cannot (§5.4)', () => {
  const grid = row(4);
  const archer = firer('ranged.archer', { q: 0, r: 0 }, 0); // front cone toward +q
  assert.equal(canFireAt(archer, { q: 4, r: 0 }, 'arcing', grid, [], 1), true);
  assert.equal(canFireAt(archer, { q: 2, r: 0 }, 'direct', grid, [], 1), true);
  assert.equal(canFireAt(archer, { q: 3, r: 0 }, 'direct', grid, [], 1), false); // beyond direct range 2
  assert.equal(canFireAt(archer, { q: -1, r: 0 }, 'arcing', grid, [], 1), false); // behind — out of arc
});

test('a mountain blocks line of fire; arcing cannot target a forest or settlement hex (§2.3, §10)', () => {
  const blocked = row(2, [{ coord: { q: 1, r: 0 }, terrain: 'mountain' }]);
  const archer = firer('ranged.archer', { q: 0, r: 0 }, 0);
  assert.equal(canFireAt(archer, { q: 2, r: 0 }, 'arcing', blocked, [], 1), false);

  const forest = row(4, [{ coord: { q: 4, r: 0 }, terrain: 'forest' }]);
  assert.equal(canFireAt(firer('ranged.archer', { q: 0, r: 0 }, 0), { q: 4, r: 0 }, 'arcing', forest, [], 1), false);
});

test('direct fire is blocked by an intervening unit unless it stands a level below (§5.4)', () => {
  const flat = row(2);
  const archer = firer('ranged.archer', { q: 0, r: 0 }, 0);
  const blocker = [{ hex: { q: 1, r: 0 } }];
  assert.equal(canFireAt(archer, { q: 2, r: 0 }, 'direct', flat, blocker, 1), false);

  // Firer on a hill shoots over a unit standing on the plain a level below.
  const hill = row(2, [{ coord: { q: 0, r: 0 }, terrain: 'hill', elevation: 2 }]);
  const highArcher = firer('ranged.archer', { q: 0, r: 0 }, 0);
  assert.equal(canFireAt(highArcher, { q: 2, r: 0 }, 'direct', hill, blocker, 1), true);
});

test('arcing fires over units (they do not block the arc) (§5.4)', () => {
  const flat = row(4);
  const archer = firer('ranged.archer', { q: 0, r: 0 }, 0);
  assert.equal(canFireAt(archer, { q: 4, r: 0 }, 'arcing', flat, [{ hex: { q: 2, r: 0 } }], 1), true);
});

test('a crossbow must wait two turns between shots (§4.4)', () => {
  const crossbow = firer('ranged.crossbow', { q: 0, r: 0 }, 0, { lastFiredTurn: 3 });
  assert.equal(reloaded(crossbow, 4), false); // 1 turn later
  assert.equal(reloaded(crossbow, 5), true); // 2 turns later
  const grid = row(3);
  assert.equal(canFireAt(crossbow, { q: 3, r: 0 }, 'direct', grid, [], 4), false);
  assert.equal(canFireAt(crossbow, { q: 3, r: 0 }, 'direct', grid, [], 5), true);
});

test('a spent unit (no ammo) cannot fire (§4.4)', () => {
  const empty = firer('ranged.archer', { q: 0, r: 0 }, 0, { shotsLeft: 0 });
  assert.equal(canFireAt(empty, { q: 2, r: 0 }, 'direct', row(2), [], 1), false);
});

test('a horse archer may fire into its rear; an archer may not (§4.4)', () => {
  const grid = row(2);
  const horse = firer('ranged.horseArcher', { q: 1, r: 0 }, 0); // front toward +q, rear toward -q
  assert.equal(canFireAt(horse, { q: 0, r: 0 }, 'arcing', grid, [], 1), true); // rear hex, in range 2
  const archer = firer('ranged.archer', { q: 1, r: 0 }, 0);
  assert.equal(canFireAt(archer, { q: 0, r: 0 }, 'arcing', grid, [], 1), false); // behind — out of arc
});

test('the crossbow close-combat penalty stacks onto the ×0.5 close mode (§4.4)', () => {
  const crossbow = firer('ranged.crossbow', { q: 0, r: 0 }, 0);
  const mods = rangedModeModifiers(crossbow, 'close');
  assert.deepEqual(mods.map((m) => m.value), [0.5, 0.75]);
});
