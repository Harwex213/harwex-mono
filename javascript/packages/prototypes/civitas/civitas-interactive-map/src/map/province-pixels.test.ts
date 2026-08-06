import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { ProvinceIndex, UNPAINTED, buildColorIndex, packPixels } from "./province-index";
import { parseManifestText } from "./manifest";
import type { MapManifest } from "./manifest";

// The one thing no other test can prove: that the shipped `provinces_map.png`
// really does answer the province ids the app reports. Every other test in this
// package runs on a synthetic grid, so a swapped channel order or a transposed
// address could still agree with itself.
//
// The decoder below is test-only scaffolding, exactly like `readPngSize` in
// `src/assets.test.ts`. It uses `node:zlib` and nothing else — no dependency is
// added, and `src/map/province-index.ts` still knows nothing about PNG. The
// bytes it produces are fed through the SHIPPED `packPixels` ->
// `buildColorIndex` -> `ProvinceIndex.provinceAt` path, so this file tests the
// real code, not a copy of it.

const manifestPath = fileURLToPath(new URL("../../assets/provinces_manifest.json", import.meta.url));
const bitmapPath = fileURLToPath(new URL("../../assets/provinces_map.png", import.meta.url));

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

type DecodedPng = {
  width: number;
  height: number;
  data: Uint8Array;
};

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

// 8-bit RGBA, non-interlaced only. That is what the asset is (verified in
// `.plan/T02/DESIGN.md` section 0), and anything else must fail loudly rather
// than decode to plausible rubbish.
function decodePng(bytes: Uint8Array): DecodedPng {
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error("not a PNG");
    }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let seenHeader = false;
  const idat: Uint8Array[] = [];

  let offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const body = offset + 8;

    if (type === "IHDR") {
      width = view.getUint32(body);
      height = view.getUint32(body + 4);
      const depth = bytes[body + 8];
      const colorType = bytes[body + 9];
      const interlace = bytes[body + 12];
      if (depth !== 8 || colorType !== 6 || interlace !== 0) {
        throw new Error(
          "unsupported PNG: depth " + depth + ", colour type " + colorType + ", interlace " + interlace,
        );
      }
      seenHeader = true;
    }
    if (type === "IDAT") {
      idat.push(bytes.subarray(body, body + length));
    }
    if (type === "IEND") {
      break;
    }

    offset = body + length + 4;
  }

  if (!seenHeader) {
    throw new Error("PNG has no IHDR");
  }

  const raw = new Uint8Array(inflateSync(Buffer.concat(idat)));
  const stride = width * 4;
  const out = new Uint8Array(width * height * 4);

  let read = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[read];
    read += 1;
    const rowStart = y * stride;
    const priorStart = rowStart - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[read + x];
      const left = x >= 4 ? out[rowStart + x - 4] : 0;
      const up = y > 0 ? out[priorStart + x] : 0;
      const upLeft = x >= 4 && y > 0 ? out[priorStart + x - 4] : 0;
      let restored = value;
      if (filter === 1) {
        restored = value + left;
      } else if (filter === 2) {
        restored = value + up;
      } else if (filter === 3) {
        restored = value + ((left + up) >> 1);
      } else if (filter === 4) {
        restored = value + paeth(left, up, upLeft);
      } else if (filter !== 0) {
        throw new Error("unknown PNG row filter " + filter + " on row " + y);
      }
      out[rowStart + x] = restored & 0xff;
    }
    read += stride;
  }

  return { width, height, data: out };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(body, 8);
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
}

// Encodes an RGBA buffer with one chosen row filter, so the decoder above can be
// round-tripped against every filter type PNG allows. Without this the decoder
// is unproven, and a wrong probe result could be blamed on the wrong file.
function encodePng(width: number, height: number, data: Uint8Array, filter: number): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    const priorStart = rowStart - stride;
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? data[rowStart + x - 4] : 0;
      const up = y > 0 ? data[priorStart + x] : 0;
      const upLeft = x >= 4 && y > 0 ? data[priorStart + x - 4] : 0;
      let encoded = data[rowStart + x];
      if (filter === 1) {
        encoded = data[rowStart + x] - left;
      } else if (filter === 2) {
        encoded = data[rowStart + x] - up;
      } else if (filter === 3) {
        encoded = data[rowStart + x] - ((left + up) >> 1);
      } else if (filter === 4) {
        encoded = data[rowStart + x] - paeth(left, up, upLeft);
      }
      raw[y * (stride + 1) + 1 + x] = encoded & 0xff;
    }
  }

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;

  const parts = [
    new Uint8Array(PNG_SIGNATURE),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(Buffer.from(raw)))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => {
    return sum + part.length;
  }, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// The real decode costs ~40 MB and a second or so, so it happens once for the
// whole file rather than once per test.
type RealMap = {
  manifest: MapManifest;
  png: DecodedPng;
  index: ProvinceIndex;
};

