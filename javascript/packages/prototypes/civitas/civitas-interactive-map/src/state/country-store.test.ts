import assert from "node:assert/strict";
import test from "node:test";
import { SELECTED_TINT_ALPHA, TINT_ALPHA, tintWordFor } from "../ui/tint-layer";
import { DEBOUNCE_MS, createMemoryStorage } from "./persistence";
import { borderPhase } from "./borders-store";
import { createCountry } from "./schema";
import { loadPhase } from "./map-store";
import {
  BORDER_PUSH_MS,
  buildTintWordTable,
  countryAggregates,
  countryTintWords,
  disposeCountrySync,
  flushCountryBorders,
  initCountrySync,
  maxProvinceId,
} from "./country-store";
import {
  addCountry,
  assignProvinces,
  deleteCountry,
  initWorldStore,
  updateCountry,
} from "./world-store";
import type { Country } from "./schema";
import type { TimerHandle, Timers } from "./persistence";

type CountingTimers = Timers & { sets: number; run(): void; armed(): number };

function fakeTimers(): CountingTimers {
  let nextHandle = 1;
  const armed = new Map<number, () => void>();
  const timers: CountingTimers = {
    sets: 0,
    set(fn: () => void): TimerHandle {
      timers.sets += 1;
      const handle = nextHandle;
      nextHandle += 1;
      armed.set(handle, fn);
      return handle as unknown as TimerHandle;
    },
    clear(handle: TimerHandle): void {
      armed.delete(handle as unknown as number);
    },
    run(): void {
      const due = [...armed.entries()];
      armed.clear();
      for (const [, fn] of due) {
        fn();
      }
    },
    armed(): number {
      return armed.size;
    },
  };
  return timers;
}

function reset(): void {
  disposeCountrySync();
  initWorldStore({ storage: createMemoryStorage(), timers: fakeTimers() });
}

function country(id: number, colorHex: string, provinceIds: number[]): Country {
  const made = createCountry(id, "Country " + id);
  made.colorHex = colorHex;
  made.provinceIds = provinceIds;
  return made;
}

test("the tint table carries each country's word at each of its province ids", () => {
  const words = buildTintWordTable([country(1, "#c0563f", [2, 5])], 6);

  const expected = tintWordFor("#c0563f", TINT_ALPHA);
  assert.equal(words.length, 7, "one entry per id from 0 to max");
  assert.equal(words[0], 0, "index 0 is NO_PROVINCE and is never tinted");
  assert.equal(words[2], expected);
  assert.equal(words[5], expected);
  assert.deepEqual([words[1], words[3], words[4], words[6]], [0, 0, 0, 0]);
});

test("the tint table ignores ids outside 1..max and an unusable colour", () => {
  const words = buildTintWordTable(
    [country(1, "#c0563f", [0, 3, 99]), country(2, "not-a-hex", [4])],
    5,
  );

  assert.equal(words[0], 0, "id 0 is never tinted");
  assert.notEqual(words[3], 0);
  assert.equal(words[4], 0, "an unparseable hex leaves the country untinted, not black");
  assert.equal(words.length, 6, "the out-of-range id 99 does not grow the array");
});

test("two countries get two different words, and a recolour changes one of them", () => {
  const before = buildTintWordTable(
    [country(1, "#c0563f", [1]), country(2, "#4f7fb5", [2])],
    3,
  );
  assert.notEqual(before[1], before[2]);

  const after = buildTintWordTable(
    [country(1, "#6f9e57", [1]), country(2, "#4f7fb5", [2])],
    3,
  );
  assert.notEqual(after[1], before[1], "country 1 recoloured");
  assert.equal(after[2], before[2], "country 2 untouched");
});

test("in Node the manifest never loads, so nothing reads it eagerly", () => {
  // The guard that proves `maxProvinceId` gates on `loadPhase` and not on a
  // module-level manifest read.
  reset();
  addCountry("A");

  assert.equal(maxProvinceId.value, 0);
  assert.equal(countryTintWords.value.length, 1, "no map, no tint table");
});

