import assert from "node:assert/strict";
import test from "node:test";
import { FLAG_MAX_EDGE, PROVINCE_IMAGE_MAX_EDGE, dataUrlBytes, fitDownscale } from "./image";

// The pure halves only. `downscaleImage` needs `createImageBitmap` and a canvas,
// and PLAN section 4 rules out DOM tests, so the browser check in the T05 design
// is its gate.

test("fitDownscale never upscales", () => {
  assert.deepEqual(fitDownscale(100, 80, FLAG_MAX_EDGE), { width: 100, height: 80, scaled: false });
  assert.deepEqual(fitDownscale(256, 256, 256), { width: 256, height: 256, scaled: false });
});

test("the long edge is capped and the aspect ratio survives, in both orientations", () => {
  // The sample flag is 735 x 490.
  assert.deepEqual(fitDownscale(735, 490, 256), { width: 256, height: 171, scaled: true });
  assert.deepEqual(fitDownscale(490, 735, 256), { width: 171, height: 256, scaled: true });
});

test("a square image scales both edges equally", () => {
  assert.deepEqual(fitDownscale(1024, 1024, 320), { width: 320, height: 320, scaled: true });
});

test("an extreme strip keeps a width of at least one pixel", () => {
  // 4000 / 256 rounds the short edge to 0, and drawImage then throws.
  const fitted = fitDownscale(1, 4000, 256);

  assert.equal(fitted.width, 1);
  assert.equal(fitted.height, 256);
  assert.equal(fitted.scaled, true);
});

test("a dimension that is not a positive finite number yields a failure result", () => {
  const failure = { width: 0, height: 0, scaled: false };

  assert.deepEqual(fitDownscale(0, 100, 256), failure);
  assert.deepEqual(fitDownscale(100, -5, 256), failure);
  assert.deepEqual(fitDownscale(Number.NaN, 100, 256), failure);
  assert.deepEqual(fitDownscale(100, Number.POSITIVE_INFINITY, 256), failure);
  assert.deepEqual(fitDownscale(100, 100, 0), failure);
});

test("dataUrlBytes measures the decoded payload without decoding it", () => {
  // "AAAA" is 3 bytes, "AAA=" is 2, "AA==" is 1.
  assert.equal(dataUrlBytes("data:image/webp;base64,AAAA"), 3);
  assert.equal(dataUrlBytes("data:image/webp;base64,AAA="), 2);
  assert.equal(dataUrlBytes("data:image/webp;base64,AA=="), 1);

  assert.equal(dataUrlBytes("not a data url"), 0);
  assert.equal(dataUrlBytes("data:image/svg+xml,<svg/>"), 0);
  assert.equal(dataUrlBytes("data:image/webp;base64,"), 0);
});

test("a flag is stored large enough for the panel preview and no larger", () => {
  // T09 raised the cap from 256 to 384. The largest surface a flag is drawn on
  // is the 288 px panel preview, which 256 could not fill at any DPR. Lowering
  // the constant again visibly blurs that preview, so it is pinned.
  assert.equal(FLAG_MAX_EDGE, 384);
  assert.ok(FLAG_MAX_EDGE >= 288, "the preview box is 288 CSS px and must not upscale");

  // The sample flag, `assets/country-flag.jpg`, is 735 x 490.
  assert.deepEqual(fitDownscale(735, 490, FLAG_MAX_EDGE), {
    width: 384,
    height: 256,
    scaled: true,
  });
  // A wide flag keeps its shape: `fitDownscale` scales the LONG edge, so a 2:1
  // ensign is never squashed into the 3:2 preview box.
  const wide = fitDownscale(2000, 1000, FLAG_MAX_EDGE);
  assert.deepEqual(wide, { width: 384, height: 192, scaled: true });
  assert.equal(wide.width / wide.height, 2);
});

test("the province image cap is T10's and T09 left it where it was", () => {
  assert.equal(PROVINCE_IMAGE_MAX_EDGE, 320);
  assert.notEqual(PROVINCE_IMAGE_MAX_EDGE, FLAG_MAX_EDGE, "the two caps are decided separately");
});
