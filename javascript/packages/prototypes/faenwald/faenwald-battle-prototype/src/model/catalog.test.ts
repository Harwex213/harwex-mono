/**
 * Tests for the unit catalog (§4). Guards the data table against typos and
 * keeps it faithful to the GDD. Run with the Node test runner:
 *   node --test src/model/catalog.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RANGED_AMMO, UNIT_CATALOG, UNIT_DEFS, getUnitDef } from './catalog.ts';

test('every entry is keyed by its own id', () => {
  for (const [key, def] of Object.entries(UNIT_CATALOG)) {
    assert.equal(key, def.id, `key ${key}`);
  }
});

test('catalog holds all 15 GDD subtypes with unique ids', () => {
  assert.equal(UNIT_DEFS.length, 15);
  const ids = new Set(UNIT_DEFS.map((d) => d.id));
  assert.equal(ids.size, UNIT_DEFS.length);
});

test('getUnitDef looks entries up by id', () => {
  assert.equal(getUnitDef('cavalry.heavy')?.name, 'Heavy cavalry');
  assert.equal(getUnitDef('nope'), undefined);
});

test('base stats match the GDD §4 tables', () => {
  const expect = (id: string, hp: number, atk: number, morale: number, speed: number) => {
    const d = getUnitDef(id)!;
    assert.deepEqual(
      { hp: d.baseHp, atk: d.baseAtk, morale: d.baseMorale, speed: d.speed },
      { hp, atk, morale, speed },
      id,
    );
  };
  expect('spear.light', 80, 12, 70, 3);
  expect('spear.medium', 120, 15, 85, 2);
  expect('spear.heavy', 160, 18, 110, 1);
  expect('shock.light', 60, 20, 70, 3);
  expect('shock.medium', 90, 25, 85, 2);
  expect('shock.heavy', 120, 30, 100, 1);
  expect('cavalry.light', 70, 10, 80, 5);
  expect('cavalry.medium', 95, 15, 90, 4);
  expect('cavalry.heavy', 120, 25, 100, 3);
  expect('ranged.archer', 50, 6, 70, 3);
  expect('ranged.horseArcher', 80, 6, 80, 5);
  expect('ranged.longbow', 60, 10, 80, 3);
  expect('ranged.crossbow', 60, 40, 80, 3);
});

test('cavalry carry the documented ram modifiers', () => {
  assert.equal(getUnitDef('cavalry.light')?.ramMod, 8);
  assert.equal(getUnitDef('cavalry.medium')?.ramMod, 16);
  assert.equal(getUnitDef('cavalry.heavy')?.ramMod, 24);
});

test('matchup perks are captured as data', () => {
  assert.equal(getUnitDef('spear.light')?.perks.takesFromRanged, 1.5);
  assert.equal(getUnitDef('spear.heavy')?.perks.takesFromCharge, 0.5);
  assert.equal(getUnitDef('spear.heavy')?.perks.takesFromRanged, 0.5);
  assert.equal(getUnitDef('cavalry.light')?.perks.dealsToRanged, 1.5);
  assert.equal(getUnitDef('cavalry.heavy')?.perks.takesFromRanged, 0.5);
});

test('all shock infantry treat the rear as a flank for morale (§4.2)', () => {
  for (const d of UNIT_DEFS.filter((u) => u.category === 'shock')) {
    assert.equal(d.perks.rearActsAsFlank, true, d.id);
  }
});

test('only ranged units carry ammo, and they carry 8 shots (§4.4)', () => {
  for (const d of UNIT_DEFS) {
    if (d.category === 'ranged') {
      assert.equal(d.ammo, RANGED_AMMO, d.id);
    } else {
      assert.equal(d.ammo, undefined, d.id);
    }
  }
});

test('special units do not fight; combatants do (§4.5)', () => {
  for (const d of UNIT_DEFS) {
    assert.equal(d.fights, d.category !== 'special', d.id);
  }
});

test('the non-hireable longbowman has a null cost (§4.4)', () => {
  assert.equal(getUnitDef('ranged.longbow')?.cost, null);
  // Everyone else has a numeric cost.
  for (const d of UNIT_DEFS.filter((u) => u.id !== 'ranged.longbow')) {
    assert.equal(typeof d.cost, 'number', d.id);
  }
});
