import { computed, signal } from "@preact/signals-react";
import { EMPTY_SELECTION } from "../domain/index";
import type { SelectionScope, SelectionState } from "../domain/index";
import type { TMapSlice } from "./map-slice";
import type { TWorldSlice } from "./world-slice";

// The selection. All slots sit in one signal, so a write is atomic.
// The transition rule is `nextSelection` in `src/domain`.

function createSelectionSlice(map: TMapSlice, world: TWorldSlice) {
  const hoveredProvinceId = signal<number | null>(null);
  const selection = signal<SelectionState>(EMPTY_SELECTION);

  const selectedProvinceId = computed(() => {
    return selection.value.provinceId;
  });

  // Derived, so a deleted country or a changed owner never lingers here.
  const selectedCountryId = computed(() => {
    const current = selection.value;
    if (current.scope === "country" && current.countryId !== null) {
      return world.countryById.value.has(current.countryId) ? current.countryId : null;
    }
    if (current.provinceId === null) {
      return null;
    }
    return world.countryOfProvince.value.get(current.provinceId) ?? null;
  });

  // Downgrades rather than reporting a state the data no longer supports.
  const scope = computed<SelectionScope>(() => {
    const current = selection.value;
    if (current.scope === "country" && selectedCountryId.value !== null) {
      return "country";
    }
    if (current.provinceId !== null) {
      return "province";
    }
    return "none";
  });

  const selectedCountry = computed(() => {
    const id = selectedCountryId.value;
    if (id === null) {
      return null;
    }
    return world.countryById.value.get(id) ?? null;
  });

  // `null` until the map load finishes.
  const selectedProvince = computed(() => {
    const id = selectedProvinceId.value;
    const byId = map.provincesById.value;
    if (id === null || byId === null) {
      return null;
    }
    return byId.get(id) ?? null;
  });

  return {
    hoveredProvinceId,
    selection,
    selectedProvinceId,
    selectedCountryId,
    scope,
    selectedCountry,
    selectedProvince,
  };
}

type TSelectionSlice = ReturnType<typeof createSelectionSlice>;

export { createSelectionSlice, type TSelectionSlice };
