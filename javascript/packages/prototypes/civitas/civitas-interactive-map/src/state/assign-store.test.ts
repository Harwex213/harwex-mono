import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryStorage } from "./persistence";
import {
  activeCountryId,
  assignMode,
  beginStroke,
  cancelStroke,
  endStroke,
  extendStroke,
  painting,
  setActiveCountry,
  setAssignMode,
  strokeActionFor,
  toggleAssignMode,
} from "./assign-store";
import {
  addCountry,
  assignProvinces,
  countries,
  countryOfProvince,
  deleteCountry,
  initWorldStore,
} from "./world-store";
import type { StateStorage, TimerHandle, Timers } from "./persistence";

// The signal stores ARE testable in Node — T05 proved it. `initWorldStore` with
// an injected storage and injected timers IS the reset between tests.

function fakeTimers(): Timers {
  let nextHandle = 1;
  const armed = new Map<number, () => void>();
  return {
    set(fn: () => void): TimerHandle {
      const handle = nextHandle;
      nextHandle += 1;
      armed.set(handle, fn);
      return handle as unknown as TimerHandle;
    },
    clear(handle: TimerHandle): void {
      armed.delete(handle as unknown as number);
    },
  };
}

function fakeStorage(): StateStorage {
  return createMemoryStorage();
}

function reset(): void {
  initWorldStore({ storage: fakeStorage(), timers: fakeTimers() });
  setAssignMode(false);
  setActiveCountry(null);
  cancelStroke();
}

// The one-owner invariant stated as a COUNT. A duplicate cannot hide behind a
// spot check.
function assertOneOwner(): void {
  let total = 0;
  for (const country of countries.value) {
    total += country.provinceIds.length;
  }
  assert.equal(
    countryOfProvince.value.size,
    total,
    "a province may belong to at most one country",
  );
}

test("strokeActionFor erases only for the active country's own provinces", () => {
  const owner = new Map<number, number>([
    [1, 10],
    [2, 20],
  ]);

  assert.equal(strokeActionFor(1, 10, owner, false), "erase", "already mine — a click removes it");
  assert.equal(strokeActionFor(2, 10, owner, false), "assign", "another country's — reassign");
  assert.equal(strokeActionFor(3, 10, owner, false), "assign", "unowned — assign");
  assert.equal(strokeActionFor(null, 10, owner, false), "assign", "the sea starts an assign");

  for (const id of [1, 2, 3, null]) {
    assert.equal(strokeActionFor(id, 10, owner, true), "erase", "alt always erases, id " + id);
  }
});

test("beginStroke refuses when the mode is off or no country is active", () => {
  reset();
  const country = addCountry("A");

  setActiveCountry(country.id);
  assert.equal(beginStroke(4, false), null, "the mode is off");

  setAssignMode(true);
  setActiveCountry(null);
  assert.equal(beginStroke(4, false), null, "no country is active");

  assert.equal(countryOfProvince.value.size, 0, "nothing in the store changed");
  assert.equal(painting.value, false);
});

test("a stroke moves provinces between countries and never duplicates them", () => {
  reset();
  const a = addCountry("A");
  const b = addCountry("B");
  assignProvinces(a.id, [1, 2, 3, 4, 5]);

  setAssignMode(true);
  setActiveCountry(b.id);
  assert.equal(beginStroke(3, false), "assign", "3 belongs to A, so B assigns it");
  extendStroke([4, 5, 6]);
  endStroke();

  const owner = countryOfProvince.value;
  assert.deepEqual([owner.get(1), owner.get(2)], [a.id, a.id], "A keeps 1 and 2");
  for (const id of [3, 4, 5, 6]) {
    assert.equal(owner.get(id), b.id, "B holds " + id);
  }
  assertOneOwner();
});

test("the action is locked at beginStroke, not re-decided per province", () => {
  reset();
  const a = addCountry("A");
  const b = addCountry("B");
  assignProvinces(a.id, [1, 2]);
  assignProvinces(b.id, [3, 4]);

  setAssignMode(true);
  setActiveCountry(a.id);
  // Started on a province A already owns, so the whole stroke erases — including
  // the provinces it crosses that A does not own.
  assert.equal(beginStroke(1, false), "erase");
  // Two separate batches, as two pointermove events would deliver them. The
  // second one touches nothing A owns, so an action re-decided per event would
  // flip to "assign" here and hand B's provinces to A.
  extendStroke([2]);
  extendStroke([3, 4]);
  endStroke();

  assert.equal(countryOfProvince.value.size, 0, "everything the stroke touched is released");
  assertOneOwner();
});

test("a province visited twice in one stroke is applied once", () => {
  reset();
  const a = addCountry("A");
  setAssignMode(true);
  setActiveCountry(a.id);

  beginStroke(7, false);
  extendStroke([8, 8, 9]);
  const afterFirst = countries.value;
  extendStroke([7, 8, 9]);
  assert.equal(countries.value, afterFirst, "the second pass writes no new array");
  endStroke();

  assert.deepEqual(countries.value[0].provinceIds, [7, 8, 9]);
});

test("deleting the active country mid-stroke cancels it instead of mass-unassigning", () => {
  reset();
  const a = addCountry("A");
  const b = addCountry("B");
  assignProvinces(b.id, [20, 21, 22]);

  setAssignMode(true);
  setActiveCountry(a.id);
  beginStroke(5, false);

  deleteCountry(a.id);
  extendStroke([20, 21, 22]);

  const owner = countryOfProvince.value;
  for (const id of [20, 21, 22]) {
    assert.equal(owner.get(id), b.id, "B still holds " + id);
  }
  assert.equal(painting.value, false, "the stroke is over");
  assertOneOwner();
});

