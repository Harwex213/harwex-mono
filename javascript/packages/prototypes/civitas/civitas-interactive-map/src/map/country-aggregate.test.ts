import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCountry, unionBounds } from "./country-aggregate";
import { indexProvincesById, parseManifestText } from "./manifest";
import type { Bounds, Point, Province } from "./manifest";

// Pure maths against a fake lookup. The manifest never loads in Node, which is
// exactly why `aggregateCountry` takes a lookup rather than reading a store.

function province(
  id: number,
  pixelCount: number,
  centroid: Point,
  bounds: Bounds,
): Province {
  return {
    id,
    name: "Province " + id,
    kind: "land",
    hex: "#000000",
    rgb: [0, 0, 0],
    pixelCount,
    bounds,
    centroid,
  };
}

function lookupOf(provinces: readonly Province[]): (id: number) => Province | null {
  const byId = new Map<number, Province>();
  for (const item of provinces) {
    byId.set(item.id, item);
  }
  return (id: number) => {
    return byId.get(id) ?? null;
  };
}

test("a single province gives its own centroid, bounds and pixel count", () => {
  const only = province(1, 500, { x: 12.5, y: 34.5 }, { x: 10, y: 30, width: 6, height: 9 });
  const aggregate = aggregateCountry(7, [1], lookupOf([only]));

  assert.equal(aggregate.countryId, 7);
  assert.equal(aggregate.provinceCount, 1);
  assert.equal(aggregate.resolvedCount, 1);
  assert.equal(aggregate.pixelCount, 500);
  assert.deepEqual(aggregate.bounds, { x: 10, y: 30, width: 6, height: 9 });
  assert.deepEqual(aggregate.centroid, { x: 12.5, y: 34.5 });
});

test("the centroid is AREA-WEIGHTED, not a plain mean of the centroids", () => {
  // The test that catches the likeliest wrong implementation: a plain mean puts
  // this at x = 50 and looks plausible everywhere else.
  const small = province(1, 1000, { x: 0, y: 0 }, { x: 0, y: 0, width: 2, height: 2 });
  const large = province(2, 9000, { x: 100, y: 0 }, { x: 99, y: 0, width: 4, height: 4 });

  const aggregate = aggregateCountry(1, [1, 2], lookupOf([small, large]));

  assert.equal(aggregate.centroid?.x, 90, "1000 at x=0 and 9000 at x=100 weigh out at 90");
  assert.equal(aggregate.centroid?.y, 0);
  assert.equal(aggregate.pixelCount, 10000);
});

test("the union bounds span both provinces, in either order", () => {
  const first = province(1, 1, { x: 0, y: 0 }, { x: 100, y: 100, width: 10, height: 10 });
  // Entirely above and to the left of the first.
  const second = province(2, 1, { x: 0, y: 0 }, { x: 20, y: 30, width: 5, height: 5 });

  const forward = aggregateCountry(1, [1, 2], lookupOf([first, second]));
  const backward = aggregateCountry(1, [2, 1], lookupOf([first, second]));

  assert.deepEqual(forward.bounds, { x: 20, y: 30, width: 90, height: 80 });
  assert.deepEqual(backward.bounds, forward.bounds);
});

test("unionBounds keeps the far edge, not the wider width", () => {
  // `max(width)` instead of `max(x + width) - x` gives width 4 here and loses
  // everything the second box adds beyond the first.
  const merged = unionBounds(
    { x: 0, y: 0, width: 4, height: 4 },
    { x: 10, y: 0, width: 2, height: 1 },
  );
  assert.deepEqual(merged, { x: 0, y: 0, width: 12, height: 4 });
});

test("an empty country has no bounds and no centroid", () => {
  const aggregate = aggregateCountry(3, [], lookupOf([]));

  assert.equal(aggregate.provinceCount, 0);
  assert.equal(aggregate.resolvedCount, 0);
  assert.equal(aggregate.pixelCount, 0);
  assert.equal(aggregate.bounds, null, "T07 skips it rather than drawing a label at (0, 0)");
  assert.equal(aggregate.centroid, null);
});

test("ids the lookup cannot resolve are skipped, never thrown on", () => {
  // 1318 and 1458 are absent from the real manifest, and a stored document can
  // carry anything at all.
  const aggregate = aggregateCountry(1, [1318, 1458, 99999], lookupOf([]));

  assert.equal(aggregate.provinceCount, 3, "the user assigned three ids");
  assert.equal(aggregate.resolvedCount, 0, "none of them exist");
  assert.equal(aggregate.bounds, null);
  assert.equal(aggregate.centroid, null);
  assert.equal(aggregate.pixelCount, 0);
});

test("a mix of real and phantom ids aggregates only the real ones", () => {
  const real = province(5, 200, { x: 10, y: 20 }, { x: 8, y: 18, width: 4, height: 4 });
  const aggregate = aggregateCountry(1, [5, 1318], lookupOf([real]));

  assert.equal(aggregate.provinceCount, 2);
  assert.equal(aggregate.resolvedCount, 1);
  assert.notEqual(aggregate.provinceCount, aggregate.resolvedCount);
  assert.deepEqual(aggregate.centroid, { x: 10, y: 20 });
  assert.equal(aggregate.pixelCount, 200);
});

test("an all-zero pixelCount falls back to the unweighted mean instead of NaN", () => {
  const a = province(1, 0, { x: 0, y: 0 }, { x: 0, y: 0, width: 1, height: 1 });
  const b = province(2, 0, { x: 10, y: 20 }, { x: 10, y: 20, width: 1, height: 1 });

  const aggregate = aggregateCountry(1, [1, 2], lookupOf([a, b]));

  assert.ok(aggregate.centroid, "a resolvable country always gets a centroid");
  assert.equal(Number.isNaN(aggregate.centroid.x), false, "0 / 0 must not escape");
  assert.deepEqual(aggregate.centroid, { x: 5, y: 10 });
  assert.equal(aggregate.pixelCount, 0);
});

