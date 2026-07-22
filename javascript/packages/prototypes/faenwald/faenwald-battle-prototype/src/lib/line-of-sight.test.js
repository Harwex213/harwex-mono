import { describe, test } from "node:test";
import assert from "node:assert";
import { arcBlocked, directLosBlocked, hexLine } from "./line-of-sight.js";

const TERRAIN = {
  plain: {},
  forest: { blocksDirectLos: true },
  mountain: { blocksArcFire: true },
  hills: { elevation: 2 },
};

const buildGrid = (overrides = {}) => {
  const cells = [];
  for (let row = 0; row < 6; row += 1) {
    cells.push(new Array(6).fill("plain"));
  }
  for (const [key, terrain] of Object.entries(overrides)) {
    const [row, col] = key.split(":").map(Number);
    cells[row][col] = terrain;
  }
  return cells;
};

const buildCtx = (grid, units = {}, shooterElevation = 0) => ({
  terrainAt: (row, col) => TERRAIN[grid[row][col]],
  unitAt: (row, col) => units[`${row}:${col}`] ?? null,
  shooterElevation,
});

describe("hexLine", () => {
  test("a horizontal line row 0 cols 0->3 returns 4 cells incl. both ends", () => {
    const cells = hexLine({ row: 0, col: 0 }, { row: 0, col: 3 });
    assert.strictEqual(cells.length, 4);
    assert.deepStrictEqual(cells[0], { row: 0, col: 0 });
    assert.deepStrictEqual(cells[3], { row: 0, col: 3 });
  });

  test("an adjacent line returns exactly the two endpoints", () => {
    const cells = hexLine({ row: 0, col: 0 }, { row: 0, col: 1 });
    assert.strictEqual(cells.length, 2);
    assert.deepStrictEqual(cells[0], { row: 0, col: 0 });
    assert.deepStrictEqual(cells[1], { row: 0, col: 1 });
  });
});

describe("directLosBlocked", () => {
  test("clear plain line is not blocked", () => {
    const grid = buildGrid();
    assert.strictEqual(directLosBlocked({ row: 0, col: 0 }, { row: 0, col: 3 }, buildCtx(grid)), false);
  });

  test("adjacent (no intermediates) is not blocked", () => {
    const grid = buildGrid();
    assert.strictEqual(directLosBlocked({ row: 0, col: 0 }, { row: 0, col: 1 }, buildCtx(grid)), false);
  });

  test("intermediate forest blocks", () => {
    const grid = buildGrid({ "0:1": "forest" });
    assert.strictEqual(directLosBlocked({ row: 0, col: 0 }, { row: 0, col: 2 }, buildCtx(grid)), true);
  });

  test("intermediate unit on plain (shooter elevation 0) blocks", () => {
    const grid = buildGrid();
    const units = { "0:1": { id: 1 } };
    assert.strictEqual(directLosBlocked({ row: 0, col: 0 }, { row: 0, col: 2 }, buildCtx(grid, units, 0)), true);
  });

  test("intermediate unit on plain (elev 0) does not block when shooter is on elevation 1", () => {
    const grid = buildGrid();
    const units = { "0:1": { id: 1 } };
    assert.strictEqual(directLosBlocked({ row: 0, col: 0 }, { row: 0, col: 2 }, buildCtx(grid, units, 1)), false);
  });

  test("intermediate unit on hills (elev 2) blocks even when shooter elevation is 0", () => {
    const grid = buildGrid({ "0:1": "hills" });
    const units = { "0:1": { id: 1 } };
    assert.strictEqual(directLosBlocked({ row: 0, col: 0 }, { row: 0, col: 2 }, buildCtx(grid, units, 0)), true);
  });
});

describe("arcBlocked", () => {
  test("clear line is not blocked", () => {
    const grid = buildGrid();
    assert.strictEqual(arcBlocked({ row: 0, col: 0 }, { row: 0, col: 3 }, buildCtx(grid)), false);
  });

  test("intermediate mountain blocks", () => {
    const grid = buildGrid({ "0:1": "mountain" });
    assert.strictEqual(arcBlocked({ row: 0, col: 0 }, { row: 0, col: 2 }, buildCtx(grid)), true);
  });

  test("intermediate unit on plain does not block arc fire", () => {
    const grid = buildGrid();
    const units = { "0:1": { id: 1 } };
    assert.strictEqual(arcBlocked({ row: 0, col: 0 }, { row: 0, col: 2 }, buildCtx(grid, units)), false);
  });
});
