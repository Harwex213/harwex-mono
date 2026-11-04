import assert from "node:assert/strict";
import test from "node:test";
import { packOpaque } from "../colors/colors";
import { parseManifest } from "./parse-manifest";

function manifest(provinces: unknown[], map: unknown = { source: "m.png", width: 10, height: 8 }): string {
  return JSON.stringify({ format: "civitas.province-map", version: 1, map, provinces });
}

test("entries are read with their id, name, kind and colour", () => {
  const parsed = parseManifest(manifest([{ id: 4, name: "Four", kind: "sea", rgb: [1, 2, 3] }]), 10, 8);

  assert.deepEqual(parsed.records, [{ id: 4, name: "Four", kind: "sea", color: packOpaque({ r: 1, g: 2, b: 3 }) }]);
  assert.equal(parsed.source, "m.png");
  assert.equal(parsed.skipped, 0);
});

test("a manifest for another map size is refused", () => {
  assert.throws(() => {
    parseManifest(manifest([]), 11, 8);
  }, /describes a 10×8 map, this one is 11×8/);
});

test("entries without a colour or with a taken colour are skipped", () => {
  const parsed = parseManifest(manifest([
    { id: 1, hex: "#010203" },
    { id: 2, rgb: [1, 2, 3] },
    { id: 3 },
    "junk",
  ]), 10, 8);

  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.skipped, 3);
});

test("repeated and missing ids are renumbered, unknown kinds become land", () => {
  const parsed = parseManifest(manifest([
    { id: 2, hex: "#000001", kind: "volcano" },
    { id: 2, hex: "#000002" },
    { hex: "#000003", name: "" },
  ]), 10, 8);

  assert.deepEqual(parsed.records.map((record) => record.id), [2, 1, 3]);
  assert.equal(parsed.records[0].kind, "land");
  assert.equal(parsed.records[2].name, "Province 3");
});

test("text that is not a JSON object with a provinces list is refused", () => {
  assert.throws(() => {
    parseManifest("{", 1, 1);
  }, /not valid JSON/);
  assert.throws(() => {
    parseManifest("{}", 1, 1);
  }, /no `provinces` array/);
});
