import assert from "node:assert/strict";
import test from "node:test";
import { ProvinceIndex, UNPAINTED, buildColorIndex, packRgb } from "../map/province-index";
import { buildStampPixels } from "./highlight-layer";
import type { Province } from "../map/manifest";

// `buildStampPixels` is the only part of the highlight layer that is pure. The
// canvas wrapper around it needs a DOM, and PLAN section 4 forbids DOM tests, so
// section 9.6 of the design covers the rest in the browser.

const FILL: readonly [number, number, number, number] = [216, 162, 74, 112];

function province(id: number, rgb: [number, number, number], bounds: Province["bounds"]): Province {
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
    pixelCount: 0,
    bounds,
    centroid: { x: bounds.x, y: bounds.y },
  };
}

// A deliberately non-square grid: a transposed address lands inside the array on
// a square one and returns plausible rubbish.
function index(rows: number[][], provinces: readonly Province[]): ProvinceIndex {
  const height = rows.length;
  const width = rows[0].length;
  const pixels = new Uint32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = rows[y][x];
    }
  }
  return new ProvinceIndex(width, height, pixels, buildColorIndex(provinces));
}

test("the stamp paints the province's own pixels and nothing else", () => {
  const red = packRgb(200, 0, 0);
  const blue = packRgb(0, 0, 200);
  const target = province(1, [200, 0, 0], { x: 1, y: 0, width: 2, height: 3 });
  const neighbour = province(2, [0, 0, 200], { x: 0, y: 0, width: 1, height: 3 });

  // Province 1 is L-shaped inside its own bounding box, and province 2 shares the
  // box on one row. The blue pixel inside the box must stay transparent.
  const surface = index(
    [
      [blue, red, red],
      [blue, red, blue],
      [UNPAINTED, red, UNPAINTED],
    ],
    [target, neighbour],
  );

  const stamp = buildStampPixels(surface, target, FILL);
  assert.equal(stamp.length, 2 * 3 * 4, "four bytes per pixel of the bounding box");

  const alpha: number[] = [];
  for (let i = 3; i < stamp.length; i += 4) {
    alpha.push(stamp[i]);
  }
  // Bounding box is x 1..2, y 0..2, read row by row.
  assert.deepEqual(alpha, [112, 112, 112, 0, 112, 0]);

  // The painted pixels carry the requested colour, the rest are fully clear.
  assert.deepEqual(Array.from(stamp.slice(0, 4)), [216, 162, 74, 112]);
  assert.deepEqual(Array.from(stamp.slice(12, 16)), [0, 0, 0, 0]);
});

test("a province whose bounds fall outside the bitmap produces a clear stamp", () => {
  const red = packRgb(200, 0, 0);
  const target = province(1, [200, 0, 0], { x: 40, y: 40, width: 2, height: 2 });
  const surface = index(
    [
      [red, red, red],
      [red, red, red],
    ],
    [target],
  );

  const stamp = buildStampPixels(surface, target, FILL);
  assert.equal(stamp.length, 16);
  for (const byte of stamp) {
    assert.equal(byte, 0, "out-of-bounds reads must be UNPAINTED, never a match");
  }
});

test("a zero-sized bounding box produces an empty stamp instead of throwing", () => {
  const target = province(1, [200, 0, 0], { x: 0, y: 0, width: 0, height: 0 });
  const surface = index([[packRgb(200, 0, 0)]], [target]);

  assert.equal(buildStampPixels(surface, target, FILL).length, 0);
});
