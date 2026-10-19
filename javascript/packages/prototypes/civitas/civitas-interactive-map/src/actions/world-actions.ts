import { batch } from "@preact/signals-react";
import {
  LORE_MAX,
  MAX_COUNTRY_ID,
  NAME_MAX,
  SLOGAN_MAX,
  clampText,
  createCountry,
  isImageDataUrl,
} from "../domain/index";
import { STORAGE_BUDGET_BYTES } from "../datasource/index";
import type { CivitasState, Country, Migration, ProvinceOverride } from "../domain/index";
import type { TDatasources, WarningKind } from "../datasource/index";
import type { TStore } from "../store/index";

// The world document: countries and province overrides.
// Every change ends in `markDirty`, so writes are debounced in one place.

const COLOR_HEX = /^#[0-9a-f]{6}$/i;

type CountryPatch = Partial<Pick<Country, "name" | "slogan" | "lore" | "flagDataUrl" | "colorHex">>;

function setWarning(store: TStore, kind: WarningKind, message: string): void {
  store.world.warning.value = { kind, message, at: Date.now() };
}

function currentState(store: TStore): CivitasState {
  return {
    provinceOverrides: store.world.provinceOverrides.peek(),
    countries: store.world.countries.peek(),
    nextCountryId: store.world.nextCountryId.peek(),
  };
}

function writeNow(store: TStore, sources: TDatasources): void {
  const result = sources.storage.write(currentState(store));

  if (result.ok) {
    store.world.bytes.value = result.bytes;
    const current = store.world.warning.peek();
    if (current !== null && (current.kind === "quota" || current.kind === "budget")) {
      store.world.warning.value = null;
    }
    if (result.bytes > STORAGE_BUDGET_BYTES) {
      setWarning(
        store,
        "budget",
        "the saved state is " +
          Math.round(result.bytes / 1024) +
          " KB and is close to the browser limit; remove a flag or a province image",
      );
    }
    return;
  }

  if (result.reason === "quota") {
    // Saving stays on, so the next change retries after a delete frees space.
    setWarning(
      store,
      "quota",
      "the save failed: storage is full (~" +
        Math.round(result.bytes / 1024) +
        " KB). Remove a flag or a province image.",
    );
    return;
  }

  // Retrying a broken storage every 400 ms is pointless noise.
  setWarning(store, "unavailable", "the save failed and saving is now off: " + result.message);
  store.world.persistent.value = false;
}

// The `persistent` guard sits here, so no write path can skip it.
function markDirty(store: TStore, sources: TDatasources): void {
  if (!store.world.persistent.peek()) {
    return;
  }
  sources.saveQueue.schedule(() => {
    writeNow(store, sources);
  });
}

// Synchronous, so a panel never sees an un-hydrated store. `chain` is for the migration tests.
function hydrateWorld(
  store: TStore,
  sources: TDatasources,
  options: { chain?: readonly Migration[] } = {},
): void {
  sources.saveQueue.cancel();
  const result = sources.storage.read({ chain: options.chain });
  const available = sources.storage.available;

  batch(() => {
    store.world.provinceOverrides.value = result.state.provinceOverrides;
    store.world.countries.value = result.state.countries;
    store.world.nextCountryId.value = result.state.nextCountryId;
    store.world.bytes.value = result.bytes;
    store.world.persistent.value = result.writable && available;
    if (available) {
      store.world.warning.value = result.warning;
    } else {
      store.world.warning.value = {
        kind: "unavailable",
        message: "browser storage is unavailable; changes are kept for this session only",
        at: Date.now(),
      };
    }
  });
}

// The page calls it when the tab is hidden.
function flushWorld(_store: TStore, sources: TDatasources): void {
  sources.saveQueue.flush();
}

function dismissStateWarning(store: TStore): void {
  if (store.world.warning.peek() === null) {
    return;
  }
  store.world.warning.value = null;
}

// --- province overrides ---------------------------------------------------

// Three setters instead of one patch, so a panel never deals with an
// undefined-versus-null tri-state.
function writeOverrideField(
  store: TStore,
  sources: TDatasources,
  id: number,
  field: "name" | "lore" | "imageDataUrl",
  value: string | undefined,
): void {
  // Id 0 is `NO_PROVINCE`.
  if (!Number.isInteger(id) || id < 1) {
    return;
  }

  const map = store.world.provinceOverrides.peek();
  const current = map.get(id) ?? null;
  const existing = current === null ? undefined : current[field];
  // A no-op keystroke writes nothing and arms no timer.
  if (existing === value) {
    return;
  }

  const merged: ProvinceOverride = current === null ? {} : { ...current };
  if (value === undefined) {
    delete merged[field];
  } else {
    merged[field] = value;
  }

  const next = new Map(map);
  // An emptied override is deleted, so the document stays sparse.
  if (merged.name === undefined && merged.lore === undefined && merged.imageDataUrl === undefined) {
    next.delete(id);
  } else {
    next.set(id, merged);
  }

  store.world.provinceOverrides.value = next;
  markDirty(store, sources);
}

// An empty name removes the override, so the manifest name comes back.
function setProvinceName(store: TStore, sources: TDatasources, id: number, name: string): void {
  const trimmedToCap = typeof name === "string" ? clampText(name, NAME_MAX) : "";
  writeOverrideField(store, sources, id, "name", trimmedToCap === "" ? undefined : trimmedToCap);
}

function setProvinceLore(store: TStore, sources: TDatasources, id: number, lore: string): void {
  const capped = typeof lore === "string" ? clampText(lore, LORE_MAX) : "";
  writeOverrideField(store, sources, id, "lore", capped === "" ? undefined : capped);
}

