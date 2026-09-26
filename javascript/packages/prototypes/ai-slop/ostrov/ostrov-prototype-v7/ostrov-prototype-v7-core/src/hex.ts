import { computed, signal } from "@preact/signals-core";
import type { ReadonlySignal, Signal } from "@preact/signals-core";
import type { BiomeId } from "./biome";
import { Building } from "./building";
import type { Random } from "./random";
import type { Yield } from "./resource";

const maxToxicity = 100;
const foodThreshold = 50;

class Hex {
  readonly id: string;
  readonly biome: BiomeId;
  readonly #building: Signal<Building | undefined> = signal(undefined);
  readonly #toxicity: Signal<number> = signal(0);
  readonly #dead: ReadonlySignal<boolean>;

  constructor(id: string, biome: BiomeId) {
    this.id = id;
    this.biome = biome;

    this.#dead = computed(() => {
      return this.#toxicity.value >= maxToxicity;
    });
  }

  get building(): ReadonlySignal<Building | undefined> {
    return this.#building;
  }

  get toxicity(): ReadonlySignal<number> {
    return this.#toxicity;
  }

  get dead(): ReadonlySignal<boolean> {
    return this.#dead;
  }

  place(building: Building): boolean {
    if (this.#building.value || this.#dead.value || !building.fits(this.biome)) {
      return false;
    }

    this.#building.value = building;

    return true;
  }

  clear(): Building | undefined {
    const building = this.#building.value;

    this.#building.value = undefined;

    return building;
  }

  poison(amount: number): void {
    this.#toxicity.value = Math.min(maxToxicity, this.#toxicity.value + amount);
  }

  cleanse(amount: number): void {
    this.#toxicity.value = Math.max(0, this.#toxicity.value - amount);
  }

  produce(random: Random): Yield | undefined {
    const building = this.#building.value;

    if (!building || this.#dead.value) {
      return undefined;
    }

    const site = building.site(this.biome);

    if (!site) {
      return undefined;
    }

    const combo = building.roll(random);
    const toxicity = combo.toxicity + site.toxicity;
    const efficiency = 1 - this.#toxicity.value / maxToxicity;
    const starved = building.kind.resource === "food" && this.#toxicity.value >= foodThreshold;
    const amount = starved ? 0 : Math.floor((combo.amount + site.amount) * efficiency);

    this.poison(toxicity);

    return {
      resource: building.kind.resource,
      amount,
      toxicity,
    };
  }
}

export { foodThreshold, Hex, maxToxicity };
