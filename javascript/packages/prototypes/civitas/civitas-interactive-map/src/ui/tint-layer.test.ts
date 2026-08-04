import assert from "node:assert/strict";
import test from "node:test";
import { ProvinceIndex, UNPAINTED, buildColorIndex, packRgb } from "../map/province-index";
import { TINT_ALPHA, buildTintPixels, diffTintWords, tintWordFor } from "./tint-layer";
import type { Province } from "../map/manifest";

// The pure half of the tint layer. The canvas wrapper needs a DOM, and PLAN
// section 4 forbids DOM tests, so the browser checklist in the design covers the
// rest.

function province(id: number, rgb: [number, number, number], bounds: Province["bounds"]): Province {
  return {
    id,
    name: "Province " + id,
    kind: "land",
    hex: "#000000",
    rgb,
    pixelCount: 0,
    bounds,
    centroid: { x: bounds.x, y: bounds.y },
  };
}

// A deliberately NON-SQUARE grid: a transposed address lands inside the array on
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

function wordsOf(entries: readonly (readonly [number, number])[], length: number): Uint32Array {
  const out = new Uint32Array(length);
  for (const [id, word] of entries) {
    out[id] = word;
  }
  return out;
}

test("tintWordFor packs alpha, red, green and blue into one unsigned word", () => {
  const word = tintWordFor("#c0563f", TINT_ALPHA);

  assert.equal((word >>> 16) & 0xff, 192, "red");
  assert.equal((word >>> 8) & 0xff, 86, "green");
  assert.equal(word & 0xff, 63, "blue");
  assert.equal((word >>> 24) & 0xff, 82, "alpha, 0.32 * 255 rounded");
  assert.ok(word > 0, "the word stays unsigned");
});

test("an alpha with the sign bit set still produces a positive word", () => {
  // Without the `>>> 0` an alpha of 128 or more makes the word NEGATIVE, and 0
  // stops being the unambiguous "no tint" value the whole layer keys on.
  for (const alpha of [0.5, 0.75, 1]) {
    const word = tintWordFor("#c0563f", alpha);
    assert.ok((word >>> 24) & 0x80, "alpha " + alpha + " must set the top bit");
    assert.ok(word > 0, "alpha " + alpha + " must still be positive");
  }
});

test("tintWordFor returns 0 — the no-tint word — for anything it cannot use", () => {
  assert.equal(tintWordFor("c0563f", TINT_ALPHA), 0, "no leading hash");
  assert.equal(tintWordFor("#xyz", TINT_ALPHA), 0, "not hex");
  assert.equal(tintWordFor("", TINT_ALPHA), 0, "empty");
  assert.equal(tintWordFor("#abc", TINT_ALPHA), 0, "the 3-digit form world-store rejects too");
  assert.equal(tintWordFor("#c0563f", 0), 0, "alpha 0");
  assert.equal(tintWordFor("#c0563f", -1), 0, "a negative alpha");
});

test("an alpha above 1 clamps to 255 and a tiny one still shows", () => {
  assert.equal((tintWordFor("#ffffff", 4) >>> 24) & 0xff, 255);
  assert.equal((tintWordFor("#ffffff", 0.0001) >>> 24) & 0xff, 1, "never rounds down to no-tint");
});

test("buildTintPixels writes R, G, B, A in that order for a tinted province", () => {
  const red = packRgb(200, 0, 0);
  const target = province(1, [200, 0, 0], { x: 0, y: 0, width: 1, height: 1 });
  const surface = index([[red], [UNPAINTED], [UNPAINTED]], [target]);

  const word = tintWordFor("#c0563f", TINT_ALPHA);
  const pixels = buildTintPixels(surface, target.bounds, () => {
    return word;
  });

  assert.deepEqual(Array.from(pixels), [192, 86, 63, 82], "B, G, R, A would read 63, 86, 192");
});

