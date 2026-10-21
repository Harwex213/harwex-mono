import type { MapManifest, Province } from "./manifest";

// Maps a pixel of `provinces_map.png` to a province id.
// Byte order: pixels are packed from the four RGBA bytes, never through a `Uint32Array`
// view, so the layout is 0x00RRGGBB on every platform without an endianness probe.

// Above the 24-bit colour range, so a black province stays distinct from bare canvas.
const UNPAINTED = 0xffffffff;

function packRgb(r: number, g: number, b: number): number {
  return (((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) >>> 0;
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

// The only DOM code here. It stays inside a function so tests can import the module in Node.
function decodeRgba(bitmap: ImageBitmap): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  // `srgb` is the default. It is explicit to pin it. Decode options live in `map-assets.ts`.
  const ctx = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
  if (!ctx) {
    throw new Error("2d canvas context unavailable");
  }

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0);

  // Throws on a tainted canvas. Assets must stay same-origin or carry CORS headers.
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;

  // Releases the ~42 MB backing store. `data` is a copy and stays valid.
  canvas.width = 0;
  canvas.height = 0;

  return data;
}

// Why: `provinces_map.png` is the authoritative pick surface.
// One decoded bitmap answers "which province is under this map pixel" for every consumer.
// - The PNG is decoded once into packed 0x00RRGGBB values in a Uint32Array.
// - Colour to id goes through a Map, because ids are not contiguous.
// - Lookups return null off the map and on unknown colours, so callers need no guards.
// - The constructor is private: every factory builds the colour index from the provinces,
//   so a duplicate colour always throws.
class ProvinceIndex {
  // What `packedAt` returns off the map and on a transparent pixel.
  static readonly UNPAINTED = UNPAINTED;

  readonly width: number;
  readonly height: number;
  // 41.7 MB, alive for the app's lifetime.
  // Never transfer this buffer to a worker: a transfer detaches it. Copy it instead.
  readonly pixels: Uint32Array;
  readonly colorIndex: ReadonlyMap<number, number>;

  private constructor(
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

  // The value `packedAt` returns for a pixel of this colour.
  static packColor(rgb: readonly [number, number, number]): number {
    return packRgb(rgb[0], rgb[1], rgb[2]);
  }

  // `pixels` holds packed colours, as `packColor` and `UNPAINTED` produce them.
  static fromProvinces(
    width: number,
    height: number,
    pixels: Uint32Array,
    provinces: readonly Province[],
  ): ProvinceIndex {
    return new ProvinceIndex(width, height, pixels, buildColorIndex(provinces));
  }

  // `bytes` is RGBA in ImageData order, four bytes per pixel.
  static fromRgba(
    width: number,
    height: number,
    bytes: Uint8ClampedArray | Uint8Array,
    provinces: readonly Province[],
  ): ProvinceIndex {
    return ProvinceIndex.fromProvinces(width, height, packPixels(bytes, width * height), provinces);
  }

  // Browser only: the decode draws the bitmap on a canvas.
  static fromBitmap(bitmap: ImageBitmap, manifest: MapManifest): ProvinceIndex {
    // Checked before the decode, so a mismatch fails without touching `document`.
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
    const rgba = decodeRgba(bitmap);
    return ProvinceIndex.fromRgba(bitmap.width, bitmap.height, rgba, manifest.provinces);
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

  // Detects a browser that colour-converts the bitmap on decode. Then every lookup returns `null`.
  // A ratio test: 14 of 1648 centroids lie outside their province. A correct decode
  // scores about 0.985 over 200 provinces, a converted one about 0.
  sampleIntegrity(
    provinces: readonly Province[],
    sampleSize: number,
  ): { checked: number; matched: number } {
    let checked = 0;
    let matched = 0;
    const limit = Math.min(sampleSize, provinces.length);

    for (let i = 0; i < limit; i += 1) {
      const province = provinces[i];
      checked += 1;
      if (this.provinceAt(province.centroid.x, province.centroid.y) === province.id) {
        matched += 1;
      }
    }

    return { checked, matched };
  }
}

export { ProvinceIndex };