test("countryAggregates is a cache that invalidates on assignment change", () => {
  reset();
  const a = addCountry("A");

  const before = countryAggregates.value;
  assert.equal(countryAggregates.value, before, "no change, no recompute");

  assignProvinces(a.id, [1, 2, 3]);
  const after = countryAggregates.value;
  assert.notEqual(after, before, "the assignment invalidated it");
  assert.equal(after.get(a.id)?.provinceCount, 3);
  // The manifest never loads in Node, so nothing resolves and the derived
  // geometry is empty rather than wrong.
  assert.equal(after.get(a.id)?.resolvedCount, 0);
  assert.equal(after.get(a.id)?.bounds, null);
});

test("countryAggregates survives a rename without recomputing the geometry wrongly", () => {
  reset();
  const a = addCountry("A");
  assignProvinces(a.id, [4]);

  updateCountry(a.id, { name: "Renamed" });
  assert.equal(countryAggregates.value.get(a.id)?.provinceCount, 1);
});

test("five rapid assignment changes arm exactly ONE border-push timer", () => {
  // Counting `set` calls, not `pending()`: T05 recorded that `pending()` alone
  // cannot tell a fixed window from a restarting one, and that mutant survived
  // the first time.
  reset();
  const timers = fakeTimers();
  const a = addCountry("A");

  initCountrySync({ timers, delayMs: 120 });
  // The effect runs once on registration and arms the first window. Drain it, so
  // what is counted below is only what the five changes did.
  timers.run();
  const baseline = timers.sets;

  for (const id of [10, 11, 12, 13, 14]) {
    assignProvinces(a.id, [id]);
  }

  assert.equal(timers.sets - baseline, 1, "one fixed window, not one timer per change");
  assert.equal(timers.armed(), 1);
  disposeCountrySync();
});

test("flushCountryBorders fires the pending push and disarms the timer", () => {
  reset();
  const timers = fakeTimers();
  const a = addCountry("A");

  initCountrySync({ timers, delayMs: 120 });
  timers.run();
  assignProvinces(a.id, [1]);
  assert.equal(timers.armed(), 1, "a push is waiting");

  flushCountryBorders();
  assert.equal(timers.armed(), 0, "the window is closed, not left to expire");

  disposeCountrySync();
});

test("disposeCountrySync stops the effect, so a later change arms nothing", () => {
  reset();
  const timers = fakeTimers();
  const a = addCountry("A");

  initCountrySync({ timers, delayMs: 120 });
  timers.run();
  disposeCountrySync();
  const baseline = timers.sets;

  assignProvinces(a.id, [1, 2]);
  assert.equal(timers.sets, baseline, "nothing is scheduled after disposal");
});

test("the border-push window is 120 ms, far shorter than the persistence one", () => {
  // 120, not T05's 400: the country border has to stay visibly live under a
  // paint drag, while a localStorage write does not.
  assert.equal(BORDER_PUSH_MS, 120);
  assert.ok(BORDER_PUSH_MS < DEBOUNCE_MS, "a border push that waited out a save would look stuck");
});

test("the tint table is a single empty slot until the map has loaded", () => {
  const none = buildTintWordTable([country(1, "#c0563f", [2, 5])], 0);
  assert.deepEqual(Array.from(none), [0], "index 0 only, and it is never tinted");

  const negative = buildTintWordTable([country(1, "#c0563f", [2])], -5);
  assert.equal(negative.length, 1, "a negative max cannot produce a negative length");
});

test("maxProvinceId stays 0 when the phase says ready but no assets arrived", () => {
  // `getMapAssets()` is a plain module variable. A computed that trusted
  // `loadPhase` alone would read `assets.manifest` off null and throw inside a
  // signal graph, which takes the whole app down.
  reset();
  loadPhase.value = "ready";

  assert.equal(maxProvinceId.value, 0);
  assert.equal(countryTintWords.value.length, 1);

  loadPhase.value = "idle";
});

test("countryAggregates is empty with no countries and drops a deleted one", () => {
  reset();
  assert.equal(countryAggregates.value.size, 0);

  const a = addCountry("A");
  const b = addCountry("B");
  assignProvinces(a.id, [1, 2]);
  assert.equal(countryAggregates.value.size, 2);

  deleteCountry(a.id);
  assert.equal(countryAggregates.value.has(a.id), false, "no aggregate outlives its country");
  assert.equal(countryAggregates.value.get(b.id)?.provinceCount, 0);
});