let cached: RealMap | null = null;

function realMap(): RealMap {
  if (cached) {
    return cached;
  }
  const manifest = parseManifestText(readFileSync(manifestPath, "utf8"));
  const png = decodePng(new Uint8Array(readFileSync(bitmapPath)));
  const pixels = packPixels(png.data, png.width * png.height);
  const index = new ProvinceIndex(png.width, png.height, pixels, buildColorIndex(manifest.provinces));
  cached = { manifest, png, index };
  return cached;
}

test("the test PNG decoder round-trips every row filter", () => {
  // 3 x 2 and deliberately asymmetric, so a transposed or off-by-one decode is
  // visible. Alpha varies so the alpha column is not accidentally constant.
  const source = new Uint8Array([
    10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 0, //
    200, 1, 2, 255, 3, 4, 5, 255, 250, 249, 248, 128,
  ]);

  for (const filter of [0, 1, 2, 3, 4]) {
    const decoded = decodePng(encodePng(3, 2, source, filter));
    assert.equal(decoded.width, 3);
    assert.equal(decoded.height, 2);
    assert.deepEqual(Array.from(decoded.data), Array.from(source), "filter " + filter);
  }
});

test("the test PNG decoder rejects a payload that is not an 8-bit RGBA PNG", () => {
  assert.throws(() => {
    return decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  }, /not a PNG/);
});

test("provinces_map.png decodes to the 3653x2855 surface the manifest declares", () => {
  const { manifest, png } = realMap();

  assert.equal(png.width, 3653);
  assert.equal(png.height, 2855);
  assert.equal(png.width, manifest.map.width);
  assert.equal(png.height, manifest.map.height);
  assert.equal(png.data.length, 3653 * 2855 * 4);
});

test("every verified probe pixel resolves to its province through the shipped lookup", () => {
  const { index } = realMap();

  // Measured by decoding the asset, not guessed — `.plan/T02/DESIGN.md` section 0.
  const probes: [number, number, number | null][] = [
    [598, 391, 1],
    [1496, 395, 2],
    [1382, 1329, 1000],
    [1513, 2744, 1650],
    [0, 0, null],
    [3652, 2854, null],
  ];

  for (const probe of probes) {
    assert.equal(
      index.provinceAt(probe[0], probe[1]),
      probe[2],
      "provinceAt(" + probe[0] + ", " + probe[1] + ")",
    );
  }
});

test("a fractional probe coordinate lands in the same pixel as its floor", () => {
  const { index } = realMap();

  // T03 hands over screen->map floats. Rounding instead of flooring would move
  // this pick a whole pixel and land on the wrong province along every border.
  assert.equal(index.provinceAt(598.99, 391.99), 1);
  assert.equal(index.provinceAt(598, 391), 1);
});

test("the packed bitmap holds exactly the painted pixel count the manifest declares", () => {
  const { manifest, index } = realMap();

  let painted = 0;
  let maxPacked = 0;
  for (const packed of index.pixels) {
    if (packed === UNPAINTED) {
      continue;
    }
    painted += 1;
    if (packed > maxPacked) {
      maxPacked = packed;
    }
  }

  assert.equal(painted, 2756578);
  assert.equal(painted, manifest.painted.pixelCount);
  // A `Uint32Array` view over the RGBA bytes would carry alpha 255 in a fourth
  // byte and push every opaque value past 0xffffff on a little-endian host.
  assert.ok(maxPacked <= 0xffffff, "packed value " + maxPacked.toString(16) + " has a fourth byte");
});

test("the bitmap holds exactly the 1648 colours the manifest registers, and no others", () => {
  const { manifest, index } = realMap();

  const seen = new Set<number>();
  for (const packed of index.pixels) {
    if (packed !== UNPAINTED) {
      seen.add(packed);
    }
  }

  assert.equal(seen.size, 1648);
  assert.equal(seen.size, manifest.provinces.length);
  for (const packed of seen) {
    assert.ok(index.colorIndex.has(packed), "colour " + packed.toString(16) + " is in no province");
  }
  assert.deepEqual(manifest.painted.unregisteredColors, []);
});

test("sampleIntegrity on the real asset clears the 0.9 load threshold but is not 1", () => {
  const { manifest, index } = realMap();

  let matched = 0;
  for (const province of manifest.provinces) {
    if (index.provinceAt(province.centroid.x, province.centroid.y) === province.id) {
      matched += 1;
    }
  }

  // A centroid is a centre of mass, so a concave province can put it outside
  // itself. 14 of 1648 do. That is why `loadMapAssets` uses a ratio test at 0.9
  // and never an all-must-match test — and why this assertion is an exact count
  // rather than a bound: a colour-converted decode would score near zero, and a
  // manifest regenerated with bbox centres would move this number.
  assert.equal(matched, 1634);
  assert.ok(matched / manifest.provinces.length > 0.9);
  assert.notEqual(matched, manifest.provinces.length);
});
