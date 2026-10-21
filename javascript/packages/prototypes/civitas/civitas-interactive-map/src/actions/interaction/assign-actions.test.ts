import assert from "node:assert/strict";
import test from "node:test";
import {
  createTestApp,
  type TestApp,
} from "../../test-support";

// Each test builds a fresh app with memory storage and fake timers.

let app: TestApp = createTestApp();

function reset(): void {
  app = createTestApp();
}

// The one-owner invariant as a count, so a duplicate cannot hide from a spot check.
function assertOneOwner(): void {
  let total = 0;
  for (const country of app.store.world.countries.value) {
    total += country.provinceIds.length;
  }
  assert.equal(
    app.store.world.countryOfProvince.value.size,
    total,
    "a province may belong to at most one country",
  );
}

test("beginStroke refuses when the mode is off or no country is active", () => {
  reset();
  const country = app.registry.addCountry("A");

  app.registry.setActiveCountry(country.id);
  assert.equal(app.registry.beginStroke(4, false), null, "the mode is off");

  app.registry.setAssignMode(true);
  app.registry.setActiveCountry(null);
  assert.equal(app.registry.beginStroke(4, false), null, "no country is active");

  assert.equal(app.store.world.countryOfProvince.value.size, 0, "nothing in the store changed");
  assert.equal(app.store.assign.painting.value, false);
});

test("a stroke moves provinces between countries and never duplicates them", () => {
  reset();
  const a = app.registry.addCountry("A");
  const b = app.registry.addCountry("B");
  app.registry.assignProvinces(a.id, [1, 2, 3, 4, 5]);

  app.registry.setAssignMode(true);
  app.registry.setActiveCountry(b.id);
  assert.equal(app.registry.beginStroke(3, false), "assign", "3 belongs to A, so B assigns it");
  app.registry.extendStroke([4, 5, 6]);
  app.registry.endStroke();

  const owner = app.store.world.countryOfProvince.value;
  assert.deepEqual([owner.get(1), owner.get(2)], [a.id, a.id], "A keeps 1 and 2");
  for (const id of [3, 4, 5, 6]) {
    assert.equal(owner.get(id), b.id, "B holds " + id);
  }
  assertOneOwner();
});

test("the action is locked at beginStroke, not re-decided per province", () => {
  reset();
  const a = app.registry.addCountry("A");
  const b = app.registry.addCountry("B");
  app.registry.assignProvinces(a.id, [1, 2]);
  app.registry.assignProvinces(b.id, [3, 4]);

  app.registry.setAssignMode(true);
  app.registry.setActiveCountry(a.id);
  // Started on an owned province, so the whole stroke erases.
  assert.equal(app.registry.beginStroke(1, false), "erase");
  // The second batch touches nothing A owns. A per-event decision would flip to assign there.
  app.registry.extendStroke([2]);
  app.registry.extendStroke([3, 4]);
  app.registry.endStroke();

  assert.equal(app.store.world.countryOfProvince.value.size, 0, "everything the stroke touched is released");
  assertOneOwner();
});

test("a province visited twice in one stroke is applied once", () => {
  reset();
  const a = app.registry.addCountry("A");
  app.registry.setAssignMode(true);
  app.registry.setActiveCountry(a.id);

  app.registry.beginStroke(7, false);
  app.registry.extendStroke([8, 8, 9]);
  const afterFirst = app.store.world.countries.value;
  app.registry.extendStroke([7, 8, 9]);
  assert.equal(app.store.world.countries.value, afterFirst, "the second pass writes no new array");
  app.registry.endStroke();

  assert.deepEqual(app.store.world.countries.value[0].provinceIds, [7, 8, 9]);
});

test("deleting the active country mid-stroke cancels it instead of mass-unassigning", () => {
  reset();
  const a = app.registry.addCountry("A");
  const b = app.registry.addCountry("B");
  app.registry.assignProvinces(b.id, [20, 21, 22]);

  app.registry.setAssignMode(true);
  app.registry.setActiveCountry(a.id);
  app.registry.beginStroke(5, false);

  app.registry.deleteCountry(a.id);
  app.registry.extendStroke([20, 21, 22]);

  const owner = app.store.world.countryOfProvince.value;
  for (const id of [20, 21, 22]) {
    assert.equal(owner.get(id), b.id, "B still holds " + id);
  }
  assert.equal(app.store.assign.painting.value, false, "the stroke is over");
  assertOneOwner();
});

test("deleteCountry releases every province it held and gives them to nobody", () => {
  reset();
  const a = app.registry.addCountry("A");
  const b = app.registry.addCountry("B");
  app.registry.assignProvinces(a.id, [1, 2, 3]);
  app.registry.assignProvinces(b.id, [4]);

  app.registry.deleteCountry(a.id);

  const owner = app.store.world.countryOfProvince.value;
  for (const id of [1, 2, 3]) {
    assert.equal(owner.has(id), false, "province " + id + " is free again");
  }
  assert.equal(owner.get(4), b.id, "B is untouched");
  assertOneOwner();
});

test("activeCountryId auto-heals to null when its country is deleted", () => {
  reset();
  const a = app.registry.addCountry("A");
  app.registry.setAssignMode(true);
  app.registry.setActiveCountry(a.id);
  assert.equal(app.store.assign.activeCountryId.value, a.id);

  app.registry.deleteCountry(a.id);
  assert.equal(app.store.assign.activeCountryId.value, null, "no stale id can reach assignProvinces");
  assert.equal(app.store.assign.mode.value, true, "the mode is left on and simply inert");
  assert.equal(app.registry.beginStroke(1, false), null);

  const next = app.registry.addCountry("B");
  assert.notEqual(next.id, a.id, "ids are monotonic, so the private id is never resurrected");
  assert.equal(app.store.assign.activeCountryId.value, null);
});

