import { computed, signal } from "@preact/signals-react";
import type { Country, ProvinceOverride } from "../../domain/index";
import type { StateWarning } from "../../datasource/index";

// The saved document and the status of its storage.
// Actions replace a container instead of mutating it, so that subscribers are notified.

function createWorldSlice() {
  const provinceOverrides = signal<Map<number, ProvinceOverride>>(new Map());
  const countries = signal<Country[]>([]);
  const nextCountryId = signal(1);
  // Only the latest warning is kept: a `quota` warning replaces a `repaired` one.
  const warning = signal<StateWarning | null>(null);
  const bytes = signal(0);
  // False blocks writes: before hydration, with broken storage, or for a document
  // from a newer build. It starts false so nothing is written before `hydrateWorld`.
  const persistent = signal(false);

  const countryById = computed(() => {
    const out = new Map<number, Country>();
    for (const country of countries.value) {
      out.set(country.id, country);
    }
    return out as ReadonlyMap<number, Country>;
  });

  const countryOfProvince = computed(() => {
    const out = new Map<number, number>();
    for (const country of countries.value) {
      for (const provinceId of country.provinceIds) {
        out.set(provinceId, country.id);
      }
    }
    return out as ReadonlyMap<number, number>;
  });

  return {
    provinceOverrides,
    countries,
    nextCountryId,
    warning,
    bytes,
    persistent,
    countryById,
    countryOfProvince,
  };
}

type TWorldSlice = ReturnType<typeof createWorldSlice>;

export { createWorldSlice, type TWorldSlice };
