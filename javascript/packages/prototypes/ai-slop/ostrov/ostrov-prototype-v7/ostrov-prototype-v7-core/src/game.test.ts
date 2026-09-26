import { ok, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { Army } from "./army";
import { Battle } from "./battle";
import { Game } from "./game";
import { Resources } from "./resources";
import { unitKinds } from "./unit-kind";
import { constant, sequence } from "./testing";

const hexWith = (game: Game, biome: string): string => {
  const hex = game.player.island.hexes.find((candidate) => {
    return candidate.biome === biome;
  });

  return hex?.id ?? "";
};

test("a phase only takes the actions that belong to it", () => {
  const game = new Game(constant(0));

  strictEqual(game.collectTaxes().length, 0);
  strictEqual(game.scout("world-1"), false);
  strictEqual(game.fight(), undefined);
});

test("a game starts on the first hex of the world", () => {
  const game = new Game(constant(0));

  strictEqual(game.player.location.value, "world-1");
  strictEqual(game.world.hex("world-1")?.occupant.value, game.player.id);
});

test("the loop builds, collects and moves on", () => {
  const game = new Game(sequence([0.1, 0.5, 0.9, 0.3]));
  const grassland = hexWith(game, "grassland");

  if (grassland) {
    strictEqual(game.build(grassland, "farm"), true);
  }

  strictEqual(game.next(), "taxes");

  const harvest = game.collectTaxes();

  strictEqual(harvest.length, grassland ? 1 : 0);
  strictEqual(game.next(), "scouting");

  const events = game.stay();

  ok(Array.isArray(events));
  strictEqual(game.next(), "cleanup");
  ok(game.fight() !== undefined);
  strictEqual(game.next(), "building");
  strictEqual(game.turn.number.value, 2);
});

test("an unknown building is not for sale", () => {
  const game = new Game(constant(0));

  strictEqual(game.build("hex-1", "castle" as "farm"), false);
});

test("the trail of the hex grows every turn the island stays", () => {
  const game = new Game(constant(0.99));
  const hex = game.player.island.hexes[0];

  hex?.poison(20);
  game.next();
  game.next();
  game.stay();

  strictEqual(game.world.hex("world-1")?.trail.value, 20);
  strictEqual(game.danger.value, 40);
});

test("an army with no soldiers loses the raid", () => {
  const game = new Game(constant(0.5));

  game.next();
  game.next();
  game.next();

  const result = game.fight();

  strictEqual(result?.won, false);
  strictEqual(result?.losses, 0);
});

test("a larger army wins and takes losses", () => {
  const army = new Army();
  const resources = new Resources({ population: 40, wood: 40, stone: 40, hammers: 40, mana: 40 });
  const knight = unitKinds.find((kind) => {
    return kind.id === "knight";
  });

  if (!knight) {
    throw new Error("The catalog has no knight");
  }

  for (let index = 0; index < 12; index += 1) {
    army.recruit(knight, resources);
  }

  const battle = new Battle(army, []);
  const result = battle.resolve(constant(0.5));

  strictEqual(result.won, true);
  strictEqual(army.size.value, 12);
});

test("a recruit costs population and materials", () => {
  const army = new Army();
  const resources = new Resources({ population: 1 });
  const militia = unitKinds[0];

  if (!militia) {
    throw new Error("The catalog has no units");
  }

  strictEqual(army.recruit(militia, resources), true);
  strictEqual(resources.amount("population").value, 0);
  strictEqual(army.recruit(militia, resources), false);
  strictEqual(army.size.value, 1);
});