test("deleteCountry releases every province it held and gives them to nobody", () => {
  reset();
  const a = addCountry("A");
  const b = addCountry("B");
  assignProvinces(a.id, [1, 2, 3]);
  assignProvinces(b.id, [4]);

  deleteCountry(a.id);

  const owner = countryOfProvince.value;
  for (const id of [1, 2, 3]) {
    assert.equal(owner.has(id), false, "province " + id + " is free again");
  }
  assert.equal(owner.get(4), b.id, "B is untouched");
  assertOneOwner();
});

test("activeCountryId auto-heals to null when its country is deleted", () => {
  reset();
  const a = addCountry("A");
  setAssignMode(true);
  setActiveCountry(a.id);
  assert.equal(activeCountryId.value, a.id);

  deleteCountry(a.id);
  assert.equal(activeCountryId.value, null, "no stale id can reach assignProvinces");
  assert.equal(assignMode.value, true, "the mode is left on and simply inert");
  assert.equal(beginStroke(1, false), null);

  const next = addCountry("B");
  assert.notEqual(next.id, a.id, "ids are monotonic, so the private id is never resurrected");
  assert.equal(activeCountryId.value, null);
});

test("both endStroke and cancelStroke clear the painting flag", () => {
  reset();
  const a = addCountry("A");
  setAssignMode(true);
  setActiveCountry(a.id);

  beginStroke(1, false);
  assert.equal(painting.value, true);
  endStroke();
  assert.equal(painting.value, false);

  beginStroke(2, false);
  assert.equal(painting.value, true);
  cancelStroke();
  assert.equal(painting.value, false);
});

test("toggleAssignMode flips the mode both ways", () => {
  reset();

  toggleAssignMode();
  assert.equal(assignMode.value, true);
  toggleAssignMode();
  assert.equal(assignMode.value, false);
});

test("an active id naming no country leaves the mode inert", () => {
  // A stored document, or a race between a delete and a click, can hand over an
  // id nothing answers to. It must never reach `assignProvinces`.
  reset();
  setAssignMode(true);
  setActiveCountry(4242);

  assert.equal(activeCountryId.value, null);
  assert.equal(beginStroke(1, false), null);
  assert.equal(painting.value, false);
  assert.equal(countryOfProvince.value.size, 0);
});

test("a click on the sea starts the stroke without assigning anything", () => {
  // `provinceAt` returns null over the sea. The stroke still has to arm, or a
  // drag that begins just off the coast paints nothing at all.
  reset();
  const a = addCountry("A");
  setAssignMode(true);
  setActiveCountry(a.id);

  assert.equal(beginStroke(null, false), "assign");
  assert.equal(painting.value, true);
  assert.equal(countryOfProvince.value.size, 0, "the sea belongs to nobody");

  extendStroke([9]);
  assert.equal(countryOfProvince.value.get(9), a.id, "the drag paints as soon as it hits land");
  endStroke();
  assertOneOwner();
});

test("clicking a province the active country already owns removes it", () => {
  reset();
  const a = addCountry("A");
  assignProvinces(a.id, [4]);

  setAssignMode(true);
  setActiveCountry(a.id);
  assert.equal(beginStroke(4, false), "erase", "a click on my own province takes it back");
  endStroke();

  assert.equal(countryOfProvince.value.has(4), false);
  assert.deepEqual(countries.value[0].provinceIds, []);
  assertOneOwner();
});

test("an alt stroke strips provinces from whatever country holds them", () => {
  // An eraser erases. It does not check ownership first, and it does not need
  // the active country to be the owner.
  reset();
  const a = addCountry("A");
  const b = addCountry("B");
  assignProvinces(a.id, [1, 2, 3]);

  setAssignMode(true);
  setActiveCountry(b.id);
  assert.equal(beginStroke(1, true), "erase");
  extendStroke([2, 3]);
  endStroke();

  assert.equal(countryOfProvince.value.size, 0, "A lost all three and B gained none");
  assert.deepEqual(countries.value[1].provinceIds, [], "the active country stays empty");
  assertOneOwner();
});

test("painting a province the active country already holds writes no new array", () => {
  // The edge case the design names: `assignProvinces` no-ops through its
  // `sameIds` check, so no signal write, no tint work and no border push.
  reset();
  const a = addCountry("A");
  assignProvinces(a.id, [5]);

  setAssignMode(true);
  setActiveCountry(a.id);
  beginStroke(6, false);
  const afterFirst = countries.value;

  extendStroke([5]);
  assert.equal(countries.value, afterFirst, "re-assigning an owned province changes nothing");
  endStroke();

  assert.deepEqual(countries.value[0].provinceIds, [5, 6]);
});

test("extendStroke and endStroke outside a stroke change nothing", () => {
  reset();
  const a = addCountry("A");
  setAssignMode(true);
  setActiveCountry(a.id);
  const before = countries.value;

  extendStroke([1, 2, 3]);
  assert.equal(countries.value, before, "a pointermove with no button down paints nothing");
  assert.equal(painting.value, false);

  endStroke();
  assert.equal(painting.value, false, "ending a stroke that never began is a no-op");
});

test("cancelStroke keeps the provinces the stroke had already painted", () => {
  // A pointercancel does not undo. The writes are already in the store; only the
  // border flush is skipped.
  reset();
  const a = addCountry("A");
  setAssignMode(true);
  setActiveCountry(a.id);

  beginStroke(11, false);
  extendStroke([12]);
  cancelStroke();

  assert.deepEqual(countries.value[0].provinceIds, [11, 12]);
  assert.equal(painting.value, false);

  const after = countries.value;
  extendStroke([13]);
  assert.equal(countries.value, after, "the cancelled stroke accepts nothing more");
  assertOneOwner();
});
