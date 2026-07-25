import { describe, test } from "node:test";
import assert from "node:assert";
import { fleePath } from "./flee-path.js";

const inBounds = (row, col, size) => row >= 0 && row < size && col >= 0 && col < size;

describe("fleePath", () => {
  test("finds a minimal-hop path on an open 3x3 grid to row 0", () => {
    const isGoal = (row) => row === 0;
    const isPassable = (row, col) => inBounds(row, col, 3);

    const path = fleePath({ row: 2, col: 1 }, isGoal, isPassable);

    assert.strictEqual(path.length, 2);
    assert.strictEqual(path[path.length - 1].row, 0);
  });

  test("returns [] when start already satisfies isGoal", () => {
    const isGoal = (row) => row === 0;
    const isPassable = (row, col) => inBounds(row, col, 3);

    const path = fleePath({ row: 0, col: 1 }, isGoal, isPassable);

    assert.deepStrictEqual(path, []);
  });

  test("routes around an impassable hex blocking the direct line", () => {
    const isGoal = (row) => row === 0;
    const blocked = new Set(["1:1"]);
    const isPassable = (row, col) => inBounds(row, col, 3) && !blocked.has(`${row}:${col}`);

    const path = fleePath({ row: 2, col: 1 }, isGoal, isPassable);

    assert.ok(path.length > 0);
    assert.strictEqual(path[path.length - 1].row, 0);
    assert.ok(!path.some((h) => h.row === 1 && h.col === 1));
  });

  test("returns [] when fully walled off from any goal", () => {
    const isGoal = (row) => row === 0;
    const isPassable = (row, col) => row === 2 && col === 1;

    const path = fleePath({ row: 2, col: 1 }, isGoal, isPassable);

    assert.deepStrictEqual(path, []);
  });

  test("path length matches BFS distance (nearest goal, not a longer detour)", () => {
    const isGoal = (row) => row === 0;
    const isPassable = (row, col) => inBounds(row, col, 5);

    const path = fleePath({ row: 3, col: 2 }, isGoal, isPassable);

    // no shorter path than 3 hops exists on this grid to reach row 0 from row 3
    assert.strictEqual(path.length, 3);
  });
});
