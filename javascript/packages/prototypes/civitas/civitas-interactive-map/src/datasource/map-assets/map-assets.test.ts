import assert from "node:assert/strict";
import test from "node:test";
import {
  COUNTRIES_URL,
  MANIFEST_URL,
  MAP_IMAGE_URL,
  PROVINCE_IMAGE_URL,
  fetchBitmap,
  loadMapAssets,
} from "./map-assets";
import type { LoadStep } from "./load-steps";

// Node has no `createImageBitmap` or DOM. The tests cover the constants and the
// failure paths that a stubbed `fetch` reaches before any decode.

type FetchStub = (url: string) => Response;

// Restores the global `fetch`, because the tests in this file share one process.
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
  assert.equal(COUNTRIES_URL, "assets/countries.json");

  for (const url of [MANIFEST_URL, PROVINCE_IMAGE_URL, MAP_IMAGE_URL, COUNTRIES_URL]) {
    // Relative URLs resolve in dev, in `dist/` and under a deploy sub-path.
    assert.ok(!url.startsWith("/"), url + " must not start with a slash");
    assert.ok(url.startsWith("assets/"), url + " must live under assets/");
    assert.ok(!url.includes("://"), url + " must not be absolute");
  }
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
  // An `index.html` fallback must fail with the URL, not a bare SyntaxError.
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

  // The caller already knows which step failed.
  assert.deepEqual(steps, ["manifest"]);
});

// A manifest the parser accepts, so the load reaches the countries step.
const VALID_MANIFEST = JSON.stringify({
  format: "civitas.province-map",
  version: 1,
  map: { source: "x.png", width: 2, height: 1 },
  provinces: [],
  painted: { pixelCount: 0, coverage: 0, unregisteredColors: [] },
});

test("a missing countries file fails the load with its URL and status", async () => {
  const steps: LoadStep[] = [];
  await withFetch(
    (url) => {
      if (url === MANIFEST_URL) {
        return new Response(VALID_MANIFEST, { status: 200 });
      }
      return new Response("nope", { status: 404 });
    },
    async () => {
      await assert.rejects(
        loadMapAssets((step) => {
          steps.push(step);
        }),
        /assets\/countries\.json responded 404/,
      );
    },
  );

  assert.deepEqual(steps, ["manifest", "countries"]);
});

test("a countries file of another format fails the load with the parser's message", async () => {
  await withFetch(
    (url) => {
      if (url === MANIFEST_URL) {
        return new Response(VALID_MANIFEST, { status: 200 });
      }
      if (url === COUNTRIES_URL) {
        return new Response(JSON.stringify({ format: "civitas.countries", version: 9, countries: [] }), {
          status: 200,
        });
      }
      return new Response("nope", { status: 404 });
    },
    async () => {
      await assert.rejects(loadMapAssets(), /assets\/countries\.json: countries version is 9, expected 1/);
    },
  );
});
