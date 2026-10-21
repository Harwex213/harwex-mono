import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { ProvinceIndex } from "../../domain/data/province-index";
import {
  countryDisplayName,
  type Province,
} from "../../domain/index";
import { countryContainsPoint } from "../selectors";
import { createTestApp, fakeMapAssets, markMapReady } from "../../test-support";

// Covers the wiring only: the map-load gate and the anchor cache. The anchor
// maths has its own tests in `domain/countries` and the label layer.

function province(id: number, rgb: [number, number, number], x: number, width: number): Province {
  return {
    id,
    name: "Province " + id,
    kind: "land",
    hex: "#000000",
    rgb,
    pixelCount: width * 3,
    bounds: { x, y: 0, width, height: 3 },
    centroid: { x: x + width / 2, y: 1.5 },
  };
}

// A 6 x 3 map. Province 1 covers columns 0-2, province 2 covers columns 3-5.
function twoProvinceMap() {
  const provinces = [province(1, [10, 0, 0], 0, 3), province(2, [20, 0, 0], 3, 3)];
  const width = 6;
  const height = 3;
  const pixels = new Uint32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = ProvinceIndex.packColor(x < 3 ? [10, 0, 0] : [20, 0, 0]);
    }
  }
  const index = ProvinceIndex.fromProvinces(width, height, pixels, provinces);
  return fakeMapAssets({ width, height, provinces, index });
}

test("the map load gates the label sources, so nothing is anchored blind", () => {
  // Without the gate the cache fills with nulls and no country gets a label.
  const { store, registry } = createTestApp();
  assert.notEqual(store.map.phase.peek(), "ready");

  const country = registry.addCountry("Aurelia");
  registry.assignProvinces(country.id, [1, 2, 3]);

  assert.deepEqual(store.labels.labelSources.value, []);
  assert.equal(store.labels.anchorCache.size, 0, "and no anchor was computed");
});

test("showLabels starts on, toggles both ways, and empties the sources when off", () => {
  const { store, registry } = createTestApp();
  assert.equal(store.labels.showLabels.value, true);

  registry.toggleLabels();
  assert.equal(store.labels.showLabels.value, false);
  assert.deepEqual(store.labels.labelSources.value, []);

  registry.toggleLabels();
  assert.equal(store.labels.showLabels.value, true);
  assert.deepEqual(store.labels.labelSources.value, []);
});

test("countryContainsPoint is false for every argument before the map loads", () => {
  const { store, registry } = createTestApp();
  const country = registry.addCountry("Borland");
  registry.assignProvinces(country.id, [7]);

  for (const point of [
    { x: 0, y: 0 },
    { x: 100, y: 200 },
    { x: -5, y: -5 },
    { x: Number.NaN, y: 3 },
    { x: 1e9, y: 1e9 },
  ]) {
    assert.equal(
      countryContainsPoint(store, country.id, point.x, point.y),
      false,
      "at " + point.x + ", " + point.y,
    );
  }
});

test("a ready map anchors a label inside its country and caches the anchor", () => {
  const { store, registry } = createTestApp();
  const country = registry.addCountry("Aurelia");
  registry.assignProvinces(country.id, [1]);
  markMapReady(store, twoProvinceMap());

  assert.equal(countryContainsPoint(store, country.id, 1, 1), true);
  assert.equal(countryContainsPoint(store, country.id, 4, 1), false, "province 2 has no owner");

  const sources = store.labels.labelSources.value;
  assert.equal(sources.length, 1);
  assert.equal(sources[0]?.text, "AURELIA");
  const anchor = sources[0]?.anchor;
  assert.ok(anchor !== undefined && countryContainsPoint(store, country.id, anchor.x, anchor.y));
  assert.equal(store.labels.anchorCache.size, 1);

  // A rename keeps the `provinceIds` array, so the cached anchor is reused.
  const cached = store.labels.anchorCache.get(country.id);
  registry.updateCountry(country.id, { name: "Aurelia Magna" });
  assert.equal(store.labels.labelSources.value[0]?.text, "AURELIA MAGNA");
  assert.equal(store.labels.anchorCache.get(country.id), cached);

  // A deleted country leaves the cache on the next pass.
  registry.deleteCountry(country.id);
  assert.deepEqual(store.labels.labelSources.value, []);
  assert.equal(store.labels.anchorCache.size, 0);
});

test("a cleared country name cannot drop the label off the map", () => {
  // A regression would drop the fallback from the text derivation.
  const source = readFileSync(fileURLToPath(new URL("./labels-slice.ts", import.meta.url)), "utf8");
  assert.match(source, /countryDisplayName\(country\.id, country\.name\)/);

  // The fallback never yields empty text, so the `text === ""` guard stays idle.
  for (const name of ["", " ", "   ", "\n\t", " "]) {
    assert.notEqual(countryDisplayName(7, name).trim().toUpperCase(), "", JSON.stringify(name));
  }

  const { store, registry } = createTestApp();
  const country = registry.addCountry("Aurelia");
  registry.assignProvinces(country.id, [1]);
  markMapReady(store, twoProvinceMap());
  registry.updateCountry(country.id, { name: "" });
  assert.equal(store.labels.labelSources.value.length, 1, "the fallback name keeps the label");
});

test("clearing the anchor cache empties it", () => {
  const { store } = createTestApp();
  assert.equal(store.labels.anchorCache.size, 0);
  store.labels.anchorCache.clear();
  assert.equal(store.labels.anchorCache.size, 0);
});
