import { signal } from "@preact/signals-core";
import type { ReadonlySignal, Signal } from "@preact/signals-core";

type Phase = "building" | "taxes" | "scouting" | "cleanup";

const order: readonly Phase[] = ["building", "taxes", "scouting", "cleanup"];

const phaseTitles: Record<Phase, string> = {
  building: "фаза строительства",
  taxes: "фаза сбора налогов",
  scouting: "фаза разведки",
  cleanup: "фаза зачистки",
};

class Turn {
  readonly #phase: Signal<Phase> = signal("building");
  readonly #number: Signal<number> = signal(1);

  get phase(): ReadonlySignal<Phase> {
    return this.#phase;
  }

  get number(): ReadonlySignal<number> {
    return this.#number;
  }

  is(phase: Phase): boolean {
    return this.#phase.value === phase;
  }

  next(): Phase {
    const index = order.indexOf(this.#phase.value);
    const following = order[(index + 1) % order.length] ?? "building";

    if (following === "building") {
      this.#number.value += 1;
    }

    this.#phase.value = following;

    return following;
  }
}

export { order, phaseTitles, Turn };
export type { Phase };
