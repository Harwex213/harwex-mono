import { batch } from "@preact/signals-react";
import {
  assignProvinces,
  createCountry,
  nextCountryIdAfter,
  strokeActionFor,
  type Country,
} from "../../domain/index";
import type { TStore } from "../../store/index";

// The countries: the registry, and the strokes that put provinces into a
// country or take them out. Coordinates are map pixels. A province belongs to
// at most one country; `assignProvinces` in the domain keeps that rule.

const COLOR_HEX = /^#[0-9a-f]{6}$/i;

function addCountry(store: TStore): void {
  const countries = store.countries;
  const country = createCountry(countries.nextId.value);

  batch(() => {
    countries.nextId.value = country.id + 1;
    countries.list.value = [...countries.list.value, country];
    countries.activeId.value = country.id;
  });
}

function selectCountry(store: TStore, id: number): void {
  store.countries.activeId.value = id;
}

function updateCountry(store: TStore, id: number, patch: Partial<Pick<Country, "name" | "colorHex">>): void {
  store.countries.list.value = store.countries.list.value.map((country) => {
    if (country.id !== id) {
      return country;
    }

    return { ...country, ...patch };
  });
}

function renameCountry(store: TStore, id: number, name: string): void {
  updateCountry(store, id, { name });
}

// A half-typed colour is ignored, so the country keeps its old one.
function recolorCountry(store: TStore, id: number, colorHex: string): void {
  if (!COLOR_HEX.test(colorHex)) {
    return;
  }

  updateCountry(store, id, { colorHex: colorHex.toLowerCase() });
}

// The provinces of a deleted country become unassigned.
function deleteCountry(store: TStore, id: number): void {
  const countries = store.countries;
  const kept = countries.list.value.filter((country) => country.id !== id);

  if (kept.length === countries.list.value.length) {
    return;
  }

  batch(() => {
    countries.list.value = kept;

    if (countries.activeId.value === id) {
      countries.activeId.value = kept.at(-1)?.id ?? null;
    }
  });
}

// Replaces every country, for a new map, a detection or an import.
function replaceCountries(store: TStore, list: readonly Country[]): void {
  batch(() => {
    store.countries.list.value = list;
    store.countries.nextId.value = nextCountryIdAfter(list);
    store.countries.activeId.value = list[0]?.id ?? null;
    store.countries.stroke.value = null;
  });
}

// The province painted at `(x, y)`, or null.
function provinceIdAt(store: TStore, x: number, y: number): number | null {
  const layer = store.map.layer.value;

  if (!layer || !layer.contains(x, y)) {
    return null;
  }

  return store.provinces.byColor.value.get(layer.pixelAt(x, y))?.id ?? null;
}

function applyStroke(store: TStore, provinceIds: readonly number[]): void {
  const stroke = store.countries.stroke.value;

  if (!stroke || provinceIds.length === 0) {
    return;
  }

  store.countries.list.value = assignProvinces(
    store.countries.list.value,
    stroke.action === "assign" ? stroke.countryId : null,
    provinceIds,
  );
}

// Opens a stroke at `(x, y)`. What the stroke does is decided here, once: see
// `strokeActionFor`. False when nothing was started: no map, a press outside
// it, or no country to assign to.
function beginCountryStroke(store: TStore, x: number, y: number, erasing: boolean): boolean {
  const layer = store.map.layer.value;

  if (!layer || !layer.contains(x, y)) {
    return false;
  }

  const country = store.countries.active.value;

  if (!country && !erasing) {
    store.status.error.value = "Add a country before assigning provinces";

    return false;
  }

  const provinceId = provinceIdAt(store, x, y);
  const countryId = country?.id ?? 0;
  const action = strokeActionFor(provinceId, countryId, store.countries.owners.value, erasing);

  batch(() => {
    store.countries.stroke.value = { countryId, action, visited: new Set() };

    if (provinceId !== null) {
      store.countries.stroke.value.visited.add(provinceId);
      applyStroke(store, [provinceId]);
    }
  });

  return true;
}

// Pointer samples skip pixels on a fast drag, so the provinces along the whole
// segment are collected, not only the one under the new sample.
function extendCountryStroke(store: TStore, from: { x: number; y: number }, to: { x: number; y: number }): void {
  const stroke = store.countries.stroke.value;

  if (!stroke) {
    return;
  }

  const steps = Math.max(1, Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  const fresh: number[] = [];

  for (let step = 1; step <= steps; step += 1) {
    const x = Math.round(from.x + ((to.x - from.x) * step) / steps);
    const y = Math.round(from.y + ((to.y - from.y) * step) / steps);
    const provinceId = provinceIdAt(store, x, y);

    if (provinceId !== null && !stroke.visited.has(provinceId)) {
      stroke.visited.add(provinceId);
      fresh.push(provinceId);
    }
  }

  applyStroke(store, fresh);
}

function endCountryStroke(store: TStore): void {
  store.countries.stroke.value = null;
}

export {
  addCountry,
  beginCountryStroke,
  deleteCountry,
  endCountryStroke,
  extendCountryStroke,
  recolorCountry,
  renameCountry,
  replaceCountries,
  selectCountry,
};
