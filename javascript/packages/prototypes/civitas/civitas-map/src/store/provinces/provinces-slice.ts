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

  return { list, activeId, nextId, active };
}

type TProvincesSlice = ReturnType<typeof createProvincesSlice>;

export {
  createProvincesSlice,
  type TProvincesSlice,
};
