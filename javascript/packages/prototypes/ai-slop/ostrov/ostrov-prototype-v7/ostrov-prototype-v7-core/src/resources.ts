import { signal } from "@preact/signals-core";
import type { ReadonlySignal, Signal } from "@preact/signals-core";
import { resourceKinds } from "./resource";
import type { Cost, ResourceKind } from "./resource";

class Resources {
  readonly #amounts: Map<ResourceKind, Signal<number>> = new Map();

  constructor(start: Cost = {}) {
    for (const kind of resourceKinds) {
      this.#amounts.set(kind, signal(start[kind] ?? 0));
    }
  }

  amount(kind: ResourceKind): ReadonlySignal<number> {
    const stored = this.#amounts.get(kind);

    if (!stored) {
      throw new Error(`Unknown resource ${kind}`);
    }

    return stored;
  }

  add(kind: ResourceKind, value: number): void {
    const stored = this.#amounts.get(kind);

    if (!stored) {
      throw new Error(`Unknown resource ${kind}`);
    }

    stored.value = Math.max(0, stored.value + value);
  }

  canAfford(cost: Cost): boolean {
    for (const kind of resourceKinds) {
      const price = cost[kind] ?? 0;

      if (price > this.amount(kind).value) {
        return false;
      }
    }

    return true;
  }

  spend(cost: Cost): boolean {
    if (!this.canAfford(cost)) {
      return false;
    }

    for (const kind of resourceKinds) {
      this.add(kind, -(cost[kind] ?? 0));
    }

    return true;
  }
}

export { Resources };
