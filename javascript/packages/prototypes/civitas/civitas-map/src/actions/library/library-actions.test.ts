import assert from "node:assert/strict";
import test from "node:test";
import {
  createTestApp,
  mapImage,
} from "../../test-support";

test("Load map lists the library, and a pick opens the image as the base map", async () => {
  const app = createTestApp();
  const image = mapImage("world.png");
  app.library.images = [image];
  app.library.files.set(image.url, new Blob(["png"]));

  const listing = app.registry.openLibrary("map");
  assert.equal(app.store.library.state.value?.status, "loading");
  await listing;
  assert.deepEqual(app.store.library.state.value, { mode: "map", status: "ready", images: [image], error: null });

  await app.registry.pickLibraryImage(image);
  assert.equal(app.store.library.state.value, null);
  assert.deepEqual(app.store.map.info.value, { name: "world.png", width: 8, height: 6 });
  assert.equal(app.store.provinces.list.value.length, 1, "a fresh map starts with one province");
  assert.equal(app.store.status.loading.value, false);
});

test("a failed list request shows its reason, and retry asks again", async () => {
  const app = createTestApp();
  app.library.failure = new Error("api/maps responded 500");

  await app.registry.openLibrary("map");
  assert.equal(app.store.library.state.value?.status, "failed");
  assert.equal(app.store.library.state.value?.error, "api/maps responded 500");

  app.library.failure = null;
  await app.registry.retryLibrary();
  assert.equal(app.store.library.state.value?.status, "ready");
});

test("an answer that arrives after the dialog closed is dropped", async () => {
  const app = createTestApp();
  const listing = app.registry.openLibrary("map");
  app.registry.closeLibrary();
  await listing;

  assert.equal(app.store.library.state.value, null);
});

test("Load provinces needs an open map", async () => {
  const app = createTestApp();
  await app.registry.openLibrary("provinces");

  assert.equal(app.store.library.state.value, null);
  assert.equal(app.store.status.error.value, "Load the map image before loading provinces into it");
});

test("a provinces pick loads the image and the manifest beside it", async () => {
  const app = createTestApp();
  const base = mapImage("world.png");
  const exported = mapImage("world-provinces.png", "assets/maps/world-provinces.json");
  app.library.files.set(base.url, new Blob(["png"]));
  app.library.files.set(exported.url, new Blob(["png"]));
  app.library.files.set("assets/maps/world-provinces.json", new Blob([JSON.stringify({
    map: { source: "world.png", width: 8, height: 6 },
    provinces: [{ id: 3, name: "Three", kind: "land", rgb: [10, 20, 30] }],
  })]));
  await app.registry.openLibrary("map");
  await app.registry.pickLibraryImage(base);

  // Two pixels of the listed colour, one pixel of a colour the manifest misses.
  const pixels = new Uint32Array(48);
  const listedColor = 0xff1e140a;
  pixels[0] = listedColor;
  pixels[1] = listedColor;
  pixels[2] = 0xff0000ff;
  app.images.provincePixels = pixels;

  await app.registry.openLibrary("provinces");
  await app.registry.pickLibraryImage(exported);

  assert.deepEqual(app.store.provinces.list.value.map((province) => province.name), ["Three", "Province 4"]);
  assert.equal(app.store.provinces.activeId.value, 3);
  assert.equal(app.store.status.notice.value, "Loaded 1 province from the manifest, 1 unlisted colour adopted.");
  assert.equal(app.store.map.layer.value?.pixelAt(0, 0), listedColor);
});
