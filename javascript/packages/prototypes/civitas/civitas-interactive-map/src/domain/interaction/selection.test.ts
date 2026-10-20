import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_SELECTION,
  nextSelection,
  sameSelection,
  type SelectionState,
} from "./selection";

const EMPTY: SelectionState = EMPTY_SELECTION;

function owners(entries: readonly [number, number][]): ReadonlyMap<number, number> {
  return new Map(entries);
}

test("a province intent selects the province and drops the stored country", () => {
  const current: SelectionState = { provinceId: 4, countryId: 9, scope: "country" };
  const next = nextSelection(current, { kind: "province", provinceId: 7 }, owners([[7, 9]]));

  assert.deepEqual(next, { provinceId: 7, countryId: null, scope: "province" });
});

test("a province intent with a null id is the sea and clears everything", () => {
  const current: SelectionState = { provinceId: 4, countryId: 9, scope: "country" };
  assert.deepEqual(nextSelection(current, { kind: "province", provinceId: null }, owners([])), EMPTY);
});

test("right-clicking an owned province selects its country", () => {
  const next = nextSelection(EMPTY, { kind: "countryOfProvince", provinceId: 3 }, owners([[3, 2]]));
  assert.deepEqual(next, { provinceId: 3, countryId: 2, scope: "country" });
});

test("right-clicking an UNASSIGNED province degrades to a province selection", () => {
  // Most of the map is unowned. Clearing there would make right-click feel broken.
  const next = nextSelection(EMPTY, { kind: "countryOfProvince", provinceId: 3 }, owners([]));
  assert.deepEqual(next, { provinceId: 3, countryId: null, scope: "province" });
});

test("right-clicking the sea clears everything", () => {
  const current: SelectionState = { provinceId: 4, countryId: 9, scope: "country" };
  const next = nextSelection(current, { kind: "countryOfProvince", provinceId: null }, owners([]));
  assert.deepEqual(next, EMPTY);
});

test("a country intent keeps the province only when it is INSIDE that country", () => {
  const inside: SelectionState = { provinceId: 5, countryId: null, scope: "province" };
  assert.deepEqual(
    nextSelection(inside, { kind: "country", countryId: 2 }, owners([[5, 2]])),
    { provinceId: 5, countryId: 2, scope: "country" },
  );

  // The province slot must not point into a different country than the plaque.
  assert.deepEqual(
    nextSelection(inside, { kind: "country", countryId: 2 }, owners([[5, 8]])),
    { provinceId: null, countryId: 2, scope: "country" },
  );
});

test("a null country intent keeps the province and downgrades the scope", () => {
  const current: SelectionState = { provinceId: 5, countryId: 2, scope: "country" };
  assert.deepEqual(nextSelection(current, { kind: "country", countryId: null }, owners([])), {
    provinceId: 5,
    countryId: null,
    scope: "province",
  });

  assert.deepEqual(nextSelection(EMPTY, { kind: "country", countryId: null }, owners([])), EMPTY);
});

test("a clear intent empties all three slots", () => {
  const current: SelectionState = { provinceId: 5, countryId: 2, scope: "country" };
  assert.deepEqual(nextSelection(current, { kind: "clear" }, owners([])), EMPTY);
});

test("sameSelection compares all three fields", () => {
  const base: SelectionState = { provinceId: 1, countryId: 2, scope: "country" };
  assert.equal(sameSelection(base, { provinceId: 1, countryId: 2, scope: "country" }), true);
  assert.equal(sameSelection(base, { provinceId: 9, countryId: 2, scope: "country" }), false);
  assert.equal(sameSelection(base, { provinceId: 1, countryId: 9, scope: "country" }), false);
  assert.equal(sameSelection(base, { provinceId: 1, countryId: 2, scope: "province" }), false);
});

test("a country intent with nothing selected takes the country alone", () => {
  // No province to keep: the slot stays null and the scope is "country".
  assert.deepEqual(nextSelection(EMPTY, { kind: "country", countryId: 2 }, owners([])), {
    provinceId: null,
    countryId: 2,
    scope: "country",
  });
});

test("re-picking what is already picked produces an equal state", () => {
  // Equal selections let `apply` skip the write, so a re-click costs no repaint.
  const province: SelectionState = { provinceId: 7, countryId: null, scope: "province" };
  assert.equal(
    sameSelection(province, nextSelection(province, { kind: "province", provinceId: 7 }, owners([]))),
    true,
  );

  const country: SelectionState = { provinceId: 7, countryId: 3, scope: "country" };
  assert.equal(
    sameSelection(
      country,
      nextSelection(country, { kind: "countryOfProvince", provinceId: 7 }, owners([[7, 3]])),
    ),
    true,
  );

  // A clear on an empty selection.
  assert.equal(sameSelection(EMPTY, nextSelection(EMPTY, { kind: "clear" }, owners([]))), true);
});

test("a country intent for a country the province does not belong to still switches", () => {
  // The province is dropped, not the country.
  const current: SelectionState = { provinceId: 5, countryId: 8, scope: "country" };
  assert.deepEqual(nextSelection(current, { kind: "country", countryId: 2 }, owners([[5, 8]])), {
    provinceId: null,
    countryId: 2,
    scope: "country",
  });
});
