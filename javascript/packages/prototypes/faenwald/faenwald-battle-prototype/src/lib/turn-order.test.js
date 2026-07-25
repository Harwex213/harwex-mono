import { describe, test } from "node:test";
import assert from "node:assert";
import { unitActivationOrder } from "./turn-order.js";

const baseUnit = (overrides) => ({
  id: 1,
  side: "attacker",
  type: "light-cavalry",
  name: "x",
  hp: 10,
  attack: 3,
  morale: 20,
  speed: 5,
  position: { row: 0, col: 0 },
  routed: false,
  ...overrides,
});

describe("unitActivationOrder", () => {
  test("filters to matching side and group", () => {
    const group = { side: "attacker", type: "cavalry" };
    const units = [
      baseUnit({ id: 1, side: "attacker", type: "light-cavalry" }),
      baseUnit({ id: 2, side: "defender", type: "light-cavalry" }),
      baseUnit({ id: 3, side: "attacker", type: "light-spearman" }),
    ];

    const order = unitActivationOrder(units, group);

    assert.deepStrictEqual(order.map((u) => u.id), [1]);
  });

  test("excludes units without a position and dead units, but includes routed units", () => {
    const group = { side: "attacker", type: "cavalry" };
    const units = [
      baseUnit({ id: 1, position: null }),
      baseUnit({ id: 2, hp: 0 }),
      baseUnit({ id: 3, routed: true }),
      baseUnit({ id: 4 }),
    ];

    const order = unitActivationOrder(units, group);

    assert.deepStrictEqual(order.map((u) => u.id), [3, 4]);
  });

  test("sorts faster units first", () => {
    const group = { side: "attacker", type: "cavalry" };
    const units = [
      baseUnit({ id: 1, speed: 3 }),
      baseUnit({ id: 2, speed: 5 }),
    ];

    const order = unitActivationOrder(units, group);

    assert.deepStrictEqual(order.map((u) => u.id), [2, 1]);
  });

  test("breaks speed ties by lower id first", () => {
    const group = { side: "attacker", type: "cavalry" };
    const units = [
      baseUnit({ id: 2, speed: 5 }),
      baseUnit({ id: 1, speed: 5 }),
    ];

    const order = unitActivationOrder(units, group);

    assert.deepStrictEqual(order.map((u) => u.id), [1, 2]);
  });

  test("does not mutate the input array", () => {
    const group = { side: "attacker", type: "cavalry" };
    const units = [
      baseUnit({ id: 2, speed: 3 }),
      baseUnit({ id: 1, speed: 5 }),
    ];

    unitActivationOrder(units, group);

    assert.deepStrictEqual(units.map((u) => u.id), [2, 1]);
  });
});
