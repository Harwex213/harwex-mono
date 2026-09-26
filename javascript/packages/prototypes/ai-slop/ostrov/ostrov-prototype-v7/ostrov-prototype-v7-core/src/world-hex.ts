import { signal } from "@preact/signals-core";
import type { ReadonlySignal, Signal } from "@preact/signals-core";
import type { BiomeId } from "./biome";

class WorldHex {
  readonly id: string;
  readonly biome: BiomeId;
  readonly neighbours: readonly string[];
  readonly #scouted: Signal<boolean> = signal(false);
  readonly #trail: Signal<number> = signal(0);
  readonly #occupant: Signal<string | undefined> = signal(undefined);

  constructor(id: string, biome: BiomeId, neighbours: readonly string[]) {
    this.id = id;
    this.biome = biome;
    this.neighbours = neighbours;
  }

  get scouted(): ReadonlySignal<boolean> {
    return this.#scouted;
  }

  get trail(): ReadonlySignal<number> {
    return this.#trail;
  }

  get occupant(): ReadonlySignal<string | undefined> {
    return this.#occupant;
  }

  reveal(): void {
    this.#scouted.value = true;
  }

  occupy(playerId: string): void {
    this.#occupant.value = playerId;
    this.#scouted.value = true;
  }

  leave(): void {
    this.#occupant.value = undefined;
  }

  pollute(amount: number): void {
    this.#trail.value += Math.max(0, amount);
  }
}

export { WorldHex };