test("a bounding box paints a NEIGHBOUR in the neighbour's own colour", () => {
  // The test that pins the difference from `buildStampPixels`. Bounding boxes
  // overlap and `putImageData` REPLACES alpha, so a tile that left the
  // neighbour transparent would erase its tint whenever this province repaints.
  const red = packRgb(200, 0, 0);
  const blue = packRgb(0, 0, 200);
  const target = province(1, [200, 0, 0], { x: 0, y: 0, width: 2, height: 3 });
  const neighbour = province(2, [0, 0, 200], { x: 1, y: 0, width: 1, height: 3 });

  const surface = index(
    [
      [red, blue, UNPAINTED],
      [red, blue, UNPAINTED],
      [red, UNPAINTED, UNPAINTED],
    ],
    [target, neighbour],
  );

  const words = wordsOf(
    [
      [1, tintWordFor("#c0563f", TINT_ALPHA)],
      [2, tintWordFor("#4f7fb5", TINT_ALPHA)],
    ],
    3,
  );
  const pixels = buildTintPixels(surface, target.bounds, (id) => {
    return words[id];
  });

  // Row 0 of the box is province 1 then province 2.
  assert.deepEqual(Array.from(pixels.slice(0, 4)), [192, 86, 63, 82], "the target's colour");
  assert.deepEqual(
    Array.from(pixels.slice(4, 8)),
    [79, 127, 181, 82],
    "the neighbour keeps its OWN colour instead of going transparent",
  );
});

test("unpainted pixels and provinces with no tint stay fully clear", () => {
  const red = packRgb(200, 0, 0);
  const blue = packRgb(0, 0, 200);
  const target = province(1, [200, 0, 0], { x: 0, y: 0, width: 2, height: 2 });
  const neighbour = province(2, [0, 0, 200], { x: 1, y: 0, width: 1, height: 2 });

  const surface = index(
    [
      [red, blue, UNPAINTED],
      [UNPAINTED, blue, UNPAINTED],
    ],
    [target, neighbour],
  );

  // Only province 1 is assigned to a country; province 2 has no word, which is
  // how an unassignment erases.
  const words = wordsOf([[1, tintWordFor("#c0563f", TINT_ALPHA)]], 3);
  const pixels = buildTintPixels(surface, target.bounds, (id) => {
    return words[id];
  });

  const alpha: number[] = [];
  for (let at = 3; at < pixels.length; at += 4) {
    alpha.push(pixels[at]);
  }
  assert.deepEqual(alpha, [82, 0, 0, 0], "only the one tinted pixel carries alpha");
  assert.deepEqual(Array.from(pixels.slice(4, 8)), [0, 0, 0, 0], "an untinted neighbour is clear");
});

test("a zero-sized bounding box produces an empty tile instead of throwing", () => {
  const surface = index([[packRgb(200, 0, 0)]], [
    province(1, [200, 0, 0], { x: 0, y: 0, width: 1, height: 1 }),
  ]);

  assert.equal(
    buildTintPixels(surface, { x: 0, y: 0, width: 0, height: 0 }, () => {
      return 1;
    }).length,
    0,
  );
});

test("diffTintWords returns exactly the changed ids, ascending", () => {
  const painted = wordsOf(
    [
      [1, 111],
      [3, 333],
      [5, 555],
    ],
    6,
  );
  const wanted = wordsOf(
    [
      [1, 111],
      [3, 999],
      [4, 444],
    ],
    6,
  );

  assert.deepEqual(diffTintWords(painted, wanted), [3, 4, 5]);
  assert.deepEqual(diffTintWords(painted, painted), [], "nothing to do for identical inputs");
});

test("diffTintWords handles a wanted array longer than the painted one", () => {
  // The 0 -> 1651 growth when the manifest arrives. Iterating `painted.length`
  // would report no change at all and nothing would ever be drawn.
  const painted = new Uint32Array(1);
  const wanted = wordsOf([[3, 777]], 6);

  assert.deepEqual(diffTintWords(painted, wanted), [3]);
});

test("diffTintWords treats missing wanted entries as no tint", () => {
  const painted = wordsOf([[2, 222]], 6);
  const wanted = new Uint32Array(1);

  assert.deepEqual(diffTintWords(painted, wanted), [2], "the tint has to be cleared");
});

// `putImageData` REPLACES the destination rectangle, alpha included. This is
// that, in an array: the only way to prove in Node that one province's box does
// not erase its neighbour's tint.
function paste(
  surface: Uint8ClampedArray,
  surfaceWidth: number,
  tile: Uint8ClampedArray,
  bounds: Province["bounds"],
): void {
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const from = (y * bounds.width + x) * 4;
      const to = ((bounds.y + y) * surfaceWidth + (bounds.x + x)) * 4;
      surface[to] = tile[from];
      surface[to + 1] = tile[from + 1];
      surface[to + 2] = tile[from + 2];
      surface[to + 3] = tile[from + 3];
    }
  }
}