// A rejected image is ignored silently: the caller has already validated it.
function setProvinceImage(
  store: TStore,
  sources: TDatasources,
  id: number,
  dataUrl: string | null,
): void {
  if (dataUrl === null || dataUrl === "") {
    writeOverrideField(store, sources, id, "imageDataUrl", undefined);
    return;
  }
  if (!isImageDataUrl(dataUrl)) {
    return;
  }
  writeOverrideField(store, sources, id, "imageDataUrl", dataUrl);
}

function clearProvinceOverride(store: TStore, sources: TDatasources, id: number): void {
  const map = store.world.provinceOverrides.peek();
  if (!map.has(id)) {
    return;
  }
  const next = new Map(map);
  next.delete(id);
  store.world.provinceOverrides.value = next;
  markDirty(store, sources);
}

// --- countries ------------------------------------------------------------

function addCountry(store: TStore, sources: TDatasources, name?: string): Country {
  const list = store.world.countries.peek();
  let id = store.world.nextCountryId.peek();

  if (id > MAX_COUNTRY_ID) {
    setWarning(store, "quota", "the country limit of " + MAX_COUNTRY_ID + " has been reached");
    const last = list[list.length - 1];
    if (last !== undefined) {
      return last;
    }
    // A hostile document can have a huge `nextCountryId` and no countries.
    id = MAX_COUNTRY_ID;
  }

  const country = createCountry(id, name);
  batch(() => {
    store.world.countries.value = [...list, country];
    store.world.nextCountryId.value = Math.min(id + 1, MAX_COUNTRY_ID + 1);
  });
  markDirty(store, sources);
  return country;
}

// An invalid `colorHex` is ignored, so a half-typed `#ab` keeps the old colour.
function updateCountry(
  store: TStore,
  sources: TDatasources,
  id: number,
  patch: CountryPatch,
): void {
  const list = store.world.countries.peek();
  const at = list.findIndex((country) => {
    return country.id === id;
  });
  if (at < 0) {
    return;
  }

  const current = list[at] as Country;
  // `provinceIds` keeps its identity: the label anchor cache keys on it, so a
  // rename does not re-run the anchor search.
  const next: Country = { ...current };
  let changed = false;

  if (typeof patch.name === "string") {
    const value = clampText(patch.name, NAME_MAX);
    if (value !== current.name) {
      next.name = value;
      changed = true;
    }
  }
  if (typeof patch.slogan === "string") {
    const value = clampText(patch.slogan, SLOGAN_MAX);
    if (value !== current.slogan) {
      next.slogan = value;
      changed = true;
    }
  }
  if (typeof patch.lore === "string") {
    const value = clampText(patch.lore, LORE_MAX);
    if (value !== current.lore) {
      next.lore = value;
      changed = true;
    }
  }
  if (patch.flagDataUrl !== undefined) {
    if (patch.flagDataUrl === null || patch.flagDataUrl === "") {
      if (current.flagDataUrl !== null) {
        next.flagDataUrl = null;
        changed = true;
      }
    } else if (isImageDataUrl(patch.flagDataUrl) && patch.flagDataUrl !== current.flagDataUrl) {
      next.flagDataUrl = patch.flagDataUrl;
      changed = true;
    }
  }
  if (typeof patch.colorHex === "string" && COLOR_HEX.test(patch.colorHex)) {
    if (patch.colorHex !== current.colorHex) {
      next.colorHex = patch.colorHex;
      changed = true;
    }
  }

  if (!changed) {
    return;
  }

  const copy = [...list];
  copy[at] = next;
  store.world.countries.value = copy;
  markDirty(store, sources);
}

// Province overrides stay, so user lore survives the deletion.
function deleteCountry(store: TStore, sources: TDatasources, id: number): void {
  const list = store.world.countries.peek();
  const kept = list.filter((country) => {
    return country.id !== id;
  });
  if (kept.length === list.length) {
    return;
  }

  store.world.countries.value = kept;
  markDirty(store, sources);
}

function sameIds(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let at = 0; at < left.length; at += 1) {
    if (left[at] !== right[at]) {
      return false;
    }
  }
  return true;
}

// The single writer of `provinceIds`; it keeps the one-owner invariant.
// `countryId === null` unassigns.
function assignProvinces(
  store: TStore,
  sources: TDatasources,
  countryId: number | null,
  provinceIds: readonly number[],
): void {
  const wanted = new Set<number>();
  for (const id of provinceIds) {
    if (Number.isInteger(id) && id >= 1) {
      wanted.add(id);
    }
  }
  if (wanted.size === 0) {
    return;
  }

  const list = store.world.countries.peek();
  let changed = false;

  const next = list.map((country) => {
    const kept = country.provinceIds.filter((id) => {
      return !wanted.has(id);
    });

    if (countryId !== null && country.id === countryId) {
      const merged = [...kept, ...wanted].sort((a, b) => {
        return a - b;
      });
      if (sameIds(merged, country.provinceIds)) {
        return country;
      }
      changed = true;
      return { ...country, provinceIds: merged };
    }

    if (kept.length === country.provinceIds.length) {
      return country;
    }
    changed = true;
    return { ...country, provinceIds: kept };
  });

  if (!changed) {
    return;
  }
  store.world.countries.value = next;
  markDirty(store, sources);
}

export {
  addCountry,
  assignProvinces,
  clearProvinceOverride,
  deleteCountry,
  dismissStateWarning,
  flushWorld,
  hydrateWorld,
  setProvinceImage,
  setProvinceLore,
  setProvinceName,
  updateCountry,
  type CountryPatch,
};
