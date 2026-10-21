import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createMapsApiMiddleware, listMapImages } from "./maps-api.mjs";

async function withDirectory(files, run) {
  const directory = await mkdtemp(path.join(tmpdir(), "maps-api-"));
  try {
    for (const [name, body] of Object.entries(files)) {
      if (body === null) {
        await mkdir(path.join(directory, name));
        continue;
      }
      await writeFile(path.join(directory, name), body);
    }
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// A fake of the slice of `http.ServerResponse` the middleware uses.
function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body) {
      this.body = body;
      this.resolve();
    },
  };
}

function call(middleware, request) {
  const response = fakeResponse();
  let nextCalled = false;
  const done = new Promise((resolve) => {
    response.resolve = resolve;
  });
  middleware(request, response, () => {
    nextCalled = true;
    response.resolve();
  });
  return done.then(() => {
    return { response, nextCalled };
  });
}

test("lists the images sorted by name, with their size and url", async () => {
  await withDirectory({ "b.webp": "bb", "a.png": "a", "c.JPG": "ccc", "notes.txt": "x" }, async (directory) => {
    const images = await listMapImages(directory, "assets/maps/");
    assert.deepEqual(images, [
      { name: "a.png", url: "assets/maps/a.png", bytes: 1, manifestUrl: null },
      { name: "b.webp", url: "assets/maps/b.webp", bytes: 2, manifestUrl: null },
      { name: "c.JPG", url: "assets/maps/c.JPG", bytes: 3, manifestUrl: null },
    ]);
  });
});

test("an image with a JSON file of the same stem gets it as its manifest", async () => {
  await withDirectory({ "x-provinces.png": "p", "x-provinces.json": "{}", "orphan.json": "{}" }, async (directory) => {
    const images = await listMapImages(directory, "assets/maps/");
    assert.equal(images.length, 1);
    assert.equal(images[0].manifestUrl, "assets/maps/x-provinces.json");
  });
});

test("names are URL-encoded and folders are skipped", async () => {
  await withDirectory({ "my map #1.png": "m", "folder.png": null }, async (directory) => {
    const images = await listMapImages(directory, "assets/maps/");
    assert.deepEqual(images.map((image) => image.url), ["assets/maps/my%20map%20%231.png"]);
  });
});

test("a missing directory is an empty library", async () => {
  const images = await listMapImages(path.join(tmpdir(), "maps-api-does-not-exist-" + Date.now()), "assets/maps/");
  assert.deepEqual(images, []);
});

test("the middleware answers GET with the JSON list", async () => {
  await withDirectory({ "a.png": "a" }, async (directory) => {
    const middleware = createMapsApiMiddleware({ directory, urlPrefix: "assets/maps/" });
    const { response, nextCalled } = await call(middleware, { method: "GET", url: "/" });
    assert.equal(nextCalled, false);
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"], /^application\/json/);
    assert.deepEqual(JSON.parse(response.body), {
      images: [{ name: "a.png", url: "assets/maps/a.png", bytes: 1, manifestUrl: null }],
    });
  });
});

test("the middleware passes other methods and deeper paths on", async () => {
  const middleware = createMapsApiMiddleware({ directory: tmpdir(), urlPrefix: "assets/maps/" });
  assert.equal((await call(middleware, { method: "POST", url: "/" })).nextCalled, true);
  assert.equal((await call(middleware, { method: "GET", url: "/a.png" })).nextCalled, true);
});
