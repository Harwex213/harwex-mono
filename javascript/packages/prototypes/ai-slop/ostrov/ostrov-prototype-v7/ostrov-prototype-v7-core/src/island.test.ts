import { strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { Hex } from "./hex";
import { Island } from "./island";
import { Resources } from "./resources";
import { constant, kindOf } from "./testing";

const farm = kindOf("farm");
const sawmill = kindOf("sawmill");

const island = (): Island => {
  return new Island([
    new Hex("a", "grassland"),
    new Hex("b", "forrest"),
    new Hex("c", "mountains"),
  ]);
};

test("a building costs its resources", () => {
  const land = island();
  const resources = new Resources({ wood: 2 });

  strictEqual(land.build("a", farm, resources), true);
  strictEqual(resources.amount("wood").value, 0);
  strictEqual(land.built.value, 1);
});

test("an island without resources builds nothing", () => {
  const land = island();
  const resources = new Resources({ wood: 1 });

  strictEqual(land.canBuild("a", farm, resources), false);
  strictEqual(land.build("a", farm, resources), false);
  strictEqual(land.built.value, 0);
});

test("a building refuses the wrong biome", () => {
  const land = island();
  const resources = new Resources({ wood: 10, stone: 10 });

  strictEqual(land.build("c", farm, resources), false);
  strictEqual(land.build("b", sawmill, resources), true);
});

test("a demolished hex frees the ground and loses toxicity", () => {
  const land = island();
  const resources = new Resources({ wood: 10 });
  const hex = land.hex("a");

  land.build("a", farm, resources);
  hex?.poison(30);

  strictEqual(land.demolish("a"), true);
  strictEqual(hex?.building.value, undefined);
  strictEqual(hex?.toxicity.value, 20);
  strictEqual(land.demolish("a"), false);
});

test("a collection fills the resources and the toxicity of the island", () => {
  const land = island();
  const resources = new Resources({ wood: 10, stone: 10 });

  land.build("a", farm, resources);
  land.build("b", sawmill, resources);

  const harvest = land.collect(constant(0), resources);

  strictEqual(harvest.length, 2);
  strictEqual(resources.amount("food").value, 5);
  strictEqual(resources.amount("wood").value, 10 - 2 + 6);
  strictEqual(land.toxicity.value, 2);
});