test("the centroid weights both axes, and does not swap them", () => {
  // Weighted only on x, or with the axes crossed, this reads (10, 90) or
  // (90, 90). Both look plausible on the shipped map.
  const light = province(1, 1000, { x: 0, y: 100 }, { x: 0, y: 100, width: 1, height: 1 });
  const heavy = province(2, 9000, { x: 100, y: 0 }, { x: 100, y: 0, width: 1, height: 1 });

  const aggregate = aggregateCountry(1, [1, 2], lookupOf([light, heavy]));

  assert.deepEqual(aggregate.centroid, { x: 90, y: 10 });
});

test("a negative pixelCount counts as zero instead of cancelling the weight", () => {
  // A re-exported manifest with a bad count must not make the total weight 0 and
  // send the centroid through the `0 / 0` path — or, worse, produce a negative
  // weight and a centroid outside the country entirely.
  const good = province(1, 100, { x: 0, y: 0 }, { x: 0, y: 0, width: 1, height: 1 });
  const broken = province(2, -100, { x: 100, y: 0 }, { x: 100, y: 0, width: 1, height: 1 });

  const aggregate = aggregateCountry(1, [1, 2], lookupOf([good, broken]));

  assert.equal(aggregate.pixelCount, 100, "the negative count adds nothing");
  assert.deepEqual(aggregate.centroid, { x: 0, y: 0 }, "the weighted mean still uses province 1");
  assert.equal(aggregate.resolvedCount, 2, "both provinces still resolved");
});

test("the aggregate never aliases the manifest's own bounds object", () => {
  // `unionBounds(null, b)` returning `b` itself would let a caller widening a
  // country's box silently rewrite the province's box inside the manifest.
  const source: Bounds = { x: 10, y: 30, width: 6, height: 9 };
  const merged = unionBounds(null, source);

  assert.deepEqual(merged, source);
  assert.notEqual(merged, source, "a copy, not the manifest's own object");

  const only = province(1, 500, { x: 12, y: 34 }, source);
  const aggregate = aggregateCountry(1, [1], lookupOf([only]));
  assert.notEqual(aggregate.bounds, source);
});

test("the centroid is not rounded — T07 wants the sub-pixel value", () => {
  const a = province(1, 1, { x: 0, y: 0 }, { x: 0, y: 0, width: 1, height: 1 });
  const b = province(2, 1, { x: 1, y: 0 }, { x: 1, y: 0, width: 1, height: 1 });
  const c = province(3, 1, { x: 0, y: 0 }, { x: 0, y: 0, width: 1, height: 1 });

  const aggregate = aggregateCountry(1, [1, 2, 3], lookupOf([a, b, c]));

  assert.ok(aggregate.centroid);
  assert.ok(Math.abs(aggregate.centroid.x - 1 / 3) < 1e-12, "a 1/3 stays fractional");
});

// The real asset, parsed the way the app parses it. Pure maths over plain data —
// no canvas, no image decode.
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

test("the whole shipped manifest aggregated as one country matches PLAN section 2", () => {
  const manifest = parseManifestText(
    readFileSync(packageRoot + "assets/provinces_manifest.json", "utf8"),
  );
  const byId = indexProvincesById(manifest.provinces);
  const lookup = (id: number): Province | null => {
    return byId.get(id) ?? null;
  };

  // Ids run 1..1650 over 1648 provinces: 1318 and 1458 do not exist, and a user
  // who paints every province hands all 1650 ids to one country.
  const everyId: number[] = [];
  for (let id = 1; id <= 1650; id += 1) {
    everyId.push(id);
  }
  const aggregate = aggregateCountry(1, everyId, lookup);

  assert.equal(aggregate.provinceCount, 1650, "every id the user assigned");
  assert.equal(aggregate.resolvedCount, 1648, "1318 and 1458 resolve to nothing and are skipped");
  assert.equal(aggregate.pixelCount, 2756578, "PLAN section 2: the painted pixel count");
  assert.equal(aggregate.pixelCount, manifest.painted.pixelCount, "and the manifest agrees");
  assert.deepEqual(
    aggregate.bounds,
    { x: 383, y: 364, width: 3119, height: 2427 },
    "the union of every bounding box",
  );

  assert.ok(aggregate.bounds);
  assert.ok(
    aggregate.bounds.x + aggregate.bounds.width <= 3653,
    "the union stays inside the 3653 x 2855 map",
  );
  assert.ok(aggregate.bounds.y + aggregate.bounds.height <= 2855);

  assert.ok(aggregate.centroid);
  assert.ok(Math.abs(aggregate.centroid.x - 2114.7631625152635) < 1e-9, "area-weighted x");
  assert.ok(Math.abs(aggregate.centroid.y - 1224.913820323604) < 1e-9, "area-weighted y");
});

test("a country of the two ids the manifest lacks aggregates to nothing", () => {
  const manifest = parseManifestText(
    readFileSync(packageRoot + "assets/provinces_manifest.json", "utf8"),
  );
  const byId = indexProvincesById(manifest.provinces);
  const aggregate = aggregateCountry(9, [1318, 1458], (id) => {
    return byId.get(id) ?? null;
  });

  assert.equal(aggregate.provinceCount, 2);
  assert.equal(aggregate.resolvedCount, 0, "neither id exists on the shipped asset");
  assert.equal(aggregate.bounds, null);
  assert.equal(aggregate.centroid, null);
});
