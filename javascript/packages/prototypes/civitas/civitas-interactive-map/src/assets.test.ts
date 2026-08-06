import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

// The numbers in PLAN section 2 are load-bearing for every later task: T02 sizes
// its lookup table by them, T03 clamps zoom against them, T04 walks the bitmap
// with them. If someone regenerates the assets and a number moves, this file
// fails before the map silently renders wrong.

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

const MAP_WIDTH = 3653;
const MAP_HEIGHT = 2855;
const PROVINCE_COUNT = 1648;

type Bounds = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };
type Province = {
  id: number;
  name: string;
  kind: string;
  hex: string;
  rgb: [number, number, number];
  pixelCount: number;
  bounds: Bounds;
  centroid: Point;
};
type Manifest = {
  format: string;
  version: number;
  map: { source: string; width: number; height: number };
  provinces: Province[];
  painted: { pixelCount: number; coverage: number; unregisteredColors: unknown[] };
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Pure byte parsing — no canvas, no image decode. A PNG is an 8-byte signature
// followed by chunks; the first chunk must be IHDR, whose payload starts with a
// big-endian width and height.
function readPngSize(bytes: Uint8Array): { width: number; height: number } {
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) {
      throw new Error("not a PNG: signature mismatch at byte " + index);
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkType = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunkType !== "IHDR") {
    throw new Error("first chunk is " + chunkType + ", expected IHDR");
  }
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readManifest(): Manifest {
  const raw = readFileSync(packageRoot + "assets/provinces_manifest.json", "utf8");
  return JSON.parse(raw) as Manifest;
}

function readAssetBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(packageRoot + "assets/" + name));
}

test("readPngSize rejects a non-PNG payload", () => {
  const notPng = new Uint8Array(32);
  assert.throws(() => {
    readPngSize(notPng);
  }, /signature mismatch/);
});

test("readPngSize reads a hand-built IHDR header", () => {
  const bytes = new Uint8Array(24);
  bytes.set(PNG_SIGNATURE, 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 7);
  view.setUint32(20, 11);

  assert.deepEqual(readPngSize(bytes), { width: 7, height: 11 });
});

test("readPngSize rejects a PNG whose first chunk is not IHDR", () => {
  const bytes = new Uint8Array(24);
  bytes.set(PNG_SIGNATURE, 0);
  bytes.set([0x73, 0x52, 0x47, 0x42], 12);

  assert.throws(() => {
    readPngSize(bytes);
  }, /expected IHDR/);
});

test("provinces_map.png is the authoritative 3653x2855 surface", () => {
  assert.deepEqual(readPngSize(readAssetBytes("provinces_map.png")), {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
  });
});

test("map.png is one pixel narrower and otherwise the same size", () => {
  // PLAN section 2: screen -> map pixel lookup is 1:1. The art layer is
  // letterboxed/stretched by exactly 1 px of width, nothing more.
  const art = readPngSize(readAssetBytes("map.png"));

  assert.equal(art.height, MAP_HEIGHT);
  assert.equal(MAP_WIDTH - art.width, 1);
});

test("the manifest declares the format and version the parser will demand", () => {
  const manifest = readManifest();

  assert.equal(manifest.format, "civitas.province-map");
  assert.equal(manifest.version, 1);
});

test("the manifest map size matches provinces_map.png exactly", () => {
  const manifest = readManifest();
  const bitmap = readPngSize(readAssetBytes("provinces_map.png"));

  assert.equal(manifest.map.width, bitmap.width);
  assert.equal(manifest.map.height, bitmap.height);
  assert.equal(manifest.map.width, MAP_WIDTH);
  assert.equal(manifest.map.height, MAP_HEIGHT);
});

test("the manifest holds 1648 provinces, all of kind land", () => {
  const manifest = readManifest();

  assert.equal(manifest.provinces.length, PROVINCE_COUNT);
  for (const province of manifest.provinces) {
    assert.equal(province.kind, "land", "province " + province.id + " is not land");
  }
});

test("province ids are unique but NOT contiguous — index by id, never by position", () => {
  // The trap for T02: ids run to 1650 while only 1648 provinces exist, so two
  // ids are missing. `provinces[id - 1]` returns the wrong province.
  const manifest = readManifest();
  const ids = new Set(manifest.provinces.map((province) => {
    return province.id;
  }));

  assert.equal(ids.size, PROVINCE_COUNT);
  const maxId = Math.max(...ids);
  assert.equal(maxId, 1650);
  assert.ok(maxId > PROVINCE_COUNT, "ids must not be assumed contiguous");
  assert.notEqual(manifest.provinces[PROVINCE_COUNT - 1].id, PROVINCE_COUNT);
});

test("province colours are unique — the lookup table cannot collide", () => {
  const manifest = readManifest();
  const packed = new Set<number>();

  for (const province of manifest.provinces) {
    const [red, green, blue] = province.rgb;
    packed.add((red << 16) | (green << 8) | blue);
  }
  assert.equal(packed.size, PROVINCE_COUNT);
});

