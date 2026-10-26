import { computed, signal } from "@preact/signals-react";
import type { Province } from "../../domain/index";

// The province registry and the province the brush paints with.

function createProvincesSlice() {
  const list = signal<Province[]>([]);
  const activeId = signal<number | null>(null);
  // The id the next new province gets.
  const nextId = signal(1);

  const active = computed(() => {
    const id = activeId.value;

    if (id === null) {
      return null;
    }

    return list.value.find((province) => province.id === id) ?? null;
  });

  // Colour word -> province. The layer stores colours, so every lookup from a
  // pixel goes through this.
  const byColor = computed(() => {
    const out = new Map<number, Province>();

    for (const province of list.value) {
      out.set(province.color, province);
    }

    return out as ReadonlyMap<number, Province>;
  });

  return { list, activeId, nextId, active, byColor };
}

type TProvincesSlice = ReturnType<typeof createProvincesSlice>;

export {
  createProvincesSlice,
  type TProvincesSlice,
};
