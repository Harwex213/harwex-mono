import type { MapManifest, Province } from "./manifest";

// Maps a pixel of `provinces_map.png` to a province id.
// Byte order: pixels are packed from the four RGBA bytes, never through a `Uint32Array`
// view, so the layout is 0x00RRGGBB on every platform without an endianness probe.

// Above the 24-bit colour range, so a black province stays distinct from bare canvas.
const UNPAINTED = 0xffffffff;

function packRgb(r: number, g: number, b: number): number {
  return (((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) >>> 0;
}

function unpackRgb(packed: number): [number, number, number] {
  return [(packed >>> 16) & 0xff, (packed >>> 8) & 0xff, packed & 0xff];
}

// Any alpha below 255 counts as unpainted. A canvas premultiplies alpha, so a
// part-transparent pixel reads back with a shifted colour that matches no province.
function packPixels(bytes: Uint8ClampedArray | Uint8Array, pixelCount: number): Uint32Array {
  const expected = pixelCount * 4;
  if (bytes.length !== expected) {
    throw new Error(
      "pixel buffer is " +
        bytes.length +
        " bytes, expected " +
        expected +
        " for " +
        pixelCount +
        " pixels",
    );
  }

  const out = new Uint32Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const base = i * 4;
    if (bytes[base + 3] !== 255) {
      out[i] = UNPAINTED;
      continue;
    }
    out[i] = ((bytes[base] << 16) | (bytes[base + 1] << 8) | bytes[base + 2]) >>> 0;
  }
  return out;
}

// `UNPAINTED` is outside the `packRgb` range and cannot collide with a key.
function buildColorIndex(provinces: readonly Province[]): Map<number, number> {
  const index = new Map<number, number>();
  for (const province of provinces) {
    const packed = packRgb(province.rgb[0], province.rgb[1], province.rgb[2]);
    const existing = index.get(packed);
    if (existing !== undefined) {
      throw new Error(
        "provinces " +
          existing +
          " and " +
          province.id +
          " share colour " +
          province.hex +
          " — the pixel lookup would be ambiguous",
      );
    }
    index.set(packed, province.id);
  }
  return index;
}

class ProvinceIndex {
  readonly width: number;
  readonly height: number;
  // 41.7 MB, alive for the app's lifetime.
  // Never transfer this buffer to a worker: a transfer detaches it. Copy it instead.
  readonly pixels: Uint32Array;
  readonly colorIndex: ReadonlyMap<number, number>;

  constructor(
    width: number,
    height: number,
    pixels: Uint32Array,
    colorIndex: ReadonlyMap<number, number>,
  ) {
    if (pixels.length !== width * height) {
      throw new Error(
        "province bitmap is " +
          pixels.length +
          " pixels, expected " +
          width * height +
          " for " +
          width +
          "x" +
          height,
      );
    }
    this.width = width;
    this.height = height;
    this.pixels = pixels;
    this.colorIndex = colorIndex;
  }

  // Row-major. Fractional coordinates are floored: pixel `n` covers `[n, n + 1)`.
  // Rounding would shift the pick half a pixel along every border.
  packedAt(x: number, y: number): number {
    const px = Math.floor(x);
    const py = Math.floor(y);
    // NaN passes the range test below, and a degenerate view transform can produce it.
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      return UNPAINTED;
    }
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) {
      return UNPAINTED;
    }
    return this.pixels[py * this.width + px];
  }

  // An unknown opaque colour returns `null`, not a throw, so a hover handler cannot crash.
  provinceAt(x: number, y: number): number | null {
    const packed = this.packedAt(x, y);
    if (packed === UNPAINTED) {
      return null;
    }
    const id = this.colorIndex.get(packed);
    return id === undefined ? null : id;
  }
}

// Detects a browser that colour-converts the bitmap on decode. Then every lookup returns `null`.
// A ratio test: 14 of 1648 centroids lie outside their province. A correct decode
// scores about 0.985 over 200 provinces, a converted one about 0.
function sampleIntegrity(
  index: ProvinceIndex,
  provinces: readonly Province[],
  sampleSize: number,
): { checked: number; matched: number } {
  let checked = 0;
  let matched = 0;
  const limit = Math.min(sampleSize, provinces.length);

  for (let i = 0; i < limit; i += 1) {
    const province = provinces[i];
    checked += 1;
    if (index.provinceAt(province.centroid.x, province.centroid.y) === province.id) {
      matched += 1;
    }
  }

  return { checked, matched };
}

// The only DOM code here. It stays inside a function so tests can import the module in Node.
function decodeProvincePixels(bitmap: ImageBitmap): Uint32Array {
  const width = bitmap.width;
  const height = bitmap.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  // `srgb` is the default. It is explicit to pin it. Decode options live in `map-assets.ts`.
  const ctx = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
  if (!ctx) {
    throw new Error("2d canvas context unavailable");
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0);

  // Throws on a tainted canvas. Assets must stay same-origin or carry CORS headers.
  const data = ctx.getImageData(0, 0, width, height).data;
  const pixels = packPixels(data, width * height);

  // Releases the ~42 MB backing store.
  canvas.width = 0;
  canvas.height = 0;

  return pixels;
}

function createProvinceIndex(bitmap: ImageBitmap, manifest: MapManifest): ProvinceIndex {
  if (bitmap.width !== manifest.map.width || bitmap.height !== manifest.map.height) {
    throw new Error(
      "provinces_map.png is " +
        bitmap.width +
        "x" +
        bitmap.height +
        ", the manifest describes " +
        manifest.map.width +
        "x" +
        manifest.map.height,
    );
  }

  const pixels = decodeProvincePixels(bitmap);
  const colorIndex = buildColorIndex(manifest.provinces);

  return new ProvinceIndex(manifest.map.width, manifest.map.height, pixels, colorIndex);
}

export {
  ProvinceIndex,
  UNPAINTED,
  buildColorIndex,
  createProvinceIndex,
  decodeProvincePixels,
  packPixels,
  packRgb,
  sampleIntegrity,
  unpackRgb,
};
