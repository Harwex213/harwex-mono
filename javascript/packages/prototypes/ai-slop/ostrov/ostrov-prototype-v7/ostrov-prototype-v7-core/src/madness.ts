import { signal } from "@preact/signals-core";
import type { ReadonlySignal, Signal } from "@preact/signals-core";
import { Resources } from "./resources";

const toxicityPerMadman = 10;
const foodPerMadman = 0.5;
const manaPerCure = 2;

class Madness {
  readonly #mad: Signal<number> = signal(0);
  readonly #hunger: Signal<number> = signal(0);

  get mad(): ReadonlySignal<number> {
    return this.#mad;
  }

  get hunger(): ReadonlySignal<number> {
    return this.#hunger;
  }

  spread(toxicity: number, resources: Resources): number {
    const people = resources.amount("population").value;
    const struck = Math.min(people, Math.floor(toxicity / toxicityPerMadman));

    if (struck <= 0) {
      return 0;
    }

    resources.add("population", -struck);
    this.#mad.value += struck;

    return struck;
  }

  feed(resources: Resources): number {
    const needed = Math.ceil(this.#mad.value * foodPerMadman);
    const stored = resources.amount("food").value;
    const paid = Math.min(needed, stored);

    resources.add("food", -paid);
    this.#hunger.value = needed - paid;

    return this.#hunger.value;
  }

  cure(resources: Resources): number {
    const affordable = Math.floor(resources.amount("mana").value / manaPerCure);
    const cured = Math.min(this.#mad.value, affordable);

    if (cured <= 0) {
      return 0;
    }

    resources.add("mana", -cured * manaPerCure);
    this.#mad.value -= cured;
    resources.add("population", cured);

    return cured;
  }

  strike(amount: number): void {
    this.#mad.value += amount;
  }
}

export { foodPerMadman, Madness, manaPerCure, toxicityPerMadman };
