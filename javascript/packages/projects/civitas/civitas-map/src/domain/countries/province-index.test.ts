import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProvinceIndex,
  paintSlots,
  provinceAtPixel,
  unionRect,
} from "./province-index";

// 4 x 3 pixels: province 10 (colour 5) on the left, province 20 (colour 6) on
// the right, an unregistered colour 7 and an unpainted pixel at the bottom.
const PIXELS = Uint32Array.from([
  5, 5, 6, 6,
  5, 5, 6, 6,
  0, 7, 6, 6,
]);
const PROVINCES = [{ id: 10, color: 5 }, { id: 20, color: 6 }];

test("the index maps each pixel to its province and measures each province", () => {
  const index = buildProvinceIndex(PIXELS, 4, 3, PROVINCES);

  assert.deepEqual([...index.slots], [1, 1, 2, 2, 1, 1, 2, 2, 0, 0, 2, 2]);
  assert.deepEqual(index.provinceIds, [0, 10, 20]);
  assert.deepEqual(index.bounds[1], { x: 0, y: 0, w: 2, h: 2 });
  assert.deepEqual(index.bounds[2], { x: 2, y: 0, w: 2, h: 3 });
  assert.equal(provinceAtPixel(index, 1, 1), 10);
  assert.equal(provinceAtPixel(index, 1, 2), null);
  assert.equal(provinceAtPixel(index, 4, 0), null);
});

test("paintSlots writes the fill inside a province and the edge next to another slot", () => {
  const index = buildProvinceIndex(PIXELS, 4, 3, PROVINCES);
  const fill = Uint32Array.from([0, 100, 200]);
  const edge = Uint32Array.from([0, 101, 201]);
  const out = new Uint32Array(12);

  paintSlots(index, fill, edge, out, { x: 0, y: 0, w: 4, h: 3 });

  assert.deepEqual([...out], [
    100, 101, 201, 200,
    101, 101, 201, 200,
    0, 0, 201, 200,
  ]);
});

test("paintSlots leaves pixels outside the rectangle alone", () => {
  const index = buildProvinceIndex(PIXELS, 4, 3, PROVINCES);
  const out = new Uint32Array(12).fill(9);

  paintSlots(index, Uint32Array.from([0, 1, 2]), Uint32Array.from([0, 1, 2]), out, { x: 2, y: 0, w: 2, h: 1 });

  assert.deepEqual([...out], [9, 9, 2, 2, 9, 9, 9, 9, 9, 9, 9, 9]);
});

test("unionRect covers both rectangles and ignores an empty one", () => {
  assert.deepEqual(unionRect(null, { x: 1, y: 2, w: 3, h: 4 }), { x: 1, y: 2, w: 3, h: 4 });
  assert.deepEqual(unionRect({ x: 1, y: 2, w: 3, h: 4 }, { x: 0, y: 5, w: 2, h: 2 }), { x: 0, y: 2, w: 4, h: 5 });
  assert.equal(unionRect(null, { x: 0, y: 0, w: 0, h: 0 }), null);
});