test("both endStroke and cancelStroke clear the painting flag", () => {
  reset();
  const a = app.registry.addCountry("A");
  app.registry.setAssignMode(true);
  app.registry.setActiveCountry(a.id);

  app.registry.beginStroke(1, false);
  assert.equal(app.store.assign.painting.value, true);
  app.registry.endStroke();
  assert.equal(app.store.assign.painting.value, false);

  app.registry.beginStroke(2, false);
  assert.equal(app.store.assign.painting.value, true);
  app.registry.cancelStroke();
  assert.equal(app.store.assign.painting.value, false);
});

test("toggleAssignMode flips the mode both ways", () => {
  reset();

  app.registry.toggleAssignMode();
  assert.equal(app.store.assign.mode.value, true);
  app.registry.toggleAssignMode();
  assert.equal(app.store.assign.mode.value, false);
});

test("an active id naming no country leaves the mode inert", () => {
  // A stored document or a delete race can supply an unknown id. It must not reach `assignProvinces`.
  reset();
  app.registry.setAssignMode(true);
  app.registry.setActiveCountry(4242);

  assert.equal(app.store.assign.activeCountryId.value, null);
  assert.equal(app.registry.beginStroke(1, false), null);
  assert.equal(app.store.assign.painting.value, false);
  assert.equal(app.store.world.countryOfProvince.value.size, 0);
});

test("a click on the sea starts the stroke without assigning anything", () => {
  // The stroke still arms over the sea, so a drag from the coast paints.
  reset();
  const a = app.registry.addCountry("A");
  app.registry.setAssignMode(true);
  app.registry.setActiveCountry(a.id);

  assert.equal(app.registry.beginStroke(null, false), "assign");
  assert.equal(app.store.assign.painting.value, true);
  assert.equal(app.store.world.countryOfProvince.value.size, 0, "the sea belongs to nobody");

  app.registry.extendStroke([9]);
  assert.equal(app.store.world.countryOfProvince.value.get(9), a.id, "the drag paints as soon as it hits land");
  app.registry.endStroke();
  assertOneOwner();
});

test("clicking a province the active country already owns removes it", () => {
  reset();
  const a = app.registry.addCountry("A");
  app.registry.assignProvinces(a.id, [4]);

  app.registry.setAssignMode(true);
  app.registry.setActiveCountry(a.id);
  assert.equal(app.registry.beginStroke(4, false), "erase", "a click on my own province takes it back");
  app.registry.endStroke();

  assert.equal(app.store.world.countryOfProvince.value.has(4), false);
  assert.deepEqual(app.store.world.countries.value[0].provinceIds, []);
  assertOneOwner();
});

test("an alt stroke strips provinces from whatever country holds them", () => {
  // The eraser does not need the active country to be the owner.
  reset();
  const a = app.registry.addCountry("A");
  const b = app.registry.addCountry("B");
  app.registry.assignProvinces(a.id, [1, 2, 3]);

  app.registry.setAssignMode(true);
  app.registry.setActiveCountry(b.id);
  assert.equal(app.registry.beginStroke(1, true), "erase");
  app.registry.extendStroke([2, 3]);
  app.registry.endStroke();

  assert.equal(app.store.world.countryOfProvince.value.size, 0, "A lost all three and B gained none");
  assert.deepEqual(app.store.world.countries.value[1].provinceIds, [], "the active country stays empty");
  assertOneOwner();
});

test("painting a province the active country already holds writes no new array", () => {
  // `assignProvinces` no-ops through `sameIds`: no write, no tint work, no border push.
  reset();
  const a = app.registry.addCountry("A");
  app.registry.assignProvinces(a.id, [5]);

  app.registry.setAssignMode(true);
  app.registry.setActiveCountry(a.id);
  app.registry.beginStroke(6, false);
  const afterFirst = app.store.world.countries.value;

  app.registry.extendStroke([5]);
  assert.equal(app.store.world.countries.value, afterFirst, "re-assigning an owned province changes nothing");
  app.registry.endStroke();

  assert.deepEqual(app.store.world.countries.value[0].provinceIds, [5, 6]);
});

test("extendStroke and endStroke outside a stroke change nothing", () => {
  reset();
  const a = app.registry.addCountry("A");
  app.registry.setAssignMode(true);
  app.registry.setActiveCountry(a.id);
  const before = app.store.world.countries.value;

  app.registry.extendStroke([1, 2, 3]);
  assert.equal(app.store.world.countries.value, before, "a pointermove with no button down paints nothing");
  assert.equal(app.store.assign.painting.value, false);

  app.registry.endStroke();
  assert.equal(app.store.assign.painting.value, false, "ending a stroke that never began is a no-op");
});

test("cancelStroke keeps the provinces the stroke had already painted", () => {
  // A pointercancel does not undo; it only skips the border flush.
  reset();
  const a = app.registry.addCountry("A");
  app.registry.setAssignMode(true);
  app.registry.setActiveCountry(a.id);

  app.registry.beginStroke(11, false);
  app.registry.extendStroke([12]);
  app.registry.cancelStroke();

  assert.deepEqual(app.store.world.countries.value[0].provinceIds, [11, 12]);
  assert.equal(app.store.assign.painting.value, false);

  const after = app.store.world.countries.value;
  app.registry.extendStroke([13]);
  assert.equal(app.store.world.countries.value, after, "the cancelled stroke accepts nothing more");
  assertOneOwner();
});
