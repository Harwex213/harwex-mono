import { describe, test } from "node:test";
import assert from "node:assert";
import {
  bearingDir,
  directionTo,
  flankHexes,
  frontHexes,
  frontalConeReach,
  hexDistance,
  inFrontalCone,
  neighbors,
  rearHexes,
  zoneAtRange,
  zoneOf,
} from "./hex-facing.js";

describe("frontHexes", () => {
  test("facing 4 (south) from {2,2}", () => {
    assert.deepStrictEqual(frontHexes({ row: 2, col: 2 }, 4), [
      { row: 3, col: 1 },
      { row: 3, col: 2 },
    ]);
  });

  test("facing 1 (north) from {2,2}", () => {
    assert.deepStrictEqual(frontHexes({ row: 2, col: 2 }, 1), [
      { row: 1, col: 2 },
      { row: 1, col: 1 },
    ]);
  });
});

describe("2/2/2 partition", () => {
  test("front, flank, rear disjointly cover all 6 neighbors", () => {
    const position = { row: 2, col: 2 };
    const facing = 4;

    const front = frontHexes(position, facing);
    const flank = flankHexes(position, facing);
    const rear = rearHexes(position, facing);

    assert.strictEqual(front.length, 2);
    assert.strictEqual(flank.length, 2);
    assert.strictEqual(rear.length, 2);

    const key = (h) => `${h.row}:${h.col}`;
    const all = [...front, ...flank, ...rear].map(key);
    const uniqueAll = new Set(all);
    assert.strictEqual(uniqueAll.size, 6);

    const expectedNeighbors = new Set(neighbors(position).map(key));
    assert.deepStrictEqual(uniqueAll, expectedNeighbors);
  });
});

describe("neighbors parity", () => {
  test("odd row {3,2}", () => {
    assert.deepStrictEqual(neighbors({ row: 3, col: 2 }), [
      { row: 3, col: 3 }, // E
      { row: 2, col: 3 }, // NE
      { row: 2, col: 2 }, // NW
      { row: 3, col: 1 }, // W
      { row: 4, col: 2 }, // SW
      { row: 4, col: 3 }, // SE
    ]);
  });
});

describe("zoneOf", () => {
  const position = { row: 2, col: 2 };
  const facing = 4;

  test("front hexes", () => {
    assert.strictEqual(zoneOf(position, facing, { row: 3, col: 1 }), "front");
    assert.strictEqual(zoneOf(position, facing, { row: 3, col: 2 }), "front");
  });

  test("flank hexes", () => {
    assert.strictEqual(zoneOf(position, facing, { row: 2, col: 3 }), "flank");
    assert.strictEqual(zoneOf(position, facing, { row: 2, col: 1 }), "flank");
  });

  test("rear hexes", () => {
    assert.strictEqual(zoneOf(position, facing, { row: 1, col: 2 }), "rear");
    assert.strictEqual(zoneOf(position, facing, { row: 1, col: 1 }), "rear");
  });
});

describe("directionTo", () => {
  test("returns -1 for non-adjacent hexes", () => {
    assert.strictEqual(directionTo({ row: 2, col: 2 }, { row: 5, col: 5 }), -1);
  });
});

describe("hexDistance", () => {
  test("identical hexes are distance 0", () => {
    assert.strictEqual(hexDistance({ row: 2, col: 2 }, { row: 2, col: 2 }), 0);
  });

  test("adjacent hexes are distance 1", () => {
    assert.strictEqual(hexDistance({ row: 2, col: 2 }, { row: 3, col: 1 }), 1);
  });

  test("two-hex line is distance 2", () => {
    assert.strictEqual(hexDistance({ row: 2, col: 2 }, { row: 0, col: 2 }), 2);
  });

  test("matches the hop count of a chained neighbors() walk", () => {
    const start = { row: 3, col: 2 };
    const step1 = neighbors(start)[1]; // NE
    const step2 = neighbors(step1)[1]; // NE again — 2 hops away
    assert.strictEqual(hexDistance(start, step2), 2);
  });
});

describe("inFrontalCone", () => {
  const shooterPos = { row: 2, col: 2 };
  const facing = 0;

  test("the two front neighbors are in the cone", () => {
    for (const front of frontHexes(shooterPos, facing)) {
      assert.strictEqual(inFrontalCone(shooterPos, facing, front), true);
    }
  });

  test("a rear neighbor is not in the cone", () => {
    const [rear] = rearHexes(shooterPos, facing);
    assert.strictEqual(inFrontalCone(shooterPos, facing, rear), false);
  });

  test("the shooter's own hex is not in the cone", () => {
    assert.strictEqual(inFrontalCone(shooterPos, facing, shooterPos), false);
  });
});

describe("frontalConeReach", () => {
  const shooterPos = { row: 2, col: 2 };
  const facing = 0;

  test("a hex two steps along a front edge dir returns 2", () => {
    const [front] = frontHexes(shooterPos, facing);
    const twoSteps = neighbors(front)[facing];
    assert.strictEqual(frontalConeReach(shooterPos, facing, twoSteps), 2);
  });

  test("equals hexDistance for cone hexes", () => {
    const [front] = frontHexes(shooterPos, facing);
    const twoSteps = neighbors(front)[facing];
    assert.strictEqual(frontalConeReach(shooterPos, facing, twoSteps), hexDistance(shooterPos, twoSteps));
  });

  test("returns null for a flank/rear hex", () => {
    const [flank] = flankHexes(shooterPos, facing);
    assert.strictEqual(frontalConeReach(shooterPos, facing, flank), null);
    const [rear] = rearHexes(shooterPos, facing);
    assert.strictEqual(frontalConeReach(shooterPos, facing, rear), null);
  });
});

describe("bearingDir", () => {
  test("equals directionTo for every adjacent hex", () => {
    const center = { row: 3, col: 2 };
    for (const nb of neighbors(center)) {
      assert.strictEqual(bearingDir(center, nb), directionTo(center, nb));
    }
  });
});

describe("zoneAtRange", () => {
  const unitPos = { row: 3, col: 2 };
  const facing = 4;

  test("directly in front at range returns FRONT", () => {
    const [front] = frontHexes(unitPos, facing);
    const twoSteps = neighbors(front)[facing];
    assert.strictEqual(zoneAtRange(unitPos, facing, twoSteps), "front");
  });

  test("at flank bearing at range returns FLANK", () => {
    const [flank] = flankHexes(unitPos, facing);
    const dir = directionTo(unitPos, flank);
    const twoSteps = neighbors(flank)[dir];
    assert.strictEqual(zoneAtRange(unitPos, facing, twoSteps), "flank");
  });

  test("behind at range returns REAR", () => {
    const [rear] = rearHexes(unitPos, facing);
    const dir = directionTo(unitPos, rear);
    const twoSteps = neighbors(rear)[dir];
    assert.strictEqual(zoneAtRange(unitPos, facing, twoSteps), "rear");
  });

  test("consistent with zoneOf for the adjacent case", () => {
    const [front] = frontHexes(unitPos, facing);
    assert.strictEqual(zoneAtRange(unitPos, facing, front), zoneOf(unitPos, facing, front));
  });
});
