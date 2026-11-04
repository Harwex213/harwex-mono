import assert from "node:assert/strict";
import test from "node:test";
import {
  createTestApp,
  mapImage,
  type TestApp,
} from "../../test-support";

// An 8 x 6 map with two provinces: province 1 on columns 0-4, province 2 on
// columns 5-7.
async function appWithTwoProvinces(): Promise<TestApp> {
  const app = createTestApp();
  const image = mapImage("world.png");
  app.library.files.set(image.url, new Blob(["png"]));
  await app.registry.openLibrary("map");
  await app.registry.pickLibraryImage(image);
  app.registry.setBrushSize(1);
  app.registry.fillAt(0, 0, false);
  app.registry.addProvince();
  app.registry.beginStroke(5, 0, false);
  app.registry.extendStroke({ x: 5, y: 0 }, { x: 5, y: 5 }, false);
  app.registry.endStroke();
  app.registry.fillAt(7, 0, false);
  app.registry.setMode("countries");
  return app;
}

function provinceIdsOf(app: TestApp): number[][] {
  return app.store.countries.list.value.map((country) => country.provinceIds);
}

test("a drag puts every province it crosses into the active country", async () => {
  const app = await appWithTwoProvinces();
  app.registry.addCountry();

  assert.equal(app.registry.beginCountryStroke(1, 1, false), true);
  assert.deepEqual(provinceIdsOf(app), [[1]]);
  app.registry.extendCountryStroke({ x: 1, y: 1 }, { x: 7, y: 1 });
  app.registry.endCountryStroke();

  assert.deepEqual(provinceIdsOf(app), [[1, 2]]);
  assert.equal(app.store.countries.stroke.value, null);
});

test("a stroke that starts on a province of the active country takes provinces out", async () => {
  const app = await appWithTwoProvinces();
  app.registry.addCountry();
  app.registry.beginCountryStroke(1, 1, false);
  app.registry.extendCountryStroke({ x: 1, y: 1 }, { x: 7, y: 1 });
  app.registry.endCountryStroke();

  app.registry.beginCountryStroke(7, 1, false);
  app.registry.endCountryStroke();

  assert.deepEqual(provinceIdsOf(app), [[1]]);
});

test("assigning a province to another country moves it there", async () => {
  const app = await appWithTwoProvinces();
  app.registry.addCountry();
  app.registry.beginCountryStroke(1, 1, false);
  app.registry.endCountryStroke();
  app.registry.addCountry();
  app.registry.beginCountryStroke(1, 1, false);
  app.registry.endCountryStroke();

  assert.deepEqual(provinceIdsOf(app), [[], [1]]);
  assert.equal(app.store.countries.owners.value.get(1), 2);
});

test("without a country a stroke is refused with a reason, but erasing works", async () => {
  const app = await appWithTwoProvinces();

  assert.equal(app.registry.beginCountryStroke(1, 1, false), false);
  assert.equal(app.store.status.error.value, "Add a country before assigning provinces");
  assert.equal(app.registry.beginCountryStroke(1, 1, true), true);
  assert.equal(app.registry.beginCountryStroke(-1, 1, true), false);
});

test("deleting a province takes it out of its country; deleting a country frees its provinces", async () => {
  const app = await appWithTwoProvinces();
  app.registry.addCountry();
  app.registry.beginCountryStroke(1, 1, false);
  app.registry.extendCountryStroke({ x: 1, y: 1 }, { x: 7, y: 1 });
  app.registry.endCountryStroke();

  app.registry.deleteProvince(2);
  assert.deepEqual(provinceIdsOf(app), [[1]]);

  app.registry.deleteCountry(1);
  assert.deepEqual(app.store.countries.list.value, []);
  assert.equal(app.store.countries.activeId.value, null);
  assert.equal(app.store.countries.owners.value.size, 0);
});

