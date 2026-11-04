import assert from "node:assert/strict";
import test from "node:test";
import {
  fit,
  screenToMap,
  zoomAround,
  zoomAt,
} from "./view";

test("fit centres the map at the largest scale inside the padding", () => {
  assert.deepEqual(fit({ width: 100, height: 50 }, { width: 248, height: 248 }), { scale: 2, x: 24, y: 74 });
});

test("zoomAt keeps the map point under the cursor in place", () => {
  const before = { scale: 1.5, x: 10, y: -20 };
  const after = zoomAt(before, 300, 200, 2);
  const anchorBefore = screenToMap(before, 300, 200);
  const anchorAfter = screenToMap(after, 300, 200);

  assert.equal(after.scale, 3);
  assert.ok(Math.abs(anchorBefore.x - anchorAfter.x) < 1e-9);
  assert.ok(Math.abs(anchorBefore.y - anchorAfter.y) < 1e-9);
});

test("zoomAround keeps the middle of the viewport in place", () => {
  const before = { scale: 1, x: 0, y: 0 };
  const after = zoomAround(before, { width: 200, height: 100 }, 1.25);

  assert.deepEqual(screenToMap(after, 100, 50), screenToMap(before, 100, 50));
});
