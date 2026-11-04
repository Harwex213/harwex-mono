import assert from "node:assert/strict";
import test from "node:test";
import { pack } from "../colors/colors";
import type { Country } from "./countries";
import {
  paintCountryPixels,
  restoreCountries,
} from "./country-layer";

const RED = pack(255, 0, 0, 255);
const GREEN = pack(0, 255, 0, 255);
const BLUE = pack(0, 0, 255, 255);
const AURELIA = pack(0xc0, 0x56, 0x3f, 255);
const CYRA = pack(0x3f, 0x9e, 0x96, 255);

const PROVINCES = [
  { id: 1, color: RED },
  { id: 2, color: GREEN },
  { id: 3, color: BLUE },
];

function country(id: number, colorHex: string, provinceIds: number[]): Country {
  return { id, name: "Country " + id, colorHex, provinceIds };
}

test("each province is painted in its country's colour, the rest stays clear", () => {
  const layer = new Uint32Array([RED, RED, 0, GREEN, BLUE, BLUE]);
  const out = paintCountryPixels(layer, PROVINCES, [country(1, "#c0563f", [1, 3])]);

  assert.deepEqual([...out], [AURELIA, AURELIA, 0, 0, AURELIA, AURELIA]);
});

test("the countries image moves, adds and removes provinces; unknown colours keep theirs", () => {
  const layer = new Uint32Array([RED, GREEN, GREEN, BLUE, 0, 0]);
  const image = new Uint32Array([CYRA, 0, 0, pack(9, 9, 9, 255), 0, 0]);
  const restored = restoreCountries(layer, image, [...PROVINCES, { id: 4, color: pack(1, 2, 3, 255) }], [
    country(1, "#c0563f", [1, 2, 4]),
    country(2, "#3f9e96", [3]),
  ]);

  assert.deepEqual(restored.countries.map((entry) => entry.provinceIds), [[4], [1, 3]]);
  assert.equal(restored.restored, 2);
});

test("a painted image round-trips to the same countries", () => {
  const layer = new Uint32Array([RED, RED, GREEN, BLUE, 0, BLUE]);
  const countries = [country(1, "#c0563f", [1]), country(2, "#3f9e96", [2, 3])];
  const image = paintCountryPixels(layer, PROVINCES, countries);
  const blank = countries.map((entry) => ({ ...entry, provinceIds: [] }));

  assert.deepEqual(restoreCountries(layer, image, PROVINCES, blank).countries, countries);
});

test("an image of another size is refused", () => {
  assert.throws(() => restoreCountries(new Uint32Array(4), new Uint32Array(6), PROVINCES, []), /holds 6 pixels/);
});
