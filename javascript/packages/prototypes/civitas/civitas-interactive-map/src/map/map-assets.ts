import { createProvinceIndex, sampleIntegrity } from "./province-index";
import { parseManifestText } from "./manifest";
import type { MapManifest } from "./manifest";
import type { ProvinceIndex } from "./province-index";

// Relative, with no leading slash. The dev server maps `./assets` onto `/assets`
// and CopyRspackPlugin emits `dist/assets/`, so the same string resolves in both.
// A leading slash would pin the app to the domain root; the app has no router, so
// the document URL is always `/`, and a relative path also survives being served
// from a subdirectory.
const MANIFEST_URL = "assets/provinces_manifest.json";
const PROVINCE_IMAGE_URL = "assets/provinces_map.png";
const MAP_IMAGE_URL = "assets/map.png";

type LoadStep = "manifest" | "province-bitmap" | "province-index" | "map-art" | "done";

const LOAD_STEPS: readonly LoadStep[] = [
  "manifest",
  "province-bitmap",
  "province-index",
  "map-art",
  "done",
];

type LoadedMapAssets = {
  manifest: MapManifest;
  index: ProvinceIndex;
  art: ImageBitmap;
};

// `colorSpaceConversion: "none"` because these pixels are identity data, not
// colour. Verified: `provinces_map.png` carries no sRGB/gAMA/iCCP chunk, so no
// conversion would happen either way — the option makes the intent explicit and
// holds if the asset is ever re-exported with a profile.
async function fetchBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(url + " responded " + response.status);
  }
  const blob = await response.blob();
  return await createImageBitmap(blob, { colorSpaceConversion: "none" });
}

// Reads the body as text and parses it here rather than calling `response.json()`.
// A dev server that answers a missing path with `index.html` then fails as
// "manifest is not valid JSON" with the URL attached, instead of a bare
// SyntaxError that names nothing.
async function fetchManifest(url: string): Promise<MapManifest> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(url + " responded " + response.status);
  }
  const text = await response.text();
  try {
    return parseManifestText(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(url + ": " + message);
  }
}

async function loadMapAssets(onStep?: (step: LoadStep) => void): Promise<LoadedMapAssets> {
  // All three requests start together: the province PNG is 566 KB, the art
  // 2.6 MB, and neither decode can start before its bytes arrive.
  const manifestPromise = fetchManifest(MANIFEST_URL);
  const provincePromise = fetchBitmap(PROVINCE_IMAGE_URL);
  const artPromise = fetchBitmap(MAP_IMAGE_URL);

  // They are awaited in order below, so the two later ones would count as
  // unhandled for a tick if the first rejects. A no-op catch keeps the console
  // clean; the real rejection is still delivered at the await.
  for (const promise of [manifestPromise, provincePromise, artPromise]) {
    promise.catch(() => undefined);
  }

  onStep?.("manifest");
  const manifest = await manifestPromise;

  onStep?.("province-bitmap");
  const provinceBitmap = await provincePromise;

  onStep?.("province-index");
  let index: ProvinceIndex;
  try {
    index = createProvinceIndex(provinceBitmap, manifest);
  } finally {
    // ~42 MB, and the pixels are packed by now.
    provinceBitmap.close();
  }

  const sample = sampleIntegrity(index, manifest.provinces, 200);
  if (sample.checked > 0 && sample.matched / sample.checked < 0.9) {
    throw new Error(
      "the province bitmap disagrees with the manifest (" +
        sample.matched +
        "/" +
        sample.checked +
        " sampled centroids matched) — the image was probably colour-converted on decode",
    );
  }

  onStep?.("map-art");
  const art = await artPromise;

  // map.png is one pixel narrower than provinces_map.png by design (PLAN
  // section 2). Same height, at most one pixel of width difference. Anything
  // else is a different map and would put every province in the wrong place.
  if (Math.abs(art.width - manifest.map.width) > 1 || art.height !== manifest.map.height) {
    throw new Error(
      "map.png is " +
        art.width +
        "x" +
        art.height +
        ", which does not match the " +
        manifest.map.width +
        "x" +
        manifest.map.height +
        " province map",
    );
  }

  onStep?.("done");

  // `art` is deliberately NOT closed — it is the render source for T03.
  return { manifest, index, art };
}

export {
  LOAD_STEPS,
  MANIFEST_URL,
  MAP_IMAGE_URL,
  PROVINCE_IMAGE_URL,
  fetchBitmap,
  loadMapAssets,
  type LoadStep,
  type LoadedMapAssets,
};
