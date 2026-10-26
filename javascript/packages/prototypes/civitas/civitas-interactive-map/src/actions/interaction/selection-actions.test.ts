import assert from "node:assert/strict";
import test from "node:test";
import {
  country,
  createTestApp,
  setCountries,
} from "../../test-support";
import { provinceDisplayName } from "../../store/index";

// The actions against a real store. The transition table has its own test in `domain/interaction`.

test("selecting an owned province reports its owner but keeps scope province", () => {
  const { store, registry } = createTestApp();
  const { scope: selectionScope, selectedCountryId, selectedProvinceId } = store.selection;
  setCountries(store, [country(1, [11, 12])]);

  registry.selectProvince(11);
  assert.equal(selectedProvinceId.value, 11);
  assert.equal(selectedCountryId.value, 1, "a province-scoped selection derives its owner");
  assert.equal(selectionScope.value, "province");
});

test("right-clicking a province of a country gives scope country", () => {
  const { store, registry } = createTestApp();
  const { scope: selectionScope, selectedCountryId } = store.selection;
  setCountries(store, [country(1, [11])]);

  registry.selectCountryOfProvince(11);
  assert.equal(selectedCountryId.value, 1);
  assert.equal(selectionScope.value, "country");
});

test("selectCountry from a list row drops a province of another country", () => {
  const { store, registry } = createTestApp();
  const { scope: selectionScope, selectedCountryId, selectedProvinceId } = store.selection;
  setCountries(store, [country(1, [11]), country(2, [21])]);

  registry.selectProvince(11);
  registry.selectCountry(2);
  assert.equal(selectedCountryId.value, 2);
  assert.equal(selectedProvinceId.value, null);
  assert.equal(selectionScope.value, "country");
});

test("selecting the sea clears all three signals", () => {
  const { store, registry } = createTestApp();
  const { scope: selectionScope, selectedCountryId, selectedProvinceId } = store.selection;
  setCountries(store, [country(1, [11])]);
  registry.selectCountryOfProvince(11);

  registry.selectProvince(null);
  assert.equal(selectedProvinceId.value, null);
  assert.equal(selectedCountryId.value, null);
  assert.equal(selectionScope.value, "none");
});

test("selecting a country that does not exist reports no selection at all", () => {
  // The scope downgrades instead of reporting "country" with a null id.
  const { store, registry } = createTestApp();
  const { scope: selectionScope, selectedCountry, selectedCountryId } = store.selection;

  registry.selectCountry(7);
  assert.equal(selectedCountryId.value, null);
  assert.equal(selectedCountry.value, null);
  assert.equal(selectionScope.value, "none");
});

test("an unowned province selection reports no country", () => {
  // The plaque's second empty state: a province with no owner.
  const { store, registry } = createTestApp();
  const { scope: selectionScope, selectedCountry, selectedCountryId, selectedProvinceId } = store.selection;
  registry.selectProvince(11);

  assert.equal(selectedProvinceId.value, 11);
  assert.equal(selectedCountryId.value, null);
  assert.equal(selectedCountry.value, null);
  assert.equal(selectionScope.value, "province");
});

test("selectedCountry carries the record", () => {
  const { store, registry } = createTestApp();
  setCountries(store, [country(1, [11], { name: "Alnwick Union" })]);
  registry.selectCountryOfProvince(11);

  assert.equal(store.selection.selectedCountry.value?.name, "Alnwick Union");
});

test("countries that arrive after a selection update the derived owner", () => {
  // The selection can be made before `loadMap` writes the countries.
  const { store, registry } = createTestApp();
  registry.selectProvince(11);
  assert.equal(store.selection.selectedCountryId.value, null);

  setCountries(store, [country(1, [11])]);
  assert.equal(store.selection.selectedCountryId.value, 1);
});

test("clearSelection empties a country-scoped selection", () => {
  const { store, registry } = createTestApp();
  const { scope: selectionScope, selectedCountryId, selectedProvinceId } = store.selection;
  setCountries(store, [country(1, [11])]);
  registry.selectCountryOfProvince(11);

  registry.clearSelection();
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
