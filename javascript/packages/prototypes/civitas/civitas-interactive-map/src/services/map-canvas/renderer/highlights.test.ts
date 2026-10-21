import assert from "node:assert/strict";
import test from "node:test";
import { buildHighlights } from "./highlights";
import type { Province } from "../../../domain/index";

function province(id: number): Province {
  return {
    id,
    name: "Province " + id,
    kind: "land",
    hex: "#000000",
    rgb: [0, 0, id],
    pixelCount: 1,
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    centroid: { x: 0, y: 0 },
  };
}

function lookup(id: number): Province | null {
  return id === 404 ? null : province(id);
}

test("hover goes first and select goes last", () => {
  const roles = buildHighlights(1, 2, lookup).map((request) => {
    return request.role + ":" + request.province.id;
  });
  assert.deepEqual(roles, ["hover:1", "select:2"]);
});

test("hover over the selected province draws only the selection", () => {
  const roles = buildHighlights(2, 2, lookup).map((request) => {
    return request.role;
  });
  assert.deepEqual(roles, ["select"]);
});

test("unknown ids and nulls draw nothing", () => {
  assert.deepEqual(buildHighlights(null, null, lookup), []);
  assert.deepEqual(buildHighlights(404, 404, lookup), []);
});
