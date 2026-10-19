import { computed, signal } from "@preact/signals-react";
import type { StrokeAction } from "../domain/index";
import type { TWorldSlice } from "./world-slice";

// Assign mode and the brush stroke. Country data stays in the world slice.

type Stroke = { countryId: number; action: StrokeAction; visited: Set<number> };

function createAssignSlice(world: TWorldSlice) {
  const mode = signal(false);
  // The id the user picked. Read `activeCountryId` instead.
  const pickedCountryId = signal<number | null>(null);
  const painting = signal(false);
  // Nothing renders from the stroke, so `visited` is mutated in place.
  const stroke = signal<Stroke | null>(null);

  // Derived, so a deleted country disarms assignment and no stale id reaches
  // `assignProvinces`. Assign mode stays on but does nothing.
  const activeCountryId = computed(() => {
    const id = pickedCountryId.value;
    if (id === null) {
      return null;
    }
    return world.countryById.value.has(id) ? id : null;
  });

  return { mode, pickedCountryId, painting, stroke, activeCountryId };
}

type TAssignSlice = ReturnType<typeof createAssignSlice>;

export { createAssignSlice, type Stroke, type TAssignSlice };
