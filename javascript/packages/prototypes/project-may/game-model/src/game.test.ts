import { describe, test } from "node:test";
import assert from "node:assert";
import { Game } from "./game";
import { UNIT_TYPE } from "./unit";

describe("Game", () => {
  test.todo("Should spawn three unit", () => {
    
  });

  test("Should handle unit move", () => {
    const game = new Game(10, 10);

    const unit = game.spawnUnit({ type: UNIT_TYPE.WORKER, x: 0, y: 0, movePerTick: 1 });

    game.moveUnit({ unitId: unit.id, targetX: 5, targetY: 5 });

    const expected = [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5]
    ];

    assert.deepStrictEqual(unit.movementPath, expected);
  });

  test("Should move unit on next tick", () => {
    const game = new Game(10, 10);

    const unit = game.spawnUnit({ type: UNIT_TYPE.WORKER, x: 0, y: 0, movePerTick: 1 });

    game.moveUnit({ unitId: unit.id, targetX: 3, targetY: 3 });

    game.nextTick();

    assert.deepStrictEqual(unit.x, 1);
    assert.deepStrictEqual(unit.y, 1);

    game.nextTick();
    game.nextTick();

    assert.deepStrictEqual(unit.x, 3);
    assert.deepStrictEqual(unit.y, 3);
  });
});
