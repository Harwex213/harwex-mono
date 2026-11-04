import assert from "node:assert/strict";
import test from "node:test";
import {
  createTestApp,
  mapImage,
} from "../../test-support";

async function appWithPaint() {
  const app = createTestApp();
  const image = mapImage("world.png");
  app.library.files.set(image.url, new Blob(["png"]));
  await app.registry.openLibrary("map");
  await app.registry.pickLibraryImage(image);
  app.registry.fillAt(0, 0, false);
  return app;
}

test("recolouring rewrites the pixels and refuses a colour in use", async () => {
  const app = await appWithPaint();
  const first = app.store.provinces.list.value[0];

  assert.equal(app.registry.recolorProvince(first.id, { r: 1, g: 2, b: 3 }), true);
  assert.equal(app.store.provinces.list.value[0].hex, "#010203");
  assert.equal(app.store.map.layer.value?.pixelAt(0, 0), app.store.provinces.list.value[0].color);

  app.registry.addProvince();
  const second = app.store.provinces.list.value[1];
  assert.equal(app.registry.recolorProvince(second.id, { r: 1, g: 2, b: 3 }), false);
  assert.equal(app.store.status.error.value, "#010203 is already used by another province");
});

test("deleting a province erases its pixels and activates the last one left", async () => {
  const app = await appWithPaint();
  const first = app.store.provinces.list.value[0];
  app.registry.addProvince();
  app.registry.addProvince();
  app.registry.selectProvince(first.id);

  app.registry.deleteProvince(first.id);

  assert.equal(app.store.map.layer.value?.pixelAt(0, 0), 0);
  assert.equal(app.store.provinces.list.value.length, 2);
  assert.equal(app.store.provinces.activeId.value, app.store.provinces.list.value[1].id);
  assert.equal(app.store.map.canUndo.value, true);
});

test("export writes the PNG and the manifest named after the map", async () => {
  const app = await appWithPaint();
  app.registry.renameProvince(app.store.provinces.list.value[0].id, "Everything");

  await app.registry.exportAll();

  assert.deepEqual(app.downloads.files.map((file) => file.filename), ["world-provinces.png", "world-provinces.json"]);
  const manifest = app.downloads.files[1].value as { provinces: Array<{ name: string; pixelCount: number }> };
  assert.equal(manifest.provinces[0].name, "Everything");
  assert.equal(manifest.provinces[0].pixelCount, 48);
});

test("detection replaces the layer and the registry and reports the result", async () => {
  const pixels = new Uint32Array(48).fill(0xff102030);
  const app = createTestApp({
    detect: async () => {
      return {
        pixels,
        provinces: [{ index: 1, color: 0xff102030 }],
        stats: {
          bodies: 1,
          keptBodies: 1,
          edgeBodies: 0,
          discardedSpecks: 0,
          riverPixels: 0,
          enclosedWaterPixels: 0,
          unassignedInsideLand: 0,
          largestArea: 48,
          medianArea: 48,
        },
      };
    },
  });
  const image = mapImage("world.png");
  app.library.files.set(image.url, new Blob(["png"]));
  await app.registry.openLibrary("map");
  await app.registry.pickLibraryImage(image);

  await app.registry.detectFromBaseMap();

  assert.deepEqual(app.store.provinces.list.value.map((province) => province.name), ["Province 1"]);
  assert.equal(app.store.map.layer.value?.pixelAt(7, 5), 0xff102030);
  assert.equal(app.store.status.notice.value, "Detected 1 land provinces across 1 landmasses, largest 48 px, median 48 px.");
  assert.equal(app.store.status.detecting.value, false);
});