test("every rgb triple agrees with its hex string", () => {
  const manifest = readManifest();

  for (const province of manifest.provinces) {
    assert.match(province.hex, /^#[0-9a-f]{6}$/, "bad hex on province " + province.id);
    const expected = [
      parseInt(province.hex.slice(1, 3), 16),
      parseInt(province.hex.slice(3, 5), 16),
      parseInt(province.hex.slice(5, 7), 16),
    ];
    assert.deepEqual(province.rgb, expected, "rgb/hex mismatch on province " + province.id);
  }
});

test("the sample province from the plan is byte-for-byte what the plan says", () => {
  const manifest = readManifest();
  const first = manifest.provinces[0];

  assert.deepEqual(first, {
    id: 1,
    name: "Province 1",
    kind: "land",
    hex: "#98d7ab",
    rgb: [152, 215, 171],
    pixelCount: 1152,
    bounds: { x: 577, y: 364, width: 37, height: 58 },
    centroid: { x: 598, y: 391 },
  });
});

test("every bounds box lies inside the map", () => {
  const manifest = readManifest();

  for (const province of manifest.provinces) {
    const { x, y, width, height } = province.bounds;
    assert.ok(x >= 0 && y >= 0, "negative origin on province " + province.id);
    assert.ok(width > 0 && height > 0, "empty box on province " + province.id);
    assert.ok(x + width <= MAP_WIDTH, "box overflows width on province " + province.id);
    assert.ok(y + height <= MAP_HEIGHT, "box overflows height on province " + province.id);
  }
});

test("every centroid is an integer pixel inside its own bounds", () => {
  const manifest = readManifest();

  for (const province of manifest.provinces) {
    const { x, y, width, height } = province.bounds;
    const centroid = province.centroid;
    assert.ok(Number.isInteger(centroid.x), "fractional centroid on province " + province.id);
    assert.ok(Number.isInteger(centroid.y), "fractional centroid on province " + province.id);
    assert.ok(
      centroid.x >= x && centroid.x < x + width,
      "centroid x outside bounds on province " + province.id,
    );
    assert.ok(
      centroid.y >= y && centroid.y < y + height,
      "centroid y outside bounds on province " + province.id,
    );
  }
});

test("the centroid is the centre of mass, not the centre of the bounding box", () => {
  // PLAN section 2 states this explicitly. It is the fact most likely to be
  // "simplified" away by a later agent that needs a label anchor. On the sample
  // province the bbox centre is (595, 392.5) while the centroid is (598, 391).
  const manifest = readManifest();
  let differing = 0;

  for (const province of manifest.provinces) {
    const { x, y, width, height } = province.bounds;
    const boxCentreX = x + (width - 1) / 2;
    const boxCentreY = y + (height - 1) / 2;
    if (Math.abs(province.centroid.x - boxCentreX) > 1) {
      differing += 1;
      continue;
    }
    if (Math.abs(province.centroid.y - boxCentreY) > 1) {
      differing += 1;
    }
  }

  assert.equal(differing, 1277);
  assert.ok(
    differing > PROVINCE_COUNT / 2,
    "most centroids must sit off the bbox centre; a bbox-centre manifest would score near 0",
  );
});

test("a province never claims more pixels than its bounding box can hold", () => {
  const manifest = readManifest();

  for (const province of manifest.provinces) {
    const area = province.bounds.width * province.bounds.height;
    assert.ok(
      province.pixelCount > 0 && province.pixelCount <= area,
      "pixelCount " + province.pixelCount + " exceeds box area " + area +
        " on province " + province.id,
    );
  }
});

test("the painted totals reconcile with the per-province counts", () => {
  const manifest = readManifest();
  const summed = manifest.provinces.reduce((total, province) => {
    return total + province.pixelCount;
  }, 0);

  assert.equal(summed, manifest.painted.pixelCount);
  assert.equal(summed, 2756578);
  assert.deepEqual(manifest.painted.unregisteredColors, []);
});

test("the declared coverage is the painted fraction of the map", () => {
  const manifest = readManifest();
  const area = manifest.map.width * manifest.map.height;

  assert.equal(area, 10429315);
  assert.ok(
    Math.abs(manifest.painted.pixelCount / area - manifest.painted.coverage) < 1e-6,
    "coverage " + manifest.painted.coverage + " does not match " +
      manifest.painted.pixelCount + " / " + area,
  );
});

test("all province names are the placeholder form, and all are distinct", () => {
  // PLAN section 2: names are placeholders and there is no country data. A later
  // agent must not read meaning into them.
  const manifest = readManifest();
  const names = new Set<string>();

  for (const province of manifest.provinces) {
    assert.equal(province.name, "Province " + province.id);
    names.add(province.name);
  }
  assert.equal(names.size, PROVINCE_COUNT);
  assert.equal(JSON.stringify(manifest).includes("\"country\""), false);
});
