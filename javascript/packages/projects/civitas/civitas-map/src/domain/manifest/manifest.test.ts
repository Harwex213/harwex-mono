import assert from "node:assert/strict";
import test from "node:test";
import { buildMask } from "../brush/brush";
import { packOpaque } from "../colors/colors";
import { ProvinceLayer } from "../layer/province-layer";
import { buildManifest } from "./manifest";

test("the manifest measures each province from the pixels", () => {
  const layer = new ProvinceLayer(10, 10);
  const red = packOpaque({ r: 200, g: 10, b: 10 });
  const stray = packOpaque({ r: 1, g: 1, b: 1 });

  layer.beginStroke();
  layer.stamp(3, 3, buildMask(3, "square"), red);
  layer.stamp(9, 9, buildMask(1, "square"), stray);
  layer.endStroke();

  const manifest = buildManifest(layer, [
    { id: 1, name: "Red", kind: "land", color: red },
    { id: 2, name: "Empty", kind: "lake", color: packOpaque({ r: 5, g: 5, b: 5 }) },
  ], "map.png");

  assert.equal(manifest.format, "civitas.province-map");
  assert.deepEqual(manifest.map, { source: "map.png", width: 10, height: 10 });
  assert.deepEqual(manifest.provinces[0].bounds, { x: 2, y: 2, width: 3, height: 3 });
  assert.deepEqual(manifest.provinces[0].centroid, { x: 3, y: 3 });
  assert.equal(manifest.provinces[0].pixelCount, 9);
  assert.equal(manifest.provinces[1].pixelCount, 0);
  assert.deepEqual(manifest.painted, { pixelCount: 10, coverage: 0.1, unregisteredColors: ["#010101"] });
});
