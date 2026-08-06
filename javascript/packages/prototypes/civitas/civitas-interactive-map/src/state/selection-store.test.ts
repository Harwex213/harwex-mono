import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryStorage } from "./persistence";
import {
  clearSelection,
  hoveredProvinceId,
  nextSelection,
  sameSelection,
  selectCountry,
  selectCountryOfProvince,
  selectProvince,
  selectedCountry,
  selectedCountryId,
  selectedProvince,
  selectedProvinceId,
  selectionScope,
  setHoveredProvince,
} from "./selection-store";
import {
  addCountry,
  assignProvinces,
  deleteCountry,
  initWorldStore,
  provinceDisplayName,
  updateCountry,
} from "./world-store";
import type { SelectionState } from "./selection-store";

const EMPTY: SelectionState = { provinceId: null, countryId: null, scope: "none" };

function owners(entries: readonly [number, number][]): ReadonlyMap<number, number> {
  return new Map(entries);
}

function reset(): void {
  initWorldStore({ storage: createMemoryStorage() });
  clearSelection();
}

// --- the pure transition table -------------------------------------------

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
  // Two thirds of the map belongs to nobody. Clearing there would make right
  // click feel broken.
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

  // Otherwise the province slot would point at a province of a different
  // country while the plaque showed this one.
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

// --- the signals ----------------------------------------------------------

test("selecting an assigned province reports its owner but keeps scope province", () => {
  reset();
  const a = addCountry("A");
  assignProvinces(a.id, [11, 12]);

  selectProvince(11);
  assert.equal(selectedProvinceId.value, 11);
  assert.equal(selectedCountryId.value, a.id, "a province-scoped selection derives its owner");
  assert.equal(selectionScope.value, "province");
});

test("right-clicking a province of a country gives scope country", () => {
  reset();
  const a = addCountry("A");
  assignProvinces(a.id, [11]);

  selectCountryOfProvince(11);
  assert.equal(selectedCountryId.value, a.id);
  assert.equal(selectionScope.value, "country");
});

test("deleting the selected country nulls the id and downgrades the scope", () => {
  // `selectedCountryId` is a computed validated against `countryById`, so a
  // deleted country cannot linger in the selection.
  reset();
  const a = addCountry("A");
  assignProvinces(a.id, [11]);
  selectCountryOfProvince(11);

  deleteCountry(a.id);
  assert.equal(selectedCountryId.value, null);
  assert.equal(selectionScope.value, "province", "the province survives, the country does not");
  assert.equal(selectedProvinceId.value, 11);
});

test("repainting a province-selected province moves the reported country live", () => {
  reset();
  const a = addCountry("A");
  const b = addCountry("B");
  assignProvinces(a.id, [11]);
  selectProvince(11);
  assert.equal(selectedCountryId.value, a.id);

  assignProvinces(b.id, [11]);
  assert.equal(selectedCountryId.value, b.id, "the plaque follows a paint drag");
});

test("a country-scoped selection keeps the country the user chose", () => {
  reset();
  const a = addCountry("A");
  const b = addCountry("B");
  assignProvinces(a.id, [11]);
  selectCountryOfProvince(11);

  assignProvinces(b.id, [11]);
  assert.equal(selectedCountryId.value, a.id, "they selected that country, not that owner");
});

test("selectCountry from a list row drops a province of another country", () => {
  reset();
  const a = addCountry("A");
  const b = addCountry("B");
  assignProvinces(a.id, [11]);
  assignProvinces(b.id, [21]);

  selectProvince(11);
  selectCountry(b.id);
  assert.equal(selectedCountryId.value, b.id);
  assert.equal(selectedProvinceId.value, null);
  assert.equal(selectionScope.value, "country");
});

test("selecting the sea clears all three signals", () => {
  reset();
  const a = addCountry("A");
  assignProvinces(a.id, [11]);
  selectCountryOfProvince(11);

  selectProvince(null);
  assert.equal(selectedProvinceId.value, null);
  assert.equal(selectedCountryId.value, null);
  assert.equal(selectionScope.value, "none");
});

// --- T08 regressions ------------------------------------------------------

test("a country intent with nothing selected takes the country alone", () => {
  // The last row of the DESIGN §2.2 table: there is no province to keep, so the
  // province slot stays null and the scope is still "country".
  assert.deepEqual(nextSelection(EMPTY, { kind: "country", countryId: 2 }, owners([])), {
    provinceId: null,
    countryId: 2,
    scope: "country",
  });
});