test("TINT_ALPHA sits between the T04 hover fill and the select fill", () => {
  // 0.22 hover, 0.44 select. A tint at or above the select alpha stops a
  // selected province reading as selected on top of its country.
  assert.equal(TINT_ALPHA, 0.32);
  assert.ok(TINT_ALPHA > 0.22, "a tint under the hover alpha would be invisible");
  assert.ok(TINT_ALPHA < 0.44, "a tint at the select alpha would swallow the selection");
});

test("tintWordFor accepts the uppercase hex an OS colour picker can produce", () => {
  const upper = tintWordFor("#C0563F", TINT_ALPHA);

  assert.notEqual(upper, 0, "the shape world-store admits, in upper case");
  assert.equal(upper, tintWordFor("#c0563f", TINT_ALPHA));
});

test("tintWordFor returns the no-tint word for a non-finite alpha", () => {
  assert.equal(tintWordFor("#c0563f", Number.NaN), 0);
  assert.equal(tintWordFor("#c0563f", Number.POSITIVE_INFINITY), 0, "not a silent 255");
});

test("buildTintPixels fills exactly width * height * 4 bytes", () => {
  const red = packRgb(200, 0, 0);
  const surface = index([[red, red], [red, red], [red, red]], [
    province(1, [200, 0, 0], { x: 0, y: 0, width: 2, height: 3 }),
  ]);

  const pixels = buildTintPixels(surface, { x: 0, y: 0, width: 2, height: 3 }, () => {
    return tintWordFor("#c0563f", TINT_ALPHA);
  });

  assert.equal(pixels.length, 2 * 3 * 4);
});

test("two overlapping boxes composite to the same surface in either order", () => {
  // The design's idempotence claim, stated as a test: a box repaint leaves its
  // rectangle globally correct, so repainting boxes in any order — which is what
  // `diffTintWords` hands `syncTintLayer` — converges on one answer.
  const red = packRgb(200, 0, 0);
  const blue = packRgb(0, 0, 200);
  const first = province(1, [200, 0, 0], { x: 0, y: 0, width: 2, height: 3 });
  const second = province(2, [0, 0, 200], { x: 1, y: 0, width: 2, height: 4 });

  const surface = index(
    [
      [red, blue, UNPAINTED],
      [red, blue, UNPAINTED],
      [red, blue, UNPAINTED],
      [UNPAINTED, blue, UNPAINTED],
    ],
    [first, second],
  );

  const wordOne = tintWordFor("#c0563f", TINT_ALPHA);
  const wordTwo = tintWordFor("#4f7fb5", TINT_ALPHA);
  const words = wordsOf(
    [
      [1, wordOne],
      [2, wordTwo],
    ],
    3,
  );
  const wordOf = (id: number): number => {
    return words[id];
  };

  function composite(order: readonly Province[]): Uint8ClampedArray {
    const canvas = new Uint8ClampedArray(3 * 4 * 4);
    for (const item of order) {
      paste(canvas, 3, buildTintPixels(surface, item.bounds, wordOf), item.bounds);
    }
    return canvas;
  }

  const forward = composite([first, second]);
  const backward = composite([second, first]);

  assert.deepEqual(Array.from(forward), Array.from(backward), "order cannot matter");
  // Column 0 row 0 is province 1, column 1 row 0 is province 2, column 2 is sea.
  assert.deepEqual(Array.from(forward.slice(0, 4)), [192, 86, 63, 82], "province 1 kept its tint");
  assert.deepEqual(
    Array.from(forward.slice(4, 8)),
    [79, 127, 181, 82],
    "province 2 was not erased by its neighbour's box",
  );
  assert.deepEqual(Array.from(forward.slice(8, 12)), [0, 0, 0, 0], "the sea stays clear");
});

test("a bounding box running past the edge of the map paints only what exists", () => {
  // `provinceAt` returns null outside the bitmap, so an out-of-range box has to
  // come back transparent instead of throwing or wrapping to the next row.
  const red = packRgb(200, 0, 0);
  const surface = index(
    [[red], [red]],
    [province(1, [200, 0, 0], { x: 0, y: 0, width: 1, height: 2 })],
  );

  const pixels = buildTintPixels(surface, { x: 0, y: 1, width: 2, height: 2 }, () => {
    return tintWordFor("#c0563f", TINT_ALPHA);
  });

  assert.equal(pixels.length, 2 * 2 * 4);
  assert.deepEqual(Array.from(pixels.slice(0, 4)), [192, 86, 63, 82], "the one real pixel");
  assert.deepEqual(
    Array.from(pixels.slice(4)),
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    "everything outside the bitmap stays transparent",
  );
});
