import { computed, signal } from "@preact/signals-react";
import type { Country } from "../../domain/index";

// The countries from `assets/countries.json`. `loadMap` writes them once.

function createWorldSlice() {
  const countries = signal<Country[]>([]);
  // What the countries parser repaired, as one sentence. `null` for a clean file.
  const notice = signal<string | null>(null);

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
    countries,
    notice,
    countryById,
    countryOfProvince,
  };
}

type TWorldSlice = ReturnType<typeof createWorldSlice>;

export { createWorldSlice, type TWorldSlice };
