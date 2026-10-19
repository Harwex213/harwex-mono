import assert from "node:assert/strict";
import test from "node:test";
import { createTestApp } from "../test-support";
import { provinceDisplayName } from "../store/index";

// The actions against a real store. The transition table has its own test in `domain/interaction`.

test("selecting an assigned province reports its owner but keeps scope province", () => {
  const { store, registry } = createTestApp();
  const { addCountry, assignProvinces, selectProvince } = registry;
  const { scope: selectionScope, selectedCountryId, selectedProvinceId } = store.selection;
  const a = addCountry("A");
  assignProvinces(a.id, [11, 12]);

  selectProvince(11);
  assert.equal(selectedProvinceId.value, 11);
  assert.equal(selectedCountryId.value, a.id, "a province-scoped selection derives its owner");
  assert.equal(selectionScope.value, "province");
});

test("right-clicking a province of a country gives scope country", () => {
  const { store, registry } = createTestApp();
  const { addCountry, assignProvinces, selectCountryOfProvince } = registry;
  const { scope: selectionScope, selectedCountryId } = store.selection;
  const a = addCountry("A");
  assignProvinces(a.id, [11]);

  selectCountryOfProvince(11);
  assert.equal(selectedCountryId.value, a.id);
  assert.equal(selectionScope.value, "country");
});

test("deleting the selected country nulls the id and downgrades the scope", () => {
  // `selectedCountryId` is derived, so a deleted country cannot linger.
  const { store, registry } = createTestApp();
  const { addCountry, assignProvinces, deleteCountry, selectCountryOfProvince } = registry;
  const { scope: selectionScope, selectedCountryId, selectedProvinceId } = store.selection;
  const a = addCountry("A");
  assignProvinces(a.id, [11]);
  selectCountryOfProvince(11);

  deleteCountry(a.id);
  assert.equal(selectedCountryId.value, null);
  assert.equal(selectionScope.value, "province", "the province survives, the country does not");
  assert.equal(selectedProvinceId.value, 11);
});

test("repainting a province-selected province moves the reported country live", () => {
  const { store, registry } = createTestApp();
  const { addCountry, assignProvinces, selectProvince } = registry;
  const { selectedCountryId } = store.selection;
  const a = addCountry("A");
  const b = addCountry("B");
  assignProvinces(a.id, [11]);
  selectProvince(11);
  assert.equal(selectedCountryId.value, a.id);

  assignProvinces(b.id, [11]);
  assert.equal(selectedCountryId.value, b.id, "the plaque follows a paint drag");
});

test("a country-scoped selection keeps the country the user chose", () => {
  const { store, registry } = createTestApp();
  const { addCountry, assignProvinces, selectCountryOfProvince } = registry;
  const { selectedCountryId } = store.selection;
  const a = addCountry("A");
  const b = addCountry("B");
  assignProvinces(a.id, [11]);
  selectCountryOfProvince(11);

  assignProvinces(b.id, [11]);
  assert.equal(selectedCountryId.value, a.id, "they selected that country, not that owner");
});

test("selectCountry from a list row drops a province of another country", () => {
  const { store, registry } = createTestApp();
  const { addCountry, assignProvinces, selectCountry, selectProvince } = registry;
  const { scope: selectionScope, selectedCountryId, selectedProvinceId } = store.selection;
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
  const { store, registry } = createTestApp();
  const { addCountry, assignProvinces, selectCountryOfProvince, selectProvince } = registry;
  const { scope: selectionScope, selectedCountryId, selectedProvinceId } = store.selection;
  const a = addCountry("A");
  assignProvinces(a.id, [11]);
  selectCountryOfProvince(11);

  selectProvince(null);
  assert.equal(selectedProvinceId.value, null);
  assert.equal(selectedCountryId.value, null);
  assert.equal(selectionScope.value, "none");
});

test("selecting a country that no longer exists reports no selection at all", () => {
  // The scope downgrades instead of reporting "country" with a null id.
  const { store, registry } = createTestApp();
  const { addCountry, deleteCountry, selectCountry } = registry;
  const { scope: selectionScope, selectedCountry, selectedCountryId } = store.selection;
  const ghost = addCountry("Ghost");
  deleteCountry(ghost.id);

  selectCountry(ghost.id);
  assert.equal(selectedCountryId.value, null);
  assert.equal(selectedCountry.value, null);
  assert.equal(selectionScope.value, "none");
});

test("an unassigned province selection reports no country", () => {
  // The plaque's second empty state: a province with no owner.
  const { store, registry } = createTestApp();
  const { selectProvince } = registry;
  const { scope: selectionScope, selectedCountry, selectedCountryId, selectedProvinceId } = store.selection;
  selectProvince(11);

  assert.equal(selectedProvinceId.value, 11);
  assert.equal(selectedCountryId.value, null);
  assert.equal(selectedCountry.value, null);
  assert.equal(selectionScope.value, "province");
});

test("selectedCountry carries the record and follows a rename", () => {
  const { store, registry } = createTestApp();
  const { addCountry, assignProvinces, selectCountryOfProvince, updateCountry } = registry;
  const { selectedCountry } = store.selection;
  const a = addCountry("A");
  assignProvinces(a.id, [11]);
  selectCountryOfProvince(11);

  assert.equal(selectedCountry.value?.name, "A");
  updateCountry(a.id, { name: "Alnwick Union" });
  assert.equal(selectedCountry.value?.name, "Alnwick Union");
});

test("deleting a DIFFERENT country leaves the selection where it was", () => {
  const { store, registry } = createTestApp();
  const { addCountry, assignProvinces, deleteCountry, selectCountryOfProvince } = registry;
  const { scope: selectionScope, selectedCountryId, selectedProvinceId } = store.selection;
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
  // The owner is derived live, so the plaque falls back during the erase drag.
  const { store, registry } = createTestApp();
  const { addCountry, assignProvinces, selectProvince } = registry;
  const { scope: selectionScope, selectedCountryId, selectedProvinceId } = store.selection;
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
  const { store, registry } = createTestApp();
  const { addCountry, assignProvinces, clearSelection, selectCountryOfProvince } = registry;
  const { scope: selectionScope, selectedCountryId, selectedProvinceId } = store.selection;
  const a = addCountry("A");
  assignProvinces(a.id, [11]);
  selectCountryOfProvince(11);

  clearSelection();
  assert.equal(selectedProvinceId.value, null);
  assert.equal(selectedCountryId.value, null);
  assert.equal(selectionScope.value, "none");
});

test("selectedProvince is null until the manifest loads, and the name falls back", () => {
  // Ids are not contiguous and the shell renders before the PNG decodes.
  // Every readout must survive a null `provinceById`.
  const { store, registry } = createTestApp();
  const { selectProvince } = registry;
  const { selectedProvince, selectedProvinceId } = store.selection;
  selectProvince(1318);

  assert.equal(selectedProvinceId.value, 1318);
  assert.equal(selectedProvince.value, null, "no manifest in Node, and none early in the browser");
  assert.equal(provinceDisplayName(store, 1318), "Province 1318");
  assert.equal(provinceDisplayName(store, 1650), "Province 1650", "1650 is the highest id, not 1648");
});

test("hover is independent of selection and skips an unchanged write", () => {
  const { store, registry } = createTestApp();
  const { selectProvince, setHoveredProvince } = registry;
  const { hoveredProvinceId, selectedProvinceId } = store.selection;
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