test("re-picking what is already picked produces an equal state", () => {
  // DESIGN §8.7. `apply` compares with `sameSelection` and skips the write, so
  // a second click on the same province costs no repaint and no tint diff.
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

  // And a clear on an already-empty selection.
  assert.equal(sameSelection(EMPTY, nextSelection(EMPTY, { kind: "clear" }, owners([]))), true);
});

test("a country intent for a country the province does not belong to still switches", () => {
  // The province is dropped, not the country: the plaque must never show one
  // country while the province slot points into another.
  const current: SelectionState = { provinceId: 5, countryId: 8, scope: "country" };
  assert.deepEqual(nextSelection(current, { kind: "country", countryId: 2 }, owners([[5, 8]])), {
    provinceId: null,
    countryId: 2,
    scope: "country",
  });
});

test("selecting a country that no longer exists reports no selection at all", () => {
  // `selectedCountryId` validates the stored id against `countryById`, and
  // `selectionScope` then downgrades rather than reporting "country" with a
  // null id.
  reset();
  const ghost = addCountry("Ghost");
  deleteCountry(ghost.id);

  selectCountry(ghost.id);
  assert.equal(selectedCountryId.value, null);
  assert.equal(selectedCountry.value, null);
  assert.equal(selectionScope.value, "none");
});

test("an unassigned province selection reports no country", () => {
  // The plaque's second empty state: a province with no owner.
  reset();
  selectProvince(11);

  assert.equal(selectedProvinceId.value, 11);
  assert.equal(selectedCountryId.value, null);
  assert.equal(selectedCountry.value, null);
  assert.equal(selectionScope.value, "province");
});

test("selectedCountry carries the record and follows a rename", () => {
  reset();
  const a = addCountry("A");
  assignProvinces(a.id, [11]);
  selectCountryOfProvince(11);

  assert.equal(selectedCountry.value?.name, "A");
  updateCountry(a.id, { name: "Alnwick Union" });
  assert.equal(selectedCountry.value?.name, "Alnwick Union");
});

test("deleting a DIFFERENT country leaves the selection where it was", () => {
  reset();
  const a = addCountry("A");
  const b = addCountry("B");
  assignProvinces(a.id, [11]);
  selectCountryOfProvince(11);

  deleteCountry(b.id);
  assert.equal(selectedCountryId.value, a.id);
  assert.equal(selectedProvinceId.value, 11);
  assert.equal(selectionScope.value, "country");
});

test("unassigning the selected province drops its derived country", () => {
  // `assignProvinces(null, ids)` is the erase stroke. A province-scoped
  // selection derives its owner live, so the plaque must fall back to the
  // unassigned state while the drag is still running.
  reset();
  const a = addCountry("A");
  assignProvinces(a.id, [11]);
  selectProvince(11);
  assert.equal(selectedCountryId.value, a.id);

  assignProvinces(null, [11]);
  assert.equal(selectedCountryId.value, null);
  assert.equal(selectionScope.value, "province", "the province itself survives the erase");
  assert.equal(selectedProvinceId.value, 11);
});

test("clearSelection empties a country-scoped selection", () => {
  reset();
  const a = addCountry("A");
  assignProvinces(a.id, [11]);
  selectCountryOfProvince(11);

  clearSelection();
  assert.equal(selectedProvinceId.value, null);
  assert.equal(selectedCountryId.value, null);
  assert.equal(selectionScope.value, "none");
});

test("selectedProvince is null until the manifest loads, and the name falls back", () => {
  // DESIGN §8.21 / §8.22. Province ids run 1..1650 for 1648 provinces — 1318
  // and 1458 are missing — and the shell renders before the PNG decodes. Every
  // readout has to survive `provinceById` returning null.
  reset();
  selectProvince(1318);

  assert.equal(selectedProvinceId.value, 1318);
  assert.equal(selectedProvince.value, null, "no manifest in Node, and none early in the browser");
  assert.equal(provinceDisplayName(1318), "Province 1318");
  assert.equal(provinceDisplayName(1650), "Province 1650", "1650 is the highest id, not 1648");
});

test("hover is independent of selection and skips an unchanged write", () => {
  reset();
  selectProvince(11);

  setHoveredProvince(42);
  assert.equal(hoveredProvinceId.value, 42);
  setHoveredProvince(42);
  assert.equal(hoveredProvinceId.value, 42, "a pointer move inside one province changes nothing");

  assert.equal(selectedProvinceId.value, 11, "hovering never moves the selection");

  setHoveredProvince(null);
  assert.equal(hoveredProvinceId.value, null);
  assert.equal(selectedProvinceId.value, 11);
});
