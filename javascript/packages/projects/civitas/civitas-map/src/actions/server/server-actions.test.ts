import assert from "node:assert/strict";
import test from "node:test";
import {
  createTestApp,
  serverMap,
} from "../../test-support";

const LAYOUT = {
  countries: [
    {
      id: "c-a",
      name: "Aurelia",
      hex: "#c0563f",
      provinces: [{ id: "p-1", name: "Capital", hex: "#112233" }],
    },
  ],
};

function pngFile(name = "map.png"): File {
  return new File(["png"], name, { type: "image/png" });
}

test("Maps… lists the backend maps, and a pick opens one with its stored layout", async () => {
  const app = createTestApp();
  const map = serverMap("World");
  app.api.maps = [map];
  app.api.layouts.set(map.id, structuredClone(LAYOUT));

  const listing = app.registry.openServerMaps();
  assert.equal(app.store.server.dialog.value?.status, "loading");
  await listing;
  assert.deepEqual(app.store.server.dialog.value?.maps, [map]);

  await app.registry.pickServerMap(map);
  assert.equal(app.store.server.dialog.value, null);
  assert.equal(app.store.server.map.value, map);
  assert.deepEqual(app.store.map.info.value, { name: "World", width: 8, height: 6 });
  assert.deepEqual(app.store.provinces.list.value.map((entry) => [entry.id, entry.name, entry.hex]), [[1, "Capital", "#112233"]]);
  assert.deepEqual(app.store.countries.list.value, [{ id: 1, name: "Aurelia", colorHex: "#c0563f", provinceIds: [1] }]);
});

test("a map with nothing stored opens like a fresh map", async () => {
  const app = createTestApp();
  await app.registry.pickServerMap(serverMap("Empty"));

  assert.equal(app.store.provinces.list.value.length, 1);
  assert.deepEqual(app.store.countries.list.value, []);
  assert.equal(app.store.server.layout.value?.countries.length, 0);
});

test("a failed open leaves the editor as it was", async () => {
  const app = createTestApp();
  app.api.failure = new Error("backend/API/maps/x/countries responded 500");
  await app.registry.pickServerMap(serverMap("World"));

  assert.equal(app.store.map.info.value, null);
  assert.equal(app.store.server.map.value, null);
  assert.equal(app.store.status.error.value, "backend/API/maps/x/countries responded 500");
});

test("a new map is uploaded and opened; a missing name or image is refused", async () => {
  const app = createTestApp();
  await app.registry.openServerMaps();

  await app.registry.createServerMap("  ", pngFile());
  assert.equal(app.store.server.dialog.value?.createError, "Name the map");

  await app.registry.createServerMap("World", new File(["jpg"], "map.jpg", { type: "image/jpeg" }));
  assert.equal(app.store.server.dialog.value?.createError, "Pick a png image");

  await app.registry.createServerMap("World", pngFile());
  assert.equal(app.store.server.dialog.value, null);
  assert.equal(app.store.server.map.value?.name, "World");
  assert.equal(app.api.maps.length, 1);
});

test("a failed upload shows its reason in the dialog", async () => {
  const app = createTestApp();
  await app.registry.openServerMaps();
  app.api.failure = new Error("backend/API/maps responded 500");

  await app.registry.createServerMap("World", pngFile());
  assert.equal(app.store.server.dialog.value?.creating, false);
  assert.equal(app.store.server.dialog.value?.createError, "backend/API/maps responded 500");
});

test("a detection on a backend map takes the stored names and countries by hex", async () => {
  const app = createTestApp({
    detect: async () => {
      const pixels = new Uint32Array(8 * 6);
      return {
        pixels,
        provinces: [{ index: 1, color: 0xff000000 | (0x33 << 16) | (0x22 << 8) | 0x11 }, { index: 2, color: 0xff0000ff }],
        stats: {
          bodies: 1,
          keptBodies: 1,
          edgeBodies: 0,
          discardedSpecks: 0,
          riverPixels: 0,
          enclosedWaterPixels: 0,
          unassignedInsideLand: 0,
          largestArea: 1,
          medianArea: 1,
        },
      };
    },
  });
  const map = serverMap("World");
  app.api.layouts.set(map.id, structuredClone(LAYOUT));
  await app.registry.pickServerMap(map);

  await app.registry.detectFromBaseMap();
  assert.deepEqual(app.store.provinces.list.value.map((entry) => [entry.hex, entry.name]), [
    ["#112233", "Capital"],
    ["#ff0000", "Province 2"],
  ]);
  assert.deepEqual(app.store.countries.list.value[0].provinceIds, [1]);
  assert.match(app.store.status.notice.value ?? "", /Matched 1 of 1 stored province by colour\./);
});

