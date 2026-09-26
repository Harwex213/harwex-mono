import { computed, signal } from "@preact/signals-core";
import type { ReadonlySignal, Signal } from "@preact/signals-core";
import { Resources } from "./resources";
import { unitKinds } from "./unit-kind";
import type { UnitKind } from "./unit-kind";

class Army {
  readonly #counts: Map<string, Signal<number>> = new Map();
  readonly #size: ReadonlySignal<number>;
  readonly #power: ReadonlySignal<number>;

  constructor() {
    for (const kind of unitKinds) {
      this.#counts.set(kind.id, signal(0));
    }

    this.#size = computed(() => {
      return unitKinds.reduce((total, kind) => {
        return total + this.count(kind).value;
      }, 0);
    });

    this.#power = computed(() => {
      return unitKinds.reduce((total, kind) => {
        return total + this.count(kind).value * (kind.attack + kind.health);
      }, 0);
    });
  }

  get size(): ReadonlySignal<number> {
    return this.#size;
  }

  get power(): ReadonlySignal<number> {
    return this.#power;
  }

  count(kind: UnitKind): ReadonlySignal<number> {
    const stored = this.#counts.get(kind.id);

    if (!stored) {
      throw new Error(`Unknown unit ${kind.id}`);
    }

    return stored;
  }

  recruit(kind: UnitKind, resources: Resources): boolean {
    if (!resources.spend(kind.cost)) {
      return false;
    }

    this.#add(kind.id, 1);

    return true;
  }

  lose(amount: number): number {
    let left = amount;

    for (const kind of unitKinds) {
      const stored = this.#counts.get(kind.id);

      if (!stored || left <= 0) {
        continue;
      }

      const fallen = Math.min(stored.value, left);

      stored.value -= fallen;
      left -= fallen;
    }

    return amount - left;
  }

  #add(id: string, amount: number): void {
    const stored = this.#counts.get(id);

    if (!stored) {
      throw new Error(`Unknown unit ${id}`);
    }

    stored.value += amount;
  }
}

export { Army };
