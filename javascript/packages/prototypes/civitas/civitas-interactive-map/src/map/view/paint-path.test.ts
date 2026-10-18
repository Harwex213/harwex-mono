import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PATH_SAMPLES, samplePathPixels } from "./paint-path";

function walk(x0: number, y0: number, x1: number, y1: number): { points: string[]; count: number } {
  const points: string[] = [];
  const count = samplePathPixels(x0, y0, x1, y1, (x, y) => {
    points.push(x + "," + y);
  });
  return { points, count };
}

test("a horizontal run visits every integer x exactly once, endpoints included", () => {
  // The mutant this kills is "visit only the endpoint", which leaves a drag
  // painting a dotted line of provinces.
  const walked = walk(10, 5, 15, 5);

  assert.deepEqual(walked.points, ["10,5", "11,5", "12,5", "13,5", "14,5", "15,5"]);
  assert.equal(walked.count, 6);
});

test("a zero-length path visits its single point once", () => {
  const walked = walk(7, 9, 7, 9);

  assert.deepEqual(walked.points, ["7,9"]);
  assert.equal(walked.count, 1);
});

test("a 45-degree diagonal visits steps + 1 points, all on the line", () => {
  const walked = walk(0, 0, 40, 40);

  assert.equal(walked.count, 41);
  assert.equal(walked.points.length, 41);
  for (const point of walked.points) {
    const [x, y] = point.split(",");
    assert.equal(x, y, "every sample sits on y = x");
  }
  assert.equal(walked.points[40], "40,40", "the endpoint is included");
});

test("a shallow diagonal steps one pixel at a time along its long axis", () => {
  const walked = walk(0, 0, 4, 2);

  assert.deepEqual(walked.points, ["0,0", "1,1", "2,1", "3,2", "4,2"]);
});

test("a path longer than the cap is subsampled and still ends on the endpoint", () => {
  const far = MAX_PATH_SAMPLES * 3;
  const walked = walk(0, 0, far, 0);

  assert.equal(walked.count, MAX_PATH_SAMPLES + 1, "the cost is bounded however far it jumped");
  assert.equal(walked.points[walked.points.length - 1], far + ",0");
  assert.equal(walked.points[0], "0,0");
});

test("a non-finite coordinate visits nothing and returns 0", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.deepEqual(walk(bad, 0, 10, 10).points, [], "x0 = " + bad);
    assert.equal(walk(0, 0, 10, bad).count, 0, "y1 = " + bad);
  }
});

function walkPairs(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const points: [number, number][] = [];
  samplePathPixels(x0, y0, x1, y1, (x, y) => {
    points.push([x, y]);
  });
  return points;
}

test("a vertical run visits every integer y exactly once", () => {
  const walked = walk(4, 20, 4, 25);

  assert.deepEqual(walked.points, ["4,20", "4,21", "4,22", "4,23", "4,24", "4,25"]);
  assert.equal(walked.count, 6);
});

test("a backwards run walks in the direction it was given", () => {
  // `steps` is an absolute value; a walk that forgot the sign of `dx` would run
  // off to the right and paint provinces the pointer never crossed.
  const walked = walk(15, 9, 10, 7);

  assert.equal(walked.points[0], "15,9", "it starts where the last event left off");
  assert.equal(walked.points[walked.points.length - 1], "10,7", "and ends under the pointer");
  assert.equal(walked.count, 6);
});

test("every visited coordinate is an integer, even from fractional map pixels", () => {
  // `mapPixelAt` hands back the float under the cursor, and `ProvinceIndex`
  // floors what it is given. An unrounded walk addresses a pixel half a province
  // away along every diagonal.
  for (const [x, y] of walkPairs(10.4, 5.6, 14.5, 8.2)) {
    assert.ok(Number.isInteger(x), "x " + x + " is not an integer");
    assert.ok(Number.isInteger(y), "y " + y + " is not an integer");
  }
});

test("consecutive samples never jump more than one pixel on either axis", () => {
  // The property the whole module exists for: a stroke leaves no hole for a
  // province to fall through. Any path under the cap has to be pixel-continuous.
  const paths: [number, number, number, number][] = [
    [0, 0, 300, 120],
    [500, 400, 140, 90],
    [12, 900, 12, 40],
    [7, 7, 8, 400],
    [1000, 20, 1003, 23],
  ];

  for (const [x0, y0, x1, y1] of paths) {
    const points = walkPairs(x0, y0, x1, y1);
    for (let at = 1; at < points.length; at += 1) {
      const stepX = Math.abs(points[at][0] - points[at - 1][0]);
      const stepY = Math.abs(points[at][1] - points[at - 1][1]);
      assert.ok(stepX <= 1 && stepY <= 1, "gap of " + stepX + "," + stepY + " on " + x0 + "," + y0);
    }
    assert.deepEqual(points[0], [x0, y0]);
    assert.deepEqual(points[points.length - 1], [x1, y1]);
  }
});

test("the sample cap is 4096, the bound the design costs the walk against", () => {
  assert.equal(MAX_PATH_SAMPLES, 4096);
});
