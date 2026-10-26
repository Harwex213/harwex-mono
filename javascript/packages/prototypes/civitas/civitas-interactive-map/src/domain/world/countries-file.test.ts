import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_COUNTRY_ID,
  countryDisplayName,
  parseCountries,
  parseCountriesText,
} from "./countries-file";

function file(countries: unknown[]): unknown {
  return { format: "civitas.countries", version: 1, countries };
}

function entry(patch: { [key: string]: unknown } = {}): { [key: string]: unknown } {
  return { id: 1, name: "Aurelia", colorHex: "#c0563f", provinceIds: [3, 1, 2], ...patch };
}

test("a clean file parses with sorted province ids, defaults and no repairs", () => {
  const parsed = parseCountries(file([entry()]));

  assert.deepEqual(parsed.repairs, []);
  assert.deepEqual(parsed.countries, [
    { id: 1, name: "Aurelia", slogan: "", flagDataUrl: null, provinceIds: [1, 2, 3], colorHex: "#c0563f" },
  ]);
});

test("the optional slogan and data URL flag are kept", () => {
  const flag = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
  const [country] = parseCountries(file([entry({ slogan: "Gold in the hills", flagDataUrl: flag })])).countries;

  assert.equal(country?.slogan, "Gold in the hills");
  assert.equal(country?.flagDataUrl, flag);
});

test("a flag that is not a data:image/ URL is dropped with a note", () => {
  const parsed = parseCountries(file([entry({ flagDataUrl: "https://example.com/flag.png" })]));

  assert.equal(parsed.countries[0]?.flagDataUrl, null);
  assert.deepEqual(parsed.repairs, ["dropped 1 flags that are not data:image/ URLs"]);
});

test("a wrong format, version or shape throws, because it is a different file", () => {
  assert.throws(() => {
    parseCountries({ format: "civitas.province-map", version: 1, countries: [] });
  }, /countries format is "civitas.province-map", expected "civitas.countries"/);
  assert.throws(() => {
    parseCountries({ format: "civitas.countries", version: 2, countries: [] });
  }, /countries version is 2, expected 1/);
  assert.throws(() => {
    parseCountries({ format: "civitas.countries", version: 1 });
  }, /no countries list/);
  assert.throws(() => {
    parseCountries([]);
  }, /not an object/);
  assert.throws(() => {
    parseCountriesText("<!doctype html>");
  }, /not valid JSON/);
});

test("malformed countries are dropped with one note, and the rest survive", () => {
  const parsed = parseCountries(
    file([
      entry({ id: 1 }),
      entry({ id: 1, provinceIds: [9] }),
      entry({ id: 0, provinceIds: [10] }),
      entry({ id: MAX_COUNTRY_ID + 1, provinceIds: [11] }),
      entry({ id: 2.5, provinceIds: [12] }),
      entry({ id: 3, colorHex: "red", provinceIds: [13] }),
      entry({ id: 4, provinceIds: "14" }),
      "not an object",
      entry({ id: MAX_COUNTRY_ID, provinceIds: [15] }),
    ]),
  );

  assert.deepEqual(
    parsed.countries.map((country) => {
      return country.id;
    }),
    [1, MAX_COUNTRY_ID],
  );
  assert.deepEqual(parsed.repairs, ["dropped 7 malformed countries"]);
});

test("a province claimed twice stays with the first country", () => {
  const parsed = parseCountries(
    file([entry({ id: 1, provinceIds: [5, 6] }), entry({ id: 2, provinceIds: [6, 7] })]),
  );

  assert.deepEqual(parsed.countries[0]?.provinceIds, [5, 6]);
  assert.deepEqual(parsed.countries[1]?.provinceIds, [7]);
  assert.deepEqual(parsed.repairs, ["dropped 1 duplicate province claims"]);
});

test("bad province ids are dropped, the country is kept", () => {
  const parsed = parseCountries(file([entry({ provinceIds: [1, 0, -2, 1.5, "3", 4] })]));

  assert.deepEqual(parsed.countries[0]?.provinceIds, [1, 4]);
  assert.deepEqual(parsed.repairs, ["dropped 4 malformed province ids"]);
});

test("a missing or blank name falls back to Country <id> on display", () => {
  const parsed = parseCountries(file([entry({ id: 7, name: undefined })]));

  assert.equal(parsed.countries[0]?.name, "");
  assert.equal(countryDisplayName(7, ""), "Country 7");
  assert.equal(countryDisplayName(7, "   "), "Country 7");
  assert.equal(countryDisplayName(7, "Aurelia"), "Aurelia");
});