test("the border scan completing re-arms the push", () => {
  // The first push usually happens while the worker is still scanning, and
  // `setCountryAssignment` returns early with no worker. Without `borderPhase`
  // in the effect, a country hydrated from localStorage never gets its border.
  reset();
  const timers = fakeTimers();
  const a = addCountry("A");

  initCountrySync({ timers, delayMs: 120 });
  timers.run();
  assignProvinces(a.id, [1, 2, 3]);
  timers.run();
  const baseline = timers.sets;

  borderPhase.value = "scanning";
  borderPhase.value = "ready";

  assert.ok(timers.sets > baseline, "the scan finishing schedules a fresh push");
  assert.equal(timers.armed(), 1);

  disposeCountrySync();
  borderPhase.value = "idle";
});

test("the disposer initCountrySync returns stops the push", () => {
  reset();
  const timers = fakeTimers();
  const a = addCountry("A");

  const dispose = initCountrySync({ timers, delayMs: 120 });
  timers.run();
  dispose();
  const baseline = timers.sets;

  assignProvinces(a.id, [7]);
  assert.equal(timers.sets, baseline, "the returned disposer is the real one");
});

test("the emphasis argument raises one country's alpha and leaves the rest alone", () => {
  const list = [country(1, "#c0563f", [1]), country(2, "#4f7fb5", [2])];
  const words = buildTintWordTable(list, 3, 1, SELECTED_TINT_ALPHA);

  assert.equal(words[1], tintWordFor("#c0563f", SELECTED_TINT_ALPHA));
  assert.equal(words[2], tintWordFor("#4f7fb5", TINT_ALPHA));
  assert.ok(SELECTED_TINT_ALPHA > TINT_ALPHA, "emphasis has to be a step UP, or it is invisible");
});

test("no emphasis argument is byte-identical to the pre-T08 table", () => {
  // What keeps the seven existing call sites above honest: adding the two
  // optional parameters changed no existing output.
  const list = [country(1, "#c0563f", [1, 2]), country(2, "#4f7fb5", [3])];

  const plain = buildTintWordTable(list, 4);
  const explicitNone = buildTintWordTable(list, 4, null, SELECTED_TINT_ALPHA);

  assert.deepEqual(Array.from(plain), Array.from(explicitNone));
  assert.equal(plain[1], tintWordFor("#c0563f", TINT_ALPHA));
});

test("an emphasis id that names no country tints nothing differently", () => {
  // The path a deleted or never-created selection takes. `selectedCountryId`
  // already returns null for a deleted country, but an id that survives one
  // frame longer must not produce a table nobody expects.
  const list = [country(1, "#c0563f", [1, 2]), country(2, "#4f7fb5", [3])];

  const missing = buildTintWordTable(list, 4, 99, SELECTED_TINT_ALPHA);
  assert.deepEqual(Array.from(missing), Array.from(buildTintWordTable(list, 4)));
});

test("the emphasis alpha defaults to SELECTED_TINT_ALPHA when it is left off", () => {
  // `countryTintWords` passes it explicitly, but the parameter is optional and
  // the default has to be the same constant the map is tuned against.
  const list = [country(1, "#c0563f", [1]), country(2, "#4f7fb5", [2])];

  const implied = buildTintWordTable(list, 2, 1);
  assert.equal(implied[1], tintWordFor("#c0563f", SELECTED_TINT_ALPHA));
  assert.equal(implied[2], tintWordFor("#4f7fb5", TINT_ALPHA));
  assert.deepEqual(
    Array.from(implied),
    Array.from(buildTintWordTable(list, 2, 1, SELECTED_TINT_ALPHA)),
  );
});

test("emphasis only changes the alpha channel, never the colour", () => {
  // The map reads the selected country as the SAME country, only deeper. If
  // emphasis moved a colour byte the country would appear to change identity.
  const list = [country(1, "#c0563f", [1])];

  const plain = buildTintWordTable(list, 1)[1] as number;
  const deep = buildTintWordTable(list, 1, 1, SELECTED_TINT_ALPHA)[1] as number;

  assert.equal(deep & 0x00ffffff, plain & 0x00ffffff, "r, g and b are untouched");
  assert.ok((deep >>> 24) > (plain >>> 24), "and only the alpha goes up");
});

test("flushCountryBorders before any init is a no-op, not a crash", () => {
  reset();
  disposeCountrySync();

  assert.doesNotThrow(() => {
    flushCountryBorders();
  });
});
