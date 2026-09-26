import { computed } from "@preact/signals-core";
import type { ReadonlySignal } from "@preact/signals-core";
import { chance } from "./random";
import type { Random } from "./random";
import { Resources } from "./resources";
import { trailEvents } from "./trail-event";
import type { TrailEvent } from "./trail-event";
import { WorldHex } from "./world-hex";

const scoutCost = 3;

class World {
  readonly #hexes: readonly WorldHex[];
  readonly #trail: ReadonlySignal<number>;
  readonly #scouted: ReadonlySignal<number>;

  constructor(hexes: readonly WorldHex[]) {
    this.#hexes = hexes;

    this.#trail = computed(() => {
      return this.#hexes.reduce((total, hex) => {
        return total + hex.trail.value;
      }, 0);
    });

    this.#scouted = computed(() => {
      return this.#hexes.filter((hex) => {
        return hex.scouted.value;
      }).length;
    });
  }

  get hexes(): readonly WorldHex[] {
    return this.#hexes;
  }

  get trail(): ReadonlySignal<number> {
    return this.#trail;
  }

  get scouted(): ReadonlySignal<number> {
    return this.#scouted;
  }

  hex(id: string): WorldHex | undefined {
    return this.#hexes.find((hex) => {
      return hex.id === id;
    });
  }

  neighbours(id: string): WorldHex[] {
    const hex = this.hex(id);

    if (!hex) {
      return [];
    }

    return hex.neighbours.flatMap((neighbour) => {
      const found = this.hex(neighbour);

      return found ? [found] : [];
    });
  }

  scout(id: string, resources: Resources): boolean {
    const hex = this.hex(id);

    if (!hex || !resources.spend({ scouting: scoutCost })) {
      return false;
    }

    hex.reveal();

    for (const neighbour of this.neighbours(id)) {
      neighbour.reveal();
    }

    return true;
  }

  moveTo(playerId: string, from: string, to: string): boolean {
    const origin = this.hex(from);
    const target = this.hex(to);

    if (!origin || !target || !origin.neighbours.includes(to)) {
      return false;
    }

    if (target.occupant.value) {
      return false;
    }

    origin.leave();
    target.occupy(playerId);

    return true;
  }

  pollute(id: string, toxicity: number): number {
    const hex = this.hex(id);

    if (!hex) {
      return 0;
    }

    hex.pollute(toxicity);

    return hex.trail.value;
  }

  rollEvents(id: string, random: Random): TrailEvent[] {
    const hex = this.hex(id);

    if (!hex) {
      return [];
    }

    return trailEvents.filter((event) => {
      return hex.trail.value >= event.threshold && chance(random, event.chance);
    });
  }
}

export { scoutCost, World };
