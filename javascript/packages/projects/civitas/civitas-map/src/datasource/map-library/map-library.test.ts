import assert from "node:assert/strict";
import test from "node:test";
import {
  createMapLibrary,
  parseImageList,
  type FetchFn,
} from "./map-library";

function fakeFetch(routes: Record<string, Response>): { fetch: FetchFn; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      return routes[url] ?? new Response("", { status: 404 });
    },
  };
}

test("the list is read from api/maps", async () => {
  const server = fakeFetch({
    "api/maps": Response.json({
      images: [{ name: "a.png", url: "assets/maps/a.png", bytes: 3, manifestUrl: "assets/maps/a.json", countriesUrl: null }],
    }),
  });
  const library = createMapLibrary({ fetch: server.fetch });

  assert.deepEqual(await library.listImages(), [
    { name: "a.png", url: "assets/maps/a.png", bytes: 3, manifestUrl: "assets/maps/a.json", countriesUrl: null },
  ]);
  assert.deepEqual(server.calls, ["api/maps"]);
});

test("a failed or malformed answer is an error with the reason", async () => {
  const failing = createMapLibrary({ fetch: fakeFetch({ "api/maps": new Response("", { status: 500 }) }).fetch });
  await assert.rejects(failing.listImages(), /api\/maps responded 500/);

  const notJson = createMapLibrary({ fetch: fakeFetch({ "api/maps": new Response("<html>") }).fetch });
  await assert.rejects(notJson.listImages(), /not JSON/);

  assert.throws(() => {
    parseImageList({ files: [] });
  }, /without an `images` list/);
  assert.throws(() => {
    parseImageList({ images: [{ name: "a.png", url: "u" }] });
  }, /a.png has no size/);
});

test("a missing or empty manifest url means no manifest", () => {
  assert.deepEqual(parseImageList({ images: [{ name: "a", url: "u", bytes: 1, manifestUrl: "", countriesUrl: null }] }), [
    { name: "a", url: "u", bytes: 1, manifestUrl: null, countriesUrl: null },
  ]);
});

test("the image and its manifest are fetched from their urls", async () => {
  const server = fakeFetch({
    "assets/maps/a.png": new Response("png"),
    "assets/maps/a.json": new Response("{\"provinces\":[]}"),
  });
  const library = createMapLibrary({ fetch: server.fetch });
  const image = { name: "a.png", url: "assets/maps/a.png", bytes: 3, manifestUrl: "assets/maps/a.json", countriesUrl: null };

  assert.equal(await (await library.fetchImage(image)).text(), "png");
  assert.equal(await library.fetchManifest(image), "{\"provinces\":[]}");
  assert.equal(await library.fetchManifest({ ...image, manifestUrl: null, countriesUrl: null }), null);
});

test("the countries file is fetched from its url, and a missing url means none", async () => {
  const server = fakeFetch({
    "assets/maps/a.countries.json": new Response("{\"countries\":[]}"),
  });
  const library = createMapLibrary({ fetch: server.fetch });
  const image = { name: "a.png", url: "assets/maps/a.png", bytes: 3, manifestUrl: null, countriesUrl: "assets/maps/a.countries.json" };

  assert.equal(await library.fetchCountries(image), "{\"countries\":[]}");
  assert.equal(await library.fetchCountries({ ...image, countriesUrl: null }), null);
});
