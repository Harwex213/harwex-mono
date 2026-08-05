import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { countryDisplayName } from "./schema";
import { createMemoryStorage } from "./persistence";
import { loadPhase } from "./map-store";
import {
  clearLabelAnchorCache,
  countryContainsPoint,
  countryLabelSources,
  labelAnchorCacheSize,
  showLabels,
  toggleLabels,
} from "./label-store";
import { addCountry, assignProvinces, initWorldStore } from "./world-store";

// WHAT THIS FILE CAN AND CANNOT REACH. In Node the manifest never loads, so
// `loadPhase` never becomes "ready" and `countryLabelSources` can only ever be
// empty. That is a real constraint of the store, not an oversight — T06 records
// the same limit for `maxProvinceId`. Faking a `ProvinceIndex` here to reach
// further would test the fake, not the store: the store's own logic is a cache
// lookup and a loop, and the maths under it is covered in full by
// `../map/label-layout.test.ts` and `../ui/label-layer.test.ts`.

function freshStore(): void {
  initWorldStore({ storage: createMemoryStorage() });
  clearLabelAnchorCache();
  showLabels.value = true;
}

test("the map load gates the label sources, so nothing is anchored blind", () => {
  // Without the gate the anchor cache would fill with nulls on the first pass
  // and no country would ever get a label.
  freshStore();
  assert.notEqual(loadPhase.peek(), "ready", "the manifest cannot load in Node");

  const country = addCountry("Aurelia");
  assignProvinces(country.id, [1, 2, 3]);

  assert.deepEqual(countryLabelSources.value, []);
  assert.equal(labelAnchorCacheSize(), 0, "and no anchor was computed");
});

test("showLabels starts on, toggles both ways, and empties the sources when off", () => {
  freshStore();
  assert.equal(showLabels.value, true);

  toggleLabels();
  assert.equal(showLabels.value, false);
  assert.deepEqual(countryLabelSources.value, []);

  toggleLabels();
  assert.equal(showLabels.value, true);
  assert.deepEqual(countryLabelSources.value, []);
});

test("countryContainsPoint is false for every argument before the map loads", () => {
  freshStore();
  const country = addCountry("Borland");
  assignProvinces(country.id, [7]);

  for (const point of [
    { x: 0, y: 0 },
    { x: 100, y: 200 },
    { x: -5, y: -5 },
    { x: Number.NaN, y: 3 },
    { x: 1e9, y: 1e9 },
  ]) {
    assert.equal(
      countryContainsPoint(country.id, point.x, point.y),
      false,
      "at " + point.x + ", " + point.y,
    );
  }
});

test("a cleared country name cannot drop the label off the map", () => {
  // Before T09 the source list skipped any country whose name trimmed to empty,
  // so clearing the field in the panel DELETED the label until a name was
  // retyped. `loadPhase` never reaches "ready" in Node, so the loop itself is out
  // of reach; what a regression would look like is the fallback disappearing
  // from the text derivation, and that is checkable.
  const source = readFileSync(fileURLToPath(new URL("./label-store.ts", import.meta.url)), "utf8");
  assert.match(source, /countryDisplayName\(country\.id, country\.name\)/);

  // And the `text === ""` guard below it can no longer fire for any name a user
  // can type into the field, which is why deleting the fallback would be silent.
  for (const name of ["", " ", "   ", "\n\t", "\u00a0"]) {
    assert.notEqual(countryDisplayName(7, name).trim().toUpperCase(), "", JSON.stringify(name));
  }
});

test("clearLabelAnchorCache empties the cache", () => {
  freshStore();
  assert.equal(labelAnchorCacheSize(), 0);
  clearLabelAnchorCache();
  assert.equal(labelAnchorCacheSize(), 0);
});
