import assert from "node:assert/strict";
import test from "node:test";
import {
  createTestApp,
  mapImage,
  type TestApp,
} from "../../test-support";

async function appWithMap(): Promise<TestApp> {
  const app = createTestApp();
  const image = mapImage("world.png");
  app.library.files.set(image.url, new Blob(["png"]));
  await app.registry.openLibrary("map");
  await app.registry.pickLibraryImage(image);
  app.registry.setBrushSize(1);
  return app;
}

test("a stroke paints the active province and is one undo step", async () => {
  const app = await appWithMap();
  const color = app.store.provinces.active.value!.color;

  assert.equal(app.registry.beginStroke(1, 1, false), true);
  app.registry.extendStroke({ x: 1, y: 1 }, { x: 4, y: 1 }, false);
  app.registry.endStroke();

  const layer = app.store.map.layer.value!;
  assert.equal(layer.pixelAt(4, 1), color);
  assert.equal(app.store.map.canUndo.value, true);

  app.registry.undo();
  assert.equal(layer.pixelAt(4, 1), 0);
  assert.equal(app.store.map.canRedo.value, true);
});

test("painting without a province is refused with a reason", async () => {
  const app = await appWithMap();
  app.registry.deleteProvince(app.store.provinces.list.value[0].id);

  assert.equal(app.registry.beginStroke(1, 1, false), false);
  assert.equal(app.store.status.error.value, "Add a province before painting");
  // Erasing needs no province.
  assert.equal(app.registry.beginStroke(1, 1, true), true);
});

test("a press outside the map does nothing", async () => {
  const app = await appWithMap();

  assert.equal(app.registry.beginStroke(-1, 3, false), false);
  app.registry.fillAt(100, 3, false);
  assert.equal(app.store.status.error.value, null);
});

test("fill covers the run, and the picker selects what is painted", async () => {
  const app = await appWithMap();
  const first = app.store.provinces.active.value!;
  app.registry.fillAt(0, 0, false);
  app.registry.addProvince();

  app.registry.pickAt(5, 5);
  assert.equal(app.store.provinces.activeId.value, first.id);

  app.registry.clearLayer();
  app.registry.pickAt(5, 5);
  assert.equal(app.store.status.error.value, "No province is painted at that pixel");
});

test("hover follows the pixel under the cursor and clears on leave", async () => {
  const app = await appWithMap();
  app.registry.fillAt(0, 0, false);

  app.registry.setHover({ x: 2, y: 2 });
  assert.deepEqual(app.store.hover.pixel.value, { x: 2, y: 2 });
  assert.equal(app.store.hover.province.value?.id, app.store.provinces.activeId.value);

  app.registry.setHover({ x: 50, y: 2 });
  assert.equal(app.store.hover.pixel.value, null);

  app.registry.setHover(null);
  assert.equal(app.store.hover.color.value, 0);
});
