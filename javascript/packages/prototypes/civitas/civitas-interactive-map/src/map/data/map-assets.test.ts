import assert from "node:assert/strict";
import test from "node:test";
import {
  LOAD_STEPS,
  MANIFEST_URL,
  MAP_IMAGE_URL,
  PROVINCE_IMAGE_URL,
  fetchBitmap,
  loadMapAssets,
} from "./map-assets";
import type { LoadStep } from "./map-assets";

// `map-assets.ts` is mostly orchestration over `fetch`, `createImageBitmap` and a
// canvas, and PLAN section 4 rules out DOM and canvas tests. What is tested here
// is only what survives without either: the URL and step constants, and the two
// failure paths that a stubbed `fetch` can reach on its own. Neither
// `createImageBitmap` nor `document` exists in Node, so every test below stops
// before the decode.

type FetchStub = (url: string) => Response;

// Node runs each test file in its own process, so the global is not shared with
// any other file. It is still restored, because the tests here run in one.
async function withFetch(stub: FetchStub, body: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    return stub(String(input));
  }) as typeof globalThis.fetch;
  try {
    await body();
  } finally {
    globalThis.fetch = original;
  }
}

test("the asset URLs are relative, so a subdirectory deploy still resolves them", () => {
  assert.equal(MANIFEST_URL, "assets/provinces_manifest.json");
  assert.equal(PROVINCE_IMAGE_URL, "assets/provinces_map.png");
  assert.equal(MAP_IMAGE_URL, "assets/map.png");

  for (const url of [MANIFEST_URL, PROVINCE_IMAGE_URL, MAP_IMAGE_URL]) {
    // A leading slash would pin the app to the domain root. The dev server maps
    // `./assets` onto `/assets` and CopyRspackPlugin emits `dist/assets/`, so the
    // relative form is the one string that resolves under both.
    assert.ok(!url.startsWith("/"), url + " must not start with a slash");
    assert.ok(url.startsWith("assets/"), url + " must live under assets/");
    assert.ok(!url.includes("://"), url + " must not be absolute");
  }
});

test("LOAD_STEPS lists every step once, in order, ending at done", () => {
  // `loadProgress` in the store divides by `LOAD_STEPS.length - 1`, so both the
  // order and the length are load-bearing: a duplicate or a missing entry makes
  // the progress bar jump or exceed 1.
  const expected: LoadStep[] = [
    "manifest",
    "province-bitmap",
    "province-index",
    "map-art",
    "done",
  ];

  assert.deepEqual(Array.from(LOAD_STEPS), expected);
  assert.equal(new Set(LOAD_STEPS).size, LOAD_STEPS.length);
  assert.equal(LOAD_STEPS[LOAD_STEPS.length - 1], "done");
  assert.equal(LOAD_STEPS.indexOf("done") / (LOAD_STEPS.length - 1), 1);
});

test("a non-2xx response names both the URL and the status", async () => {
  await withFetch(
    () => {
      return new Response("nope", { status: 404 });
    },
    async () => {
      await assert.rejects(
        fetchBitmap("assets/provinces_map.png"),
        /assets\/provinces_map\.png responded 404/,
      );
    },
  );
});

test("a dev server answering the manifest path with HTML fails with the URL attached", async () => {
  // The reason `fetchManifest` reads `response.text()` instead of calling
  // `response.json()`: a bare SyntaxError names nothing, and this is the single
  // most likely way the app breaks after a path change.
  await withFetch(
    () => {
      return new Response("<!doctype html><html></html>", { status: 200 });
    },
    async () => {
      await assert.rejects(
        loadMapAssets(),
        /assets\/provinces_manifest\.json: manifest is not valid JSON/,
      );
    },
  );
});

test("a manifest the parser rejects surfaces the parser's own message, prefixed", async () => {
  const payload = JSON.stringify({
    format: "civitas.province-map",
    version: 2,
    map: { source: "x.png", width: 3653, height: 2855 },
    provinces: [],
    painted: { pixelCount: 0, coverage: 0, unregisteredColors: [] },
  });

  const steps: LoadStep[] = [];
  await withFetch(
    () => {
      return new Response(payload, { status: 200 });
    },
    async () => {
      await assert.rejects(
        loadMapAssets((step) => {
          steps.push(step);
        }),
        /assets\/provinces_manifest\.json: manifest version is 2, expected 1/,
      );
    },
  );

  // The manifest is awaited first, so the caller has already been told which
  // step was running when it failed.
  assert.deepEqual(steps, ["manifest"]);
});
