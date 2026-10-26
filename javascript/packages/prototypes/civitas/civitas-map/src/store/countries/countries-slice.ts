import { computed, signal } from "@preact/signals-react";
import {
  ownerOf,
  type Country,
  type StrokeAction,
} from "../../domain/index";

// The countries, the country a click on the map paints with, and the open
// stroke over provinces.

type CountryStroke = {
  countryId: number;
  action: StrokeAction;
  // Provinces the stroke has passed over. Nothing renders from it, so the set
  // is changed in place.
  visited: Set<number>;
};

function createCountriesSlice() {
  const list = signal<readonly Country[]>([]);
  const activeId = signal<number | null>(null);
  // The id the next new country gets.
  const nextId = signal(1);
  const stroke = signal<CountryStroke | null>(null);

  const active = computed(() => {
    const id = activeId.value;

    if (id === null) {
      return null;
    }

    return list.value.find((country) => country.id === id) ?? null;
  });

  // Province id -> the id of the country that owns it.
  const owners = computed(() => {
    return ownerOf(list.value) as ReadonlyMap<number, number>;
  });

  return { list, activeId, nextId, stroke, active, owners };
}

type TCountriesSlice = ReturnType<typeof createCountriesSlice>;

export {
  createCountriesSlice,
  type CountryStroke,
  type TCountriesSlice,
};
