import { computed, signal } from "@preact/signals-react";
import type {
  Country,
  CountryInfo,
} from "../../domain/index";

// The countries from `assets/countries.json` and their info from
// `assets/countries-info.json`. `loadMap` writes both once.

function createWorldSlice() {
  const countries = signal<Country[]>([]);
  // Keyed by country id. A country without an entry has no info yet.
  const info = signal<ReadonlyMap<number, CountryInfo>>(new Map());
  // What the parsers of both files repaired, as one sentence. `null` for clean files.
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
    info,
    notice,
    countryById,
    countryOfProvince,
  };
}

type TWorldSlice = ReturnType<typeof createWorldSlice>;

export { createWorldSlice, type TWorldSlice };
