import assert from "node:assert/strict";
import test from "node:test";
import { packOpaque } from "../colors/colors";
import {
  adoptStrayColors,
  createProvince,
  detectionNotice,
  importNotice,
  nextIdAfter,
  takenColors,
  withHex,
} from "./provinces";

test("a new province never takes a colour already in use", () => {
  const first = createProvince(1, new Set());
  const second = createProvince(1, takenColors([first]));

  assert.notEqual(first.color, second.color);
  assert.equal(first.name, "Province 1");
  assert.equal(first.kind, "land");
  assert.match(first.hex, /^#[0-9a-f]{6}$/);
});

test("stray colours become provinces numbered after the highest id", () => {
  const listed = [withHex({ id: 7, name: "Seven", kind: "sea", color: packOpaque({ r: 1, g: 2, b: 3 }) })];
  const stray = packOpaque({ r: 9, g: 9, b: 9 });
  const next = adoptStrayColors(listed, [listed[0].color, stray]);

  assert.equal(next.length, 2);
  assert.deepEqual(next[1], { id: 8, name: "Province 8", kind: "land", color: stray, hex: "#090909" });
  assert.equal(nextIdAfter(next), 9);
  assert.equal(adoptStrayColors(listed, [listed[0].color]), listed);
});

test("the import notice names what happened and nothing more", () => {
  const plain = { listed: 3, adopted: 0, skipped: 0, dropped: 0, manifestSource: "a.png", mapName: "a.png" };

  assert.equal(importNotice(plain), "Loaded 3 provinces from the manifest.");
  assert.equal(
    importNotice({ ...plain, listed: 1, adopted: 1, skipped: 1, dropped: 5, manifestSource: "b.png" }),
    "Loaded 1 province from the manifest, 1 unlisted colour adopted, 1 unusable entry skipped, " +
      "5 part-transparent pixels dropped, manifest was exported from \"b.png\".",
  );
  assert.equal(
    importNotice({ ...plain, listed: 0, adopted: 2, skipped: null, dropped: null, manifestSource: null }),
    "Loaded 0 provinces from the manifest, 2 unlisted colours adopted.",
  );
});

test("the detection notice reports bodies, ignored regions and areas", () => {
  const stats = {
    bodies: 3,
    keptBodies: 2,
    edgeBodies: 1,
    discardedSpecks: 0,
    riverPixels: 0,
    enclosedWaterPixels: 0,
    unassignedInsideLand: 0,
    largestArea: 8747,
    medianArea: 7789,
  };

  assert.equal(
    detectionNotice(5, stats),
    "Detected 5 land provinces across 2 landmasses, 1 region touching the frame ignored, largest 8,747 px, median 7,789 px.",
  );
});
