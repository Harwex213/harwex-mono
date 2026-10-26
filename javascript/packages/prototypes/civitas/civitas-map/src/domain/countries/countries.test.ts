import assert from "node:assert/strict";
import test from "node:test";
import {
  assignProvinces,
  createCountry,
  keepProvinces,
  nextCountryIdAfter,
  ownerOf,
  strokeActionFor,
  type Country,
} from "./countries";

function country(id: number, provinceIds: number[]): Country {
  return { ...createCountry(id), provinceIds };
}

test("a new country gets a placeholder name and a palette colour", () => {
  assert.deepEqual(createCountry(2), { id: 2, name: "Country 2", colorHex: "#4f7fb5", provinceIds: [] });
  assert.equal(createCountry(17).colorHex, createCountry(1).colorHex);
});

test("the next id follows the highest id, not the count", () => {
  assert.equal(nextCountryIdAfter([]), 1);
  assert.equal(nextCountryIdAfter([country(4, []), country(2, [])]), 5);
});

test("assigning moves a province from its old owner to the new one", () => {
  const list = [country(1, [1, 2, 3]), country(2, [7])];
  const next = assignProvinces(list, 2, [3, 5]);

  assert.deepEqual(next.map((entry) => entry.provinceIds), [[1, 2], [3, 5, 7]]);
  assert.deepEqual(ownerOf(next), new Map([[1, 1], [2, 1], [3, 2], [5, 2], [7, 2]]));
});

test("a null country takes provinces out of every country", () => {
  const list = [country(1, [1, 2]), country(2, [3])];

  assert.deepEqual(assignProvinces(list, null, [2, 3]).map((entry) => entry.provinceIds), [[1], []]);
});

test("an assignment that changes nothing returns the same list and keeps unchanged countries", () => {
  const list = [country(1, [1, 2]), country(2, [3])];

  assert.equal(assignProvinces(list, 1, [2]), list);
  assert.equal(assignProvinces(list, 1, []), list);

  const next = assignProvinces(list, 1, [4]);

  assert.notEqual(next, list);
  assert.equal(next[1], list[1]);
});

test("keepProvinces drops rejected ids and returns the same list when nothing is dropped", () => {
  const list = [country(1, [1, 2]), country(2, [3])];

  assert.equal(keepProvinces(list, () => true), list);
  assert.deepEqual(keepProvinces(list, (id) => id !== 2).map((entry) => entry.provinceIds), [[1], [3]]);
});

test("a stroke that starts on a province of the active country takes provinces out", () => {
  const owners = new Map([[1, 1], [2, 2]]);

  assert.equal(strokeActionFor(1, 1, owners, false), "erase");
  assert.equal(strokeActionFor(2, 1, owners, false), "assign");
  assert.equal(strokeActionFor(null, 1, owners, false), "assign");
  assert.equal(strokeActionFor(2, 1, owners, true), "erase");
});
