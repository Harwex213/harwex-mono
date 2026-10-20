import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { ProvinceIndex } from "./province-index";
import {
  parseManifestText,
  type MapManifest,
  type Province,
} from "./manifest";

const UNPAINTED = ProvinceIndex.UNPAINTED;

const manifestPath = fileURLToPath(new URL("../../../assets/provinces_manifest.json", import.meta.url));

function makeProvince(id: number, rgb: [number, number, number], centroid = { x: 0, y: 0 }): Province {
  const hex =
    "#" +
    rgb
      .map((channel) => {
        return channel.toString(16).padStart(2, "0");
      })
      .join("");
  return {
    id,
    name: "Province " + id,
    kind: "land",
    hex,
    rgb,
    pixelCount: 1,
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    centroid,
  };
}

function pack(r: number, g: number, b: number): number {
  return ProvinceIndex.packColor([r, g, b]);
}

// Packs RGBA bytes through the real factory. No province is registered.
function packPixels(bytes: Uint8ClampedArray | Uint8Array, pixelCount: number): Uint32Array {
  return ProvinceIndex.fromRgba(pixelCount, 1, bytes, []).pixels;
}

// Non-square, so a transposed address gives a different answer.
//
//   row 0:  A  B  unpainted
//   row 1:  B  A  C            (C is opaque but absent from the colour index)
const COLOR_A = pack(10, 20, 30);
const COLOR_B = pack(40, 50, 60);
const COLOR_C = pack(70, 80, 90);
const ID_A = 5;
const ID_B = 9;

function makeGrid(): ProvinceIndex {
  const pixels = new Uint32Array([COLOR_A, COLOR_B, UNPAINTED, COLOR_B, COLOR_A, COLOR_C]);
  return ProvinceIndex.fromProvinces(3, 2, pixels, [
    makeProvince(ID_A, [10, 20, 30]),
    makeProvince(ID_B, [40, 50, 60]),
  ]);
}

test("packColor lays the channels out as 0x00RRGGBB", () => {
  assert.equal(pack(0, 0, 0), 0x000000);
  assert.equal(pack(255, 255, 255), 0xffffff);
  // Asymmetric on purpose: symmetric inputs cannot catch a swapped channel order.
  assert.equal(pack(1, 2, 3), 0x010203);
  assert.equal(pack(255, 0, 0), 0xff0000);
  assert.equal(pack(0, 255, 0), 0x00ff00);
  assert.equal(pack(0, 0, 255), 0x0000ff);
});

test("packColor agrees with the manifest's own hex notation", () => {
  // Tied to the real province 1, so the packing agrees with the format, not only with itself.
  const parsed = parseManifestText(readFileSync(manifestPath, "utf8"));
  const first = parsed.provinces[0];

  assert.equal(first.hex, "#98d7ab");
  assert.equal(ProvinceIndex.packColor(first.rgb), 0x98d7ab);
  assert.equal(
    ProvinceIndex.packColor(first.rgb),
    Number.parseInt(first.hex.slice(1), 16),
  );
});

test("fromRgba reads ImageData byte order and applies the alpha rule", () => {
  // Pins channel order, the alpha-0 rule and the partial-alpha rule together.
  const bytes = new Uint8ClampedArray([
    152, 215, 171, 255, //
    0, 0, 0, 0, //
    1, 2, 3, 255, //
    9, 9, 9, 128, //
  ]);
  const packed = packPixels(bytes, 4);

  assert.deepEqual(Array.from(packed), [0x98d7ab, UNPAINTED, 0x010203, UNPAINTED]);
});

test("fromRgba never takes a Uint32Array view, so alpha stays out of the high byte", () => {
  // A `Uint32Array` view would put alpha or red in the high byte, depending on the host.
  // Red is high here, so the two byte orders give different values.
  const bytes = new Uint8Array([200, 10, 20, 255, 0, 0, 0, 0, 1, 2, 3, 255]);
  const packed = packPixels(bytes, 3);

  assert.equal(packed[0], 0xc80a14);
  for (const value of packed) {
    if (value === UNPAINTED) {
      continue;
    }
    assert.ok(value <= 0xffffff, "packed value " + value.toString(16) + " carries a fourth byte");
  }
});

