import type { MapManifest, Province } from "./manifest";

// ---------------------------------------------------------------------------
// Byte order — read this before touching anything below.
//
// `ImageData.data` is a `Uint8ClampedArray` laid out R, G, B, A — one byte per
// channel, in that order, on every platform. That order comes from the ImageData
// spec, not from the machine, so reading the four bytes by index is
// endian-independent.
//
// A `Uint32Array` VIEW over the same buffer is NOT endian-independent. On a
// little-endian machine pixel 0 reads back as 0xAABBGGRR; on a big-endian one as
// 0xRRGGBBAA. `../civitas-map/src/map/colors.ts` probes the endianness at startup
// for exactly this reason, and `import-provinces.ts` there takes such a view.
//
// This module never takes a u32 view. Every pixel is assembled from its four
// bytes, so the packed layout is 0x00RRGGBB on every platform, with no probe and
// no branch. Alpha is not packed — it is consumed by the UNPAINTED test below.
// ---------------------------------------------------------------------------

// Valid packed colours occupy 0x000000..0xFFFFFF, so any value above that is free
// as a sentinel. It has to be a sentinel and not 0: no province in this map is
// black today, but nothing in the format forbids one, and a black province would
// otherwise be indistinguishable from bare canvas.
const UNPAINTED = 0xffffffff;

function packRgb(r: number, g: number, b: number): number {
  return (((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) >>> 0;
}

function unpackRgb(packed: number): [number, number, number] {
  return [(packed >>> 16) & 0xff, (packed >>> 8) & 0xff, packed & 0xff];
}

// Packs an RGBA byte buffer into one 0x00RRGGBB word per pixel.
//
// The alpha test is `!== 255`, not `=== 0`, on purpose. A canvas stores pixels
// premultiplied, so a partly transparent pixel cannot be read back at its
// original colour — `rgba(192, 64, 64, 200)` returns `193, 64, 64`. A province is
// identified by an exact colour, so a part-transparent pixel would invent a
// province that matches nothing. The shipped asset only ever holds alpha 0 or
// 255, so this branch never fires on the real file; it guards a re-exported one.
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

// `UNPAINTED` (0xffffffff) is outside the range `packRgb` can produce, so it can
// never collide with a key here. Do not add a guard for it.
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
  // 41.7 MB for the real map, alive for the app's lifetime.
  //
  // Do NOT transfer this buffer to a worker. A transfer detaches it and every
  // later `provinceAt` reads zeroes. Copy it, or send the worker its own decode.
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

  // Row-major: the address is `y * width + x`. A transposed `x * height + y`
  // still lands inside the array most of the time on a 3653-wide map and returns
  // a plausible wrong province, so the tests use a non-square grid.
  //
  // Fractional coordinates are FLOORED, not rounded. T03 hands over screen->map
  // floats, and pixel `n` covers `[n, n + 1)`. Rounding would shift the pick half
  // a pixel and pick the wrong province along every border.
  packedAt(x: number, y: number): number {
    const px = Math.floor(x);
    const py = Math.floor(y);
    // NaN fails every comparison, so a `px < 0 || px >= width` test alone lets it
    // through and `pixels[NaN]` returns `undefined` — a value this method's type
    // says it cannot return. A degenerate view transform in T03 (a zero scale,
    // say) produces exactly that coordinate.
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      return UNPAINTED;
    }
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) {
      return UNPAINTED;
    }
    return this.pixels[py * this.width + px];
  }

  // An opaque colour that is absent from the index returns `null` rather than
  // throwing. The manifest's `unregisteredColors` is empty today, so this cannot
  // fire on the real asset, but a hover handler must not crash if it ever does.
  provinceAt(x: number, y: number): number | null {
    const packed = this.packedAt(x, y);
    if (packed === UNPAINTED) {
      return null;
    }
    const id = this.colorIndex.get(packed);
    return id === undefined ? null : id;
  }
}

// A cheap self-check for the one failure mode nothing else catches: the browser
// colour-converting the bitmap on decode, which shifts every RGB and silently
// makes every lookup return `null`.
//
// A centroid is a centre of mass, so it is NOT guaranteed to lie inside its own
// province — measured, 14 of 1648 do not. This is therefore a ratio test, never
// an all-must-match test. A correct decode scores about 0.985 over the first 200
// provinces; a colour-converted one scores about 0.
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

// The only DOM-touching function in this module, and it stays inside a function
// body on purpose: `province-index.test.ts` imports this module in Node, where
// `document` does not exist.
function decodeProvincePixels(bitmap: ImageBitmap): Uint32Array {
  const width = bitmap.width;
  const height = bitmap.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  // `colorSpace: "srgb"` is already the default; passed explicitly so nobody
  // "helpfully" changes it. Bitmap-side decoding options belong at
  // `createImageBitmap` in `map-assets.ts`, not here.
  const ctx = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
  if (!ctx) {
    throw new Error("2d canvas context unavailable");
  }

  ctx.imageSmoothingEnabled = false;
  // Untransformed: a pixel-for-pixel copy.
  ctx.drawImage(bitmap, 0, 0);

  // `getImageData` would throw a SecurityError on a tainted canvas. It cannot
  // today — the assets are same-origin. It would start happening the moment
  // anyone moves them to a CDN without CORS headers.
  const data = ctx.getImageData(0, 0, width, height).data;
  const pixels = packPixels(data, width * height);

  // Release the ~42 MB backing store; the pixels are packed by now.
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