test("Save replaces the stored layout: deleted countries and provinces are gone", async () => {
  const app = createTestApp();
  const map = serverMap("World");
  app.api.layouts.set(map.id, structuredClone(LAYOUT));
  await app.registry.pickServerMap(map);

  // Aurelia and its Capital are deleted; a new country with a new province is made.
  app.registry.deleteCountry(app.store.countries.list.value[0].id);
  app.registry.addProvince();
  const fresh = app.store.provinces.list.value[1];
  app.registry.deleteProvince(app.store.provinces.list.value[0].id);
  app.registry.addCountry();
  const newCountry = app.store.countries.list.value[0];
  app.store.countries.list.value = [{ ...newCountry, provinceIds: [fresh.id] }];

  await app.registry.saveToServer();
  assert.equal(app.store.status.error.value, null);
  assert.match(app.store.status.notice.value ?? "", /^Saved 1 country and 1 province, replacing/);
  assert.deepEqual(app.api.layouts.get(map.id)?.countries.map((entry) => [entry.name, entry.provinces.map((p) => p.hex)]), [
    [newCountry.name, [fresh.hex]],
  ]);
  assert.deepEqual(app.store.server.layout.value, app.api.layouts.get(map.id));

  await app.registry.pickServerMap(map);
  assert.deepEqual(app.store.provinces.list.value.map((entry) => entry.hex), [fresh.hex], "Capital does not come back");
});

test("a failed save says so and keeps the layout it had", async () => {
  const app = createTestApp();
  const map = serverMap("World");
  app.api.layouts.set(map.id, structuredClone(LAYOUT));
  await app.registry.pickServerMap(map);
  app.api.failure = new Error("backend/API/maps/x/layout responded 409: country name \"Aurelia\" is used twice");

  await app.registry.saveToServer();
  assert.match(app.store.status.error.value ?? "", /^Save failed: .*409/);
  assert.deepEqual(app.store.server.layout.value, LAYOUT);
});

test("Save stores the province and countries layers, and reopening paints them back", async () => {
  const app = createTestApp();
  const map = serverMap("World");
  app.api.maps = [map];
  app.api.layouts.set(map.id, structuredClone(LAYOUT));
  await app.registry.pickServerMap(map);

  // Capital is painted; a second province, in no stored country, goes into a new one.
  const capital = app.store.provinces.list.value[0];
  app.registry.addProvince();
  const fresh = app.store.provinces.list.value[1];
  const layer = app.store.map.layer.value;
  assert.ok(layer);
  const pixels = new Uint32Array(8 * 6);
  pixels.fill(capital.color, 0, 24);
  pixels.fill(fresh.color, 24, 40);
  layer.loadPixels(pixels);
  app.registry.addCountry();
  const country = app.store.countries.list.value[1];
  app.store.countries.list.value = [
    { ...app.store.countries.list.value[0], provinceIds: [] },
    { ...country, provinceIds: [capital.id, fresh.id] },
  ];

  await app.registry.saveToServer();
  assert.equal(app.store.status.error.value, null);
  assert.ok(app.api.layerImages.has(map.id + "/provinces"));
  assert.ok(app.api.layerImages.has(map.id + "/countries"));
  assert.ok(app.store.server.map.value?.provincesImageUrl);

  const reopened = createTestApp();
  reopened.api.maps = app.api.maps;
  reopened.api.layouts = app.api.layouts;
  reopened.api.layerImages = app.api.layerImages;
  await reopened.registry.pickServerMap(app.store.server.map.value as typeof map);

  assert.deepEqual([...(reopened.store.map.layer.value?.readPixels() ?? [])], [...pixels], "the layer is painted back");
  assert.deepEqual(reopened.store.provinces.list.value.map((entry) => entry.hex), [capital.hex, fresh.hex]);
  // The stored rows still file Capital under Aurelia; the countries image moved it.
  assert.deepEqual(reopened.store.countries.list.value.map((entry) => [entry.name, entry.provinceIds]), [
    ["Aurelia", []],
    [country.name, [1, 2]],
  ]);
});

test("Save needs a map from the backend", async () => {
  const app = createTestApp();
  await app.registry.saveToServer();

  assert.match(app.store.status.error.value ?? "", /Open a map from the backend/);
});

test("a map opened from elsewhere forgets the backend map", async () => {
  const app = createTestApp();
  await app.registry.pickServerMap(serverMap("World"));
  await app.registry.openMapFile(pngFile("local.png"));

  assert.equal(app.store.server.map.value, null);
  assert.equal(app.store.server.layout.value, null);
});