test("fromRgba rejects a buffer that is not four bytes per pixel", () => {
  const bytes = new Uint8ClampedArray(12);
  assert.throws(
    () => ProvinceIndex.fromRgba(2, 2, bytes, []),
    /pixel buffer is 12 bytes, expected 16 for 4 pixels/,
  );
  assert.throws(
    () => ProvinceIndex.fromRgba(2, 1, bytes, []),
    /pixel buffer is 12 bytes, expected 8 for 2 pixels/,
  );
});

test("fromProvinces maps a packed colour to its province id", () => {
  const pixels = new Uint32Array([pack(10, 20, 30), pack(40, 50, 60), pack(1, 1, 1)]);
  const index = ProvinceIndex.fromProvinces(3, 1, pixels, [
    makeProvince(5, [10, 20, 30]),
    makeProvince(9, [40, 50, 60]),
  ]);

  assert.equal(index.colorIndex.size, 2);
  assert.equal(index.provinceAt(0, 0), 5);
  assert.equal(index.provinceAt(1, 0), 9);
  assert.equal(index.provinceAt(2, 0), null);
});

test("fromProvinces throws on a shared colour and names both provinces", () => {
  assert.throws(
    () => {
      return ProvinceIndex.fromProvinces(0, 0, new Uint32Array(0), [
        makeProvince(5, [10, 20, 30]),
        makeProvince(9, [10, 20, 30]),
      ]);
    },
    /provinces 5 and 9 share colour #0a141e/,
  );
});

test("the colour index of the real manifest holds exactly 1648 entries", () => {
  const parsed = parseManifestText(readFileSync(manifestPath, "utf8"));
  const index = ProvinceIndex.fromProvinces(0, 0, new Uint32Array(0), parsed.provinces).colorIndex;

  assert.equal(index.size, 1648);
  // Asserted here instead of guarded in the source.
  assert.equal(index.get(UNPAINTED), undefined);
  for (const key of index.keys()) {
    assert.ok(key >= 0 && key <= 0xffffff, "key " + key + " is outside the packable range");
  }
});

test("provinceAt reads the grid row-major", () => {
  const grid = makeGrid();

  assert.equal(grid.provinceAt(0, 0), ID_A);
  assert.equal(grid.provinceAt(1, 0), ID_B);
  assert.equal(grid.provinceAt(0, 1), ID_B);
  // A transposed `x * height + y` returns ID_B here instead of ID_A.
  assert.equal(grid.provinceAt(1, 1), ID_A);
});

test("provinceAt returns null for unpainted and for an unregistered colour", () => {
  const grid = makeGrid();

  assert.equal(grid.provinceAt(2, 0), null);
  // Opaque, but its colour is in no province. A hover handler must not crash.
  assert.equal(grid.provinceAt(2, 1), null);
});

test("provinceAt returns null outside the grid", () => {
  const grid = makeGrid();

  assert.equal(grid.provinceAt(-1, 0), null);
  assert.equal(grid.provinceAt(0, -1), null);
  assert.equal(grid.provinceAt(3, 0), null);
  assert.equal(grid.provinceAt(0, 2), null);
  assert.equal(grid.packedAt(-1, 0), UNPAINTED);
  assert.equal(grid.packedAt(99, 99), UNPAINTED);
});

test("fractional coordinates are floored, not rounded", () => {
  const grid = makeGrid();

  assert.equal(grid.provinceAt(1.9, 0.9), grid.provinceAt(1, 0));
  // Math.round would push 0.6 into pixel 1 and pick the neighbouring province.
  assert.equal(grid.provinceAt(0.6, 0), ID_A);
  assert.notEqual(grid.provinceAt(0.6, 0), grid.provinceAt(1, 0));
});

test("ProvinceIndex rejects a bitmap of the wrong length", () => {
  assert.throws(
    () => {
      return ProvinceIndex.fromProvinces(3, 2, new Uint32Array(5), []);
    },
    /province bitmap is 5 pixels, expected 6 for 3x2/,
  );
});

