import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCountryInfo,
  parseCountryInfoText,
} from "./country-info-file";

function file(countries: unknown[]): unknown {
  return { format: "civitas.countries-info", version: 1, countries };
}

function economy(patch: { [key: string]: unknown } = {}): { [key: string]: unknown } {
  return {
    year: 1912,
    gdp: 84200,
    growthPct: 3.4,
    sectors: [
      { kind: "agriculture", volume: 26000, growthPct: 2.1 },
      { kind: "other", title: "Shipbuilding", volume: 3000, growthPct: 6 },
    ],
    creditRating: "B",
    stateControl: 62,
    emissionPct: 2,
    militarySpendingPct: 6,
    fs: 1240,
    vpk: 380,
    fsReserve: 600,
    vpkStockpile: 150,
    resources: [{ title: "Coal", balance: 40 }, { title: "Oil", balance: -25 }],
    ...patch,
  };
}

test("a clean entry parses with its profile and its economy", () => {
  const parsed = parseCountryInfo(file([
    { countryId: 4, profile: { capital: "Thalla", democraticElections: true }, economy: economy() },
  ]));

  assert.deepEqual(parsed.repairs, []);
  const [info] = parsed.info;
  assert.equal(info.countryId, 4);
  assert.deepEqual(info.profile, {
    capital: "Thalla",
    region: "",
    history: "",
    culture: "",
    religion: "",
    government: "",
    democraticElections: true,
    ideology: "",
  });
  assert.equal(info.economy?.creditRating, "B");
  assert.deepEqual(info.economy?.sectors[0], { kind: "agriculture", title: "", volume: 26000, growthPct: 2.1 });
  assert.deepEqual(info.economy?.resources, [{ title: "Coal", balance: 40 }, { title: "Oil", balance: -25 }]);
});

test("a missing economy is null and needs no repair", () => {
  const parsed = parseCountryInfo(file([{ countryId: 1, profile: {} }, { countryId: 2, economy: null }]));

  assert.deepEqual(parsed.repairs, []);
  assert.deepEqual(parsed.info.map((info) => info.economy), [null, null]);
});

test("an economy with a missing number or an unknown rating is dropped and reported", () => {
  const parsed = parseCountryInfo(file([
    { countryId: 1, economy: economy({ fs: "a lot" }) },
    { countryId: 2, economy: economy({ creditRating: "AAA" }) },
  ]));

  assert.deepEqual(parsed.info.map((info) => info.economy), [null, null]);
  assert.deepEqual(parsed.repairs, ["dropped 2 incomplete economies"]);
});

test("bad rows, a third other sector and bad entries are dropped; the state control is clamped", () => {
  const other = (title: string) => {
    return { kind: "other", title, volume: 1, growthPct: 0 };
  };
  const parsed = parseCountryInfo(file([
    {
      countryId: 1,
      economy: economy({
        stateControl: 140,
        sectors: [other("A"), other("B"), other("C"), { kind: "mining", volume: 1, growthPct: 0 }],
        resources: [{ title: "", balance: 1 }, { title: "Coal", balance: 5 }],
      }),
    },
    { countryId: 1 },
    { countryId: 0 },
    "not an entry",
  ]));

  const result = parsed.info[0].economy!;
  assert.equal(result.stateControl, 100);
  assert.deepEqual(result.sectors.map((sector) => sector.title), ["A", "B"]);
  assert.deepEqual(result.resources, [{ title: "Coal", balance: 5 }]);
  assert.equal(parsed.info.length, 1);
  assert.deepEqual(parsed.repairs, [
    "dropped 3 malformed entries",
    "dropped 3 malformed sector or resource rows",
  ]);
});

test("another format, another version or broken JSON throws", () => {
  assert.throws(() => parseCountryInfoText("{"), /not valid JSON/);
  assert.throws(() => parseCountryInfo({ format: "civitas.countries", version: 1, countries: [] }), /format/);
  assert.throws(() => parseCountryInfo({ format: "civitas.countries-info", version: 2, countries: [] }), /version/);
});