test("rename and recolour change the country; a half-typed colour is ignored", async () => {
  const app = await appWithTwoProvinces();
  app.registry.addCountry();
  app.registry.renameCountry(1, "Aurelia");
  app.registry.recolorCountry(1, "#ABCDEF");
  app.registry.recolorCountry(1, "#ab");

  const country = app.store.countries.list.value[0];
  assert.equal(country.name, "Aurelia");
  assert.equal(country.colorHex, "#abcdef");
});

test("the export writes the countries file beside the provinces", async () => {
  const app = await appWithTwoProvinces();
  await app.registry.exportAll();
  assert.deepEqual(app.downloads.files.map((file) => file.filename), [
    "world-provinces.png",
    "world-provinces.json",
  ]);

  app.registry.addCountry();
  app.registry.beginCountryStroke(7, 1, false);
  app.registry.endCountryStroke();
  app.downloads.files.length = 0;
  await app.registry.exportAll();

  const countries = app.downloads.files.find((file) => file.filename === "world-provinces.countries.json");
  assert.deepEqual(countries?.value, {
    format: "civitas.countries",
    version: 1,
    countries: [{ id: 1, name: "Country 1", colorHex: "#c0563f", provinceIds: [2] }],
  });
});

test("Load provinces reads the countries file beside the export and drops unknown ids", async () => {
  const app = await appWithTwoProvinces();
  const pixels = app.store.map.layer.value!.readPixels().slice();
  const manifest = JSON.stringify(
    (await (async () => {
      await app.registry.exportAll();
      return app.downloads.files.find((file) => file.filename === "world-provinces.json")!.value;
    })()),
  );
  const image = mapImage("world-provinces.png", "assets/maps/world-provinces.json", "assets/maps/world-provinces.countries.json");
  app.library.files.set(image.url, new Blob(["png"]));
  app.library.files.set(image.manifestUrl!, new Blob([manifest]));
  app.library.files.set(image.countriesUrl!, new Blob([JSON.stringify({
    format: "civitas.countries",
    version: 1,
    countries: [{ id: 3, name: "Borealis", colorHex: "#4f7fb5", provinceIds: [2, 9] }],
  })]));
  app.images.provincePixels = pixels;

  await app.registry.openLibrary("provinces");
  await app.registry.pickLibraryImage(image);

  assert.equal(app.store.status.error.value, null);
  assert.deepEqual(app.store.countries.list.value, [
    { id: 3, name: "Borealis", colorHex: "#4f7fb5", provinceIds: [2] },
  ]);
  assert.equal(app.store.countries.activeId.value, 3);
  assert.equal(app.store.countries.nextId.value, 4);
  assert.match(app.store.status.notice.value ?? "", /Loaded 1 country\. Skipped 1 unknown or doubly claimed province id\.$/);
});

test("a countries file of another format leaves the layer and the countries as they were", async () => {
  const app = await appWithTwoProvinces();
  app.registry.addCountry();
  const image = mapImage("world-provinces.png", null, "assets/maps/world-provinces.countries.json");
  app.library.files.set(image.url, new Blob(["png"]));
  app.library.files.set(image.countriesUrl!, new Blob(["{\"format\":\"something\"}"]));
  app.images.provincePixels = new Uint32Array(8 * 6);

  await app.registry.openLibrary("provinces");
  await app.registry.pickLibraryImage(image);

  assert.equal(app.store.status.error.value, "the countries file is not a civitas.countries file");
  assert.equal(app.store.countries.list.value.length, 1);
  assert.notEqual(app.store.map.layer.value!.pixelAt(0, 0), 0);
});

test("a new map drops the countries", async () => {
  const app = await appWithTwoProvinces();
  app.registry.addCountry();
  const image = mapImage("other.png");
  app.library.files.set(image.url, new Blob(["png"]));
  await app.registry.openLibrary("map");
  await app.registry.pickLibraryImage(image);

  assert.deepEqual(app.store.countries.list.value, []);
  assert.equal(app.store.countries.nextId.value, 1);
});
