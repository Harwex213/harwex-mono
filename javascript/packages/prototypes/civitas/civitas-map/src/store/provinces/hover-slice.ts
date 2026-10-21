import { computed, signal } from "@preact/signals-react";
import type { TProvincesSlice } from "./provinces-slice";

// The map pixel under the cursor and the province painted there.

function createHoverSlice(provinces: TProvincesSlice) {
  const pixel = signal<{ x: number; y: number } | null>(null);
  // The layer word under the cursor; 0 where nothing is painted.
  const color = signal(0);

  const province = computed(() => {
    const value = color.value;

    if (value === 0) {
      return null;
    }

    return provinces.list.value.find((entry) => entry.color === value) ?? null;
  });

  return { pixel, color, province };
}

type THoverSlice = ReturnType<typeof createHoverSlice>;

export {
  createHoverSlice,
  type THoverSlice,
};
