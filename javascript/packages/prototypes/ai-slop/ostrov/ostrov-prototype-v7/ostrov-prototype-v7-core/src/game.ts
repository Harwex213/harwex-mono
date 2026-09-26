import { computed } from "@preact/signals-core";
import type { ReadonlySignal } from "@preact/signals-core";
import { Battle } from "./battle";
import type { BattleResult } from "./battle";
import { buildingKinds } from "./building-kind";
import type { BuildingKindId } from "./building-kind";
import { createIsland, createWorld } from "./genesis";
import { Player } from "./player";
import type { Random } from "./random";
import { Resources } from "./resources";
import type { Yield } from "./resource";
import { Turn } from "./turn";
import type { Phase } from "./turn";
import type { TrailEvent } from "./trail-event";
import { enemyKinds } from "./unit-kind";
import type { EnemyKind } from "./unit-kind";
import { World } from "./world";

const startResources = {
  food: 10,
  stone: 10,
  wood: 10,
  population: 5,
  hammers: 2,
  scouting: 6,
  science: 0,
  mana: 4,
};

class Game {
  readonly #random: Random;
  readonly #world: World;
  readonly #player: Player;
  readonly #turn: Turn = new Turn();
  readonly #danger: ReadonlySignal<number>;

  constructor(random: Random = Math.random) {
    this.#random = random;
    this.#world = createWorld(random);

    const home = this.#world.hexes[0];

    if (!home) {
      throw new Error("The world has no hexes");
    }

    this.#player = new Player(
      "player-1",
      "Игрок",
      createIsland(random),
      home.id,
      new Resources(startResources),
    );

    home.occupy(this.#player.id);

    this.#danger = computed(() => {
      return this.#world.trail.value + this.#player.island.toxicity.value;
    });
  }

  get world(): World {
    return this.#world;
  }

  get player(): Player {
    return this.#player;
  }

  get turn(): Turn {
    return this.#turn;
  }

  get danger(): ReadonlySignal<number> {
    return this.#danger;
  }

  build(hexId: string, kindId: BuildingKindId): boolean {
    if (!this.#turn.is("building")) {
      return false;
    }

    const kind = buildingKinds.find((candidate) => {
      return candidate.id === kindId;
    });

    if (!kind) {
      return false;
    }

    return this.#player.island.build(hexId, kind, this.#player.resources);
  }

  demolish(hexId: string): boolean {
    if (!this.#turn.is("building")) {
      return false;
    }

    return this.#player.island.demolish(hexId);
  }

  collectTaxes(): Yield[] {
    if (!this.#turn.is("taxes")) {
      return [];
    }

    return this.#player.collect(this.#random);
  }

  scout(hexId: string): boolean {
    if (!this.#turn.is("scouting")) {
      return false;
    }

    return this.#world.scout(hexId, this.#player.resources);
  }

  moveTo(hexId: string): boolean {
    if (!this.#turn.is("scouting")) {
      return false;
    }

    const moved = this.#world.moveTo(this.#player.id, this.#player.location.value, hexId);

    if (moved) {
      this.#player.moveTo(hexId);
    }

    return moved;
  }

  stay(): TrailEvent[] {
    if (!this.#turn.is("scouting")) {
      return [];
    }

    const location = this.#player.location.value;

    this.#world.pollute(location, this.#player.island.toxicity.value);

    const events = this.#world.rollEvents(location, this.#random);

    for (const event of events) {
      this.apply(event);
    }

    return events;
  }

  apply(event: TrailEvent): void {
    const resources = this.#player.resources;

    if (event.id === "bandits") {
      resources.add("food", -event.power);
      resources.add("stone", -event.power);
    }

    if (event.id === "madness") {
      this.#player.madness.strike(event.power);
    }

    if (event.id === "worm" || event.id === "undead") {
      for (const hex of this.#player.island.hexes.slice(0, event.power)) {
        hex.poison(event.power);
      }
    }
  }

  raid(): EnemyKind[] {
    const tier = Math.max(1, Math.ceil(this.#turn.number.value / 3));

    return enemyKinds.filter((enemy) => {
      return enemy.tier <= tier;
    });
  }

  fight(): BattleResult | undefined {
    if (!this.#turn.is("cleanup")) {
      return undefined;
    }

    const battle = new Battle(this.#player.army, this.raid());

    return battle.resolve(this.#random);
  }

  next(): Phase {
    return this.#turn.next();
  }
}

export { Game, startResources };
