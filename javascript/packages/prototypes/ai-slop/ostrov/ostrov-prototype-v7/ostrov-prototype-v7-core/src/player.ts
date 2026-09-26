import { computed, signal } from "@preact/signals-core";
import type { ReadonlySignal, Signal } from "@preact/signals-core";
import { Army } from "./army";
import { Island } from "./island";
import { Madness } from "./madness";
import type { Random } from "./random";
import { Resources } from "./resources";
import type { Yield } from "./resource";

const sciencePerTechnology = 12;

class Player {
  readonly id: string;
  readonly nick: string;
  readonly island: Island;
  readonly resources: Resources;
  readonly madness: Madness = new Madness();
  readonly army: Army = new Army();
  readonly #technologies: Signal<number> = signal(0);
  readonly #location: Signal<string>;
  readonly #sane: ReadonlySignal<boolean>;

  constructor(id: string, nick: string, island: Island, location: string, resources: Resources) {
    this.id = id;
    this.nick = nick;
    this.island = island;
    this.resources = resources;
    this.#location = signal(location);

    this.#sane = computed(() => {
      return this.madness.mad.value < this.resources.amount("population").value;
    });
  }

  get technologies(): ReadonlySignal<number> {
    return this.#technologies;
  }

  get location(): ReadonlySignal<string> {
    return this.#location;
  }

  get sane(): ReadonlySignal<boolean> {
    return this.#sane;
  }

  moveTo(hexId: string): void {
    this.#location.value = hexId;
  }

  research(): boolean {
    if (!this.resources.spend({ science: sciencePerTechnology })) {
      return false;
    }

    this.#technologies.value += 1;

    return true;
  }

  collect(random: Random): Yield[] {
    const harvest = this.island.collect(random, this.resources);

    this.madness.spread(this.island.toxicity.value, this.resources);

    const hunger = this.madness.feed(this.resources);

    if (hunger > 0) {
      const hex = this.island.hexes[0];

      if (hex) {
        hex.poison(hunger);
      }
    }

    return harvest;
  }
}

export { Player, sciencePerTechnology };
