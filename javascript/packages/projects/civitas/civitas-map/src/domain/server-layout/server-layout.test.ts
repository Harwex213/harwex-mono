import assert from "node:assert/strict";
import test from "node:test";
import {
  fromHex,
  packOpaque,
} from "../colors/colors";
import type { Country } from "../countries/countries";
import type { Province } from "../provinces/provinces";
import {
  bindLayout,
  planSave,
  seedProvinces,
  type ServerLayout,
} from "./server-layout";

function province(id: number, hex: string, name = `Province ${id}`): Province {
  return { id, name, kind: "land", color: packOpaque(fromHex(hex)!), hex };
}

function country(id: number, colorHex: string, provinceIds: number[], name = `Country ${id}`): Country {
  return { id, name, colorHex, provinceIds };
}

const LAYOUT: ServerLayout = {
  countries: [
    {
      id: "c-a",
      name: "Aurelia",
      hex: "#C0563F",
      provinces: [
        { id: "p-1", name: "Capital", hex: "#112233" },
        { id: "p-2", name: "Coast", hex: "#445566" },
      ],
    },
    {
      id: "c-b",
      name: "Borea",
      hex: "#4f7fb5",
      provinces: [{ id: "p-3", name: "Hills", hex: "#778899" }],
    },
  ],
};

test("seedProvinces makes one province per stored colour, in that colour", () => {
  const seeded = seedProvinces(LAYOUT);

  assert.deepEqual(
    seeded.map((entry) => [entry.id, entry.name, entry.hex]),
    [[1, "Capital", "#112233"], [2, "Coast", "#445566"], [3, "Hills", "#778899"]],
  );
  assert.equal(seeded[0].color, packOpaque({ r: 0x11, g: 0x22, b: 0x33 }));
});

test("bindLayout names provinces by hex and rebuilds the countries over local ids", () => {
  const bound = bindLayout([province(7, "#778899"), province(9, "#112233"), province(4, "#abcdef")], LAYOUT);

  assert.deepEqual(bound.provinces.map((entry) => entry.name), ["Hills", "Capital", "Province 4"]);
  assert.deepEqual(bound.countries, [
    { id: 1, name: "Aurelia", colorHex: "#c0563f", provinceIds: [9] },
    { id: 2, name: "Borea", colorHex: "#4f7fb5", provinceIds: [7] },
  ]);
  assert.equal(bound.matched, 2);
  assert.equal(bound.stored, 3);
});

test("bindLayout keeps the caller's countries when the backend has none", () => {
  assert.equal(bindLayout([province(1, "#112233")], { countries: [] }).countries, null);
});

test("planSave sends every country with its provinces, deleted ones simply absent", () => {
  const provinces = [
    province(1, "#112233", "Capital"),
    province(2, "#445566", "Renamed coast"),
    province(3, "#778899", "Hills"),
    province(5, "#FEDCBA"),
  ];
  const countries = [
    // Aurelia with a province moved in from Borea; Borea itself was deleted.
    country(1, "#C0563F", [1, 2, 3, 4], "Aurelia"),
    country(2, "#3f9e96", [], "Cyra"),
  ];

  assert.deepEqual(planSave(provinces, countries), {
    layout: {
      countries: [
        {
          name: "Aurelia",
          hex: "#c0563f",
          provinces: [
            { name: "Capital", hex: "#112233" },
            { name: "Renamed coast", hex: "#445566" },
            { name: "Hills", hex: "#778899" },
          ],
        },
        { name: "Cyra", hex: "#3f9e96", provinces: [] },
      ],
    },
    unassigned: 1,
    unpainted: 0,
  }, "province 4 is gone from the registry, province 5 is in no country");
});

test("planSave leaves out provinces with no paint, unless nothing is painted at all", () => {
  const provinces = [province(1, "#112233", "Capital"), province(2, "#445566", "Ghost")];
  const countries = [country(1, "#c0563f", [1, 2], "Aurelia")];
  const plan = planSave(provinces, countries, new Set([provinces[0].color]));

  assert.deepEqual(plan.layout.countries[0].provinces, [{ name: "Capital", hex: "#112233" }]);
  assert.equal(plan.unpainted, 1);
  assert.equal(planSave(provinces, countries, null).layout.countries[0].provinces.length, 2);
});