test("sampleIntegrity is a ratio, because a centroid can miss its own province", () => {
  const grid = makeGrid();
  const provinces = [
    // Centroid (0, 0) lands on A, which is province 5. A hit.
    makeProvince(ID_A, [10, 20, 30], { x: 0, y: 0 }),
    // Centroid (1, 1) also lands on A, but this is province 9. A miss, like a concave province.
    makeProvince(ID_B, [40, 50, 60], { x: 1, y: 1 }),
  ];

  assert.deepEqual(grid.sampleIntegrity(provinces, 200), { checked: 2, matched: 1 });
  assert.deepEqual(grid.sampleIntegrity(provinces, 1), { checked: 1, matched: 1 });
  assert.deepEqual(grid.sampleIntegrity([], 200), { checked: 0, matched: 0 });
});

test("sampleIntegrity checks nothing when the sample size is zero or negative", () => {
  // `loadMapAssets` divides by `checked`, so an empty sample must report 0, not NaN.
  const grid = makeGrid();
  const provinces = [makeProvince(ID_A, [10, 20, 30], { x: 0, y: 0 })];

  assert.deepEqual(grid.sampleIntegrity(provinces, 0), { checked: 0, matched: 0 });
  assert.deepEqual(grid.sampleIntegrity(provinces, -5), { checked: 0, matched: 0 });
});

test("a black province is a legal colour, so UNPAINTED must stay outside the packable range", () => {
  // The format allows a black province. UNPAINTED = 0 would hide it as bare canvas.
  const black = makeProvince(3, [0, 0, 0]);
  const grid = ProvinceIndex.fromRgba(2, 1, new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]), [
    black,
    makeProvince(4, [255, 255, 255]),
  ]);

  assert.equal(pack(0, 0, 0), 0);
  assert.equal(grid.colorIndex.get(0), 3);

  assert.equal(grid.provinceAt(0, 0), 3, "an opaque black pixel is province 3, not empty canvas");
  assert.equal(grid.provinceAt(1, 0), null, "a transparent black pixel is empty canvas");
  assert.ok(UNPAINTED > 0xffffff, "the sentinel must sit above every packable colour");
  assert.equal(pack(255, 255, 255), 0xffffff);
  assert.notEqual(pack(255, 255, 255), UNPAINTED);
});

test("fromRgba treats every alpha below 255 as unpainted, not as opaque", () => {
  // Premultiplied alpha shifts a nearly-opaque colour. A `=== 0` test would accept 254.
  const bytes = new Uint8ClampedArray([
    152, 215, 171, 254, //
    152, 215, 171, 1, //
    152, 215, 171, 128, //
    152, 215, 171, 255, //
  ]);

  assert.deepEqual(Array.from(packPixels(bytes, 4)), [
    UNPAINTED,
    UNPAINTED,
    UNPAINTED,
    0x98d7ab,
  ]);
});

test("fromRgba accepts an empty buffer", () => {
  assert.equal(packPixels(new Uint8ClampedArray(0), 0).length, 0);
});

test("a NaN coordinate reads as unpainted rather than off the end of the array", () => {
  // NaN passes a bare range test, and `pixels[NaN]` is undefined.
  const grid = makeGrid();

  assert.equal(grid.packedAt(Number.NaN, 0), UNPAINTED);
  assert.equal(grid.packedAt(0, Number.NaN), UNPAINTED);
  assert.equal(grid.provinceAt(Number.NaN, Number.NaN), null);
  assert.equal(grid.packedAt(Number.POSITIVE_INFINITY, 0), UNPAINTED);
  assert.equal(grid.packedAt(Number.NEGATIVE_INFINITY, 0), UNPAINTED);
});

test("fromBitmap rejects a bitmap whose size disagrees with the manifest", () => {
  // The size check runs before the decode, so this test never reaches `document`.
  const manifest: MapManifest = {
    format: "civitas.province-map",
    version: 1,
    map: { source: "provinces_map.png", width: 3653, height: 2855 },
    provinces: [makeProvince(5, [10, 20, 30])],
    painted: { pixelCount: 1, coverage: 0, unregisteredColors: [] },
  };
  const bitmap = { width: 3652, height: 2855 } as unknown as ImageBitmap;

  assert.throws(
    () => {
      return ProvinceIndex.fromBitmap(bitmap, manifest);
    },
    /provinces_map\.png is 3652x2855, the manifest describes 3653x2855/,
  );
});
