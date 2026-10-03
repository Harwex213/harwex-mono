import { ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { Building } from "./building";
import { Hex } from "./hex";
import { constant, kindOf } from "./testing";

const farm = kindOf("farm");
const mine = kindOf("mine");

test("a building only fits the biomes of its kind", () => {
  const meadow = new Hex("a", "grassland");
  const peak = new Hex("b", "mountains");

  strictEqual(meadow.place(new Building(farm)), true);
  strictEqual(peak.place(new Building(farm)), false);
  strictEqual(peak.place(new Building(mine)), true);
});

test("a hex takes one building at a time", () => {
  const hex = new Hex("a", "grassland");

  strictEqual(hex.place(new Building(farm)), true);
  strictEqual(hex.place(new Building(farm)), false);
});

test("production adds the combo of the building to the bonus of the biome", () => {
  const hex = new Hex("a", "grassland");

  hex.place(new Building(farm));

  const produced = hex.produce(constant(0));

  strictEqual(produced?.resource, "food");
  strictEqual(produced?.amount, 5);
  strictEqual(produced?.toxicity, 1);
  strictEqual(hex.toxicity.value, 1);
});

test("toxicity lowers the output of a hex", () => {
  const hex = new Hex("a", "mountains");

  hex.place(new Building(mine));
  hex.poison(50);

  const produced = hex.produce(constant(0));

  strictEqual(produced?.amount, 4);
});

test("half a hex of toxicity stops the food", () => {
  const hex = new Hex("a", "grassland");

  hex.place(new Building(farm));
  hex.poison(50);

  strictEqual(hex.produce(constant(0))?.amount, 0);
});

test("a hex full of toxicity produces nothing at all", () => {
  const hex = new Hex("a", "mountains");

  hex.place(new Building(mine));
  hex.poison(100);

  ok(hex.dead.value);
  strictEqual(hex.produce(constant(0)), undefined);
});

test("a dead hex takes no building", () => {
  const hex = new Hex("a", "grassland");

  hex.poison(100);

  strictEqual(hex.place(new Building(farm)), false);
});
