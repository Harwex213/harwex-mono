import { LOAD_STEPS, createProvinceIndex, parseManifestText, sampleIntegrity } from "../domain/index";
import type { LoadStep, LoadedMapAssets, MapManifest, ProvinceIndex } from "../domain/index";

// Relative URLs with no leading slash. They resolve in dev and in `dist/`,
// and they survive deployment under a sub-path.
const MANIFEST_URL = "assets/provinces_manifest.json";
const PROVINCE_IMAGE_URL = "assets/provinces_map.png";
const MAP_IMAGE_URL = "assets/map.png";

// `colorSpaceConversion: "none"`: province pixels are ids, not colour.
// A colour profile added on a later re-export must not shift them.
async function fetchBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(url + " responded " + response.status);
  }
  const blob = await response.blob();
  return await createImageBitmap(blob, { colorSpaceConversion: "none" });
}

// Parses text, not `response.json()`, so that an `index.html` fallback fails
// with the URL in the error instead of a bare SyntaxError.
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
  // Start all three downloads at once.
  const manifestPromise = fetchManifest(MANIFEST_URL);
  const provincePromise = fetchBitmap(PROVINCE_IMAGE_URL);
  const artPromise = fetchBitmap(MAP_IMAGE_URL);

  // The promises are awaited in order. A no-op catch stops an "unhandled rejection"
  // when an earlier one fails. The await still sees the real rejection.
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
    // Frees ~42 MB. The index already holds the packed pixels.
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

  // map.png is 1 px narrower by design. Any larger mismatch means a different map.
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

  // `art` stays open: the map canvas renders from it.
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
