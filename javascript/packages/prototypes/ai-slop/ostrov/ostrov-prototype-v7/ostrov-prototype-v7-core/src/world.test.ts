import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { Resources } from "./resources";
import { World } from "./world";
import { WorldHex } from "./world-hex";
import { constant } from "./testing";

const world = (): World => {
  return new World([
    new WorldHex("a", "grassland", ["b"]),
    new WorldHex("b", "swamp", ["a", "c"]),
    new WorldHex("c", "volcano", ["b"]),
  ]);
};

test("scouting costs the resource and reveals the neighbours", () => {
  const map = world();
  const resources = new Resources({ scouting: 3 });

  strictEqual(map.scout("b", resources), true);
  strictEqual(resources.amount("scouting").value, 0);
  strictEqual(map.scouted.value, 3);
  strictEqual(map.scout("a", resources), false);
});

test("an island flies to a neighbour, not across the map", () => {
  const map = world();

  strictEqual(map.moveTo("player-1", "a", "c"), false);
  strictEqual(map.moveTo("player-1", "a", "b"), true);
  strictEqual(map.hex("b")?.occupant.value, "player-1");
  strictEqual(map.hex("a")?.occupant.value, undefined);
});

test("a hex taken by somebody else is closed", () => {
  const map = world();

  map.hex("b")?.occupy("player-2");

  strictEqual(map.moveTo("player-1", "a", "b"), false);
});

test("the trail of a hex only grows", () => {
  const map = world();

  strictEqual(map.pollute("a", 12), 12);
  strictEqual(map.pollute("a", 8), 20);
  strictEqual(map.trail.value, 20);
});

test("an event needs both its threshold and its luck", () => {
  const map = world();

  map.pollute("a", 25);

  deepStrictEqual(map.rollEvents("a", constant(0.9)), []);

  const lucky = map.rollEvents("a", constant(0));

  strictEqual(lucky.length, 1);
  strictEqual(lucky[0]?.id, "bandits");
});
