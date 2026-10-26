import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCountriesFile,
  parseCountriesFile,
} from "./countries-file";

const known = (id: number): boolean => {
  return id >= 1 && id <= 10;
};

test("a built file parses back to the same countries", () => {
  const file = buildCountriesFile([
    { id: 1, name: "Aurelia", colorHex: "#c0563f", provinceIds: [3, 1], slogan: "Gold" },
    { id: 4, name: "Borealis", colorHex: "#4f7fb5", provinceIds: [2] },
  ]);

  assert.equal(file.format, "civitas.countries");
  assert.equal(file.version, 1);
  assert.deepEqual(file.countries[0].provinceIds, [1, 3]);

  const parsed = parseCountriesFile(JSON.stringify(file), known);

  assert.deepEqual(parsed.countries, file.countries);
  assert.equal(parsed.skippedCountries, 0);
  assert.equal(parsed.skippedProvinces, 0);
});

test("another format, another version or broken JSON is refused", () => {
  assert.throws(() => parseCountriesFile("{", known), /not valid JSON/);
  assert.throws(() => parseCountriesFile(JSON.stringify({ format: "civitas.province-map", version: 1 }), known), /not a civitas.countries file/);
  assert.throws(() => parseCountriesFile(JSON.stringify({ format: "civitas.countries", version: 2, countries: [] }), known), /version 2/);
});

test("bad countries and bad province ids are skipped and counted", () => {
  const text = JSON.stringify({
    format: "civitas.countries",
    version: 1,
    countries: [
      { id: 1, name: "", colorHex: "#C0563F", provinceIds: [1, 2, 99] },
      { id: 1, name: "Twice", colorHex: "#000000", provinceIds: [] },
      { id: 2, name: "No colour", provinceIds: [] },
      { id: 3, name: "Late", colorHex: "#4f7fb5", provinceIds: [2, 4], flagDataUrl: "https://example.com/flag.png" },
      "not a country",
    ],
  });
  const parsed = parseCountriesFile(text, known);

  assert.deepEqual(parsed.countries, [
    { id: 1, name: "Country 1", colorHex: "#c0563f", provinceIds: [1, 2] },
    { id: 3, name: "Late", colorHex: "#4f7fb5", provinceIds: [4] },
  ]);
  assert.equal(parsed.skippedCountries, 3);
  // 99 is unknown, and 2 was already claimed by country 1.
  assert.equal(parsed.skippedProvinces, 2);
});
