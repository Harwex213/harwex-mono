import assert from "node:assert/strict";
import test from "node:test";
import { buildMask } from "../brush/brush";
import { ProvinceLayer } from "./province-layer";

const RED = 0xff0000ff;
const BLUE = 0xffff0000;

function painted(layer: ProvinceLayer, value: number): number {
  let count = 0;
  for (const pixel of layer.readPixels()) {
    if (pixel === value) {
      count += 1;
    }
  }
  return count;
}

test("a stroke is one undo step, and undo then redo restores it", () => {
  const layer = new ProvinceLayer(20, 10);
  const mask = buildMask(1, "square");

  layer.beginStroke();
  layer.stamp(2, 2, mask, RED);
  layer.strokeSegment(2, 2, 9, 2, mask, RED);
  assert.equal(layer.endStroke(), true);
  assert.equal(painted(layer, RED), 8);
  assert.equal(layer.canUndo, true);

  assert.equal(layer.undo(), true);
  assert.equal(painted(layer, RED), 0);
  assert.equal(layer.canRedo, true);

  assert.equal(layer.redo(), true);
  assert.equal(painted(layer, RED), 8);
});

test("a stroke that writes nothing new leaves no undo step", () => {
  const layer = new ProvinceLayer(4, 4);

  layer.beginStroke();
  assert.equal(layer.endStroke(), false);
  assert.equal(layer.canUndo, false);
});

test("flood fill stops at a painted outline", () => {
  const layer = new ProvinceLayer(7, 7);
  const dot = buildMask(1, "square");

  // A ring from (1,1) to (5,5).
  layer.beginStroke();
  for (let i = 1; i <= 5; i += 1) {
    layer.stamp(i, 1, dot, RED);
    layer.stamp(i, 5, dot, RED);
    layer.stamp(1, i, dot, RED);
    layer.stamp(5, i, dot, RED);
  }
  layer.endStroke();

  layer.beginStroke();
  assert.equal(layer.floodFill(3, 3, BLUE), true);
  layer.endStroke();

  assert.equal(painted(layer, BLUE), 9);
  assert.equal(layer.pixelAt(0, 0), 0);
});

test("replaceColor rewrites every pixel of one colour", () => {
  const layer = new ProvinceLayer(5, 5);

  layer.beginStroke();
  layer.stamp(2, 2, buildMask(3, "square"), RED);
  layer.endStroke();

  layer.beginStroke();
  assert.equal(layer.replaceColor(RED, BLUE), true);
  layer.endStroke();
  assert.equal(painted(layer, RED), 0);
  assert.equal(painted(layer, BLUE), 9);
});

test("takeDirty returns the union of the writes once, then nothing", () => {
  const layer = new ProvinceLayer(30, 30);
  const dot = buildMask(1, "square");

  layer.beginStroke();
  layer.stamp(3, 4, dot, RED);
  layer.stamp(10, 20, dot, RED);
  layer.endStroke();

  assert.deepEqual(layer.takeDirty(), { x: 3, y: 4, w: 8, h: 17 });
  assert.equal(layer.takeDirty(), null);
});

test("clear, loadPixels and undo mark what they changed as dirty", () => {
  const layer = new ProvinceLayer(4, 3);

  layer.clear();
  assert.deepEqual(layer.takeDirty(), { x: 0, y: 0, w: 4, h: 3 });

  layer.loadPixels(new Uint32Array(12).fill(RED));
  assert.deepEqual(layer.takeDirty(), { x: 0, y: 0, w: 4, h: 3 });
  assert.equal(layer.canUndo, false, "loading a document is not an edit");

  layer.beginStroke();
  layer.stamp(0, 0, buildMask(1, "square"), BLUE);
  layer.endStroke();
  layer.takeDirty();
  layer.undo();
  assert.notEqual(layer.takeDirty(), null);
});

test("loadPixels refuses pixels of another size", () => {
  const layer = new ProvinceLayer(4, 3);

  assert.throws(() => {
    layer.loadPixels(new Uint32Array(11));
  }, /holds 11 pixels, the layer holds 12/);
});

test("readRect copies a rectangle row by row", () => {
  const layer = new ProvinceLayer(4, 3);

  layer.beginStroke();
  layer.stamp(1, 1, buildMask(1, "square"), RED);
  layer.endStroke();

  assert.deepEqual([...layer.readRect({ x: 0, y: 1, w: 3, h: 1 })], [0, RED, 0]);
});
