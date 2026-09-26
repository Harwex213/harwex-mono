import { strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { Madness } from "./madness";
import { Resources } from "./resources";

test("every ten points of toxicity drive one man mad", () => {
  const madness = new Madness();
  const resources = new Resources({ population: 10 });

  strictEqual(madness.spread(35, resources), 3);
  strictEqual(madness.mad.value, 3);
  strictEqual(resources.amount("population").value, 7);
});

test("madness cannot take more people than the island has", () => {
  const madness = new Madness();
  const resources = new Resources({ population: 2 });

  strictEqual(madness.spread(90, resources), 2);
  strictEqual(resources.amount("population").value, 0);
});

test("the mad eat half a ration each", () => {
  const madness = new Madness();
  const resources = new Resources({ population: 10, food: 10 });

  madness.spread(60, resources);

  strictEqual(madness.feed(resources), 0);
  strictEqual(resources.amount("food").value, 7);
});

test("the food the mad do not get turns into hunger", () => {
  const madness = new Madness();
  const resources = new Resources({ population: 10, food: 1 });

  madness.spread(80, resources);

  strictEqual(madness.feed(resources), 3);
  strictEqual(madness.hunger.value, 3);
  strictEqual(resources.amount("food").value, 0);
});

test("mana brings a madman back to his senses", () => {
  const madness = new Madness();
  const resources = new Resources({ population: 10, mana: 5 });

  madness.spread(40, resources);

  strictEqual(madness.cure(resources), 2);
  strictEqual(madness.mad.value, 2);
  strictEqual(resources.amount("mana").value, 1);
  strictEqual(resources.amount("population").value, 8);
});
