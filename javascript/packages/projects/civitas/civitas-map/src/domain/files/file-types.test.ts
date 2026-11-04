import assert from "node:assert/strict";
import test from "node:test";
import {
  baseName,
  isJsonFile,
  isMapImageFile,
  isPngFile,
} from "./file-types";

test("a map image is recognised by its type, or by its extension when the type is empty", () => {
  assert.equal(isMapImageFile({ name: "x", type: "image/webp" }), true);
  assert.equal(isMapImageFile({ name: "x.JPEG", type: "" }), true);
  assert.equal(isMapImageFile({ name: "x.gif", type: "image/gif" }), false);
});

test("the two halves of an export are told apart", () => {
  assert.equal(isPngFile({ name: "a.png", type: "" }), true);
  assert.equal(isJsonFile({ name: "a.json", type: "" }), true);
  assert.equal(isJsonFile({ name: "a.png", type: "image/png" }), false);
});

test("baseName drops one extension and never returns an empty name", () => {
  assert.equal(baseName("map.v2.png"), "map.v2");
  assert.equal(baseName(".png"), "map");
});
