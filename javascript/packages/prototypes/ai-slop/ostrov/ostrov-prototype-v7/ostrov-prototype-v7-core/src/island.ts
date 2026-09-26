import { computed } from "@preact/signals-core";
import type { ReadonlySignal } from "@preact/signals-core";
import { Building } from "./building";
import type { BuildingKind } from "./building-kind";
import { Hex } from "./hex";
import type { Random } from "./random";
import { Resources } from "./resources";
import type { Yield } from "./resource";

class Island {
  readonly #hexes: readonly Hex[];
  readonly #toxicity: ReadonlySignal<number>;
  readonly #built: ReadonlySignal<number>;
  readonly #ruined: ReadonlySignal<number>;

  constructor(hexes: readonly Hex[]) {
    this.#hexes = hexes;

    this.#toxicity = computed(() => {
      return this.#hexes.reduce((total, hex) => {
        return total + hex.toxicity.value;
      }, 0);
    });

    this.#built = computed(() => {
      return this.#hexes.filter((hex) => {
        return hex.building.value !== undefined;
      }).length;
    });

    this.#ruined = computed(() => {
      return this.#hexes.filter((hex) => {
        return hex.dead.value;
      }).length;
    });
  }

  get hexes(): readonly Hex[] {
    return this.#hexes;
  }

  get toxicity(): ReadonlySignal<number> {
    return this.#toxicity;
  }

  get built(): ReadonlySignal<number> {
    return this.#built;
  }

  get ruined(): ReadonlySignal<number> {
    return this.#ruined;
  }

  hex(id: string): Hex | undefined {
    return this.#hexes.find((hex) => {
      return hex.id === id;
    });
  }

  canBuild(id: string, kind: BuildingKind, resources: Resources): boolean {
    const hex = this.hex(id);

    if (!hex || hex.building.value || hex.dead.value) {
      return false;
    }

    const fits = kind.sites.some((site) => {
      return site.biome === hex.biome;
    });

    return fits && resources.canAfford(kind.cost);
  }

  build(id: string, kind: BuildingKind, resources: Resources): boolean {
    if (!this.canBuild(id, kind, resources)) {
      return false;
    }

    const hex = this.hex(id);

    if (!hex || !resources.spend(kind.cost)) {
      return false;
    }

    return hex.place(new Building(kind));
  }

  demolish(id: string): boolean {
    const hex = this.hex(id);

    if (!hex || !hex.building.value) {
      return false;
    }

    hex.clear();
    hex.cleanse(10);

    return true;
  }

  collect(random: Random, resources: Resources): Yield[] {
    const harvest: Yield[] = [];

    for (const hex of this.#hexes) {
      const produced = hex.produce(random);

      if (!produced) {
        continue;
      }

      resources.add(produced.resource, produced.amount);
      harvest.push(produced);
    }

    return harvest;
  }
}

export { Island };
