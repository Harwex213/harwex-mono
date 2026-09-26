import type { BiomeId } from "./biome";
import type { BuildingKind, Site } from "./building-kind";
import type { Random } from "./random";
import { pick } from "./random";
import type { Combo } from "./resource";

class Building {
  readonly kind: BuildingKind;

  constructor(kind: BuildingKind) {
    this.kind = kind;
  }

  get id(): string {
    return this.kind.id;
  }

  site(biome: BiomeId): Site | undefined {
    return this.kind.sites.find((site) => {
      return site.biome === biome;
    });
  }

  fits(biome: BiomeId): boolean {
    return this.site(biome) !== undefined;
  }

  roll(random: Random): Combo {
    return pick(random, this.kind.combos);
  }
}

export { Building };
