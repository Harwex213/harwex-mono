import { batch, computed, signal } from "@preact/signals-react";
import { buildCountryOf } from "../map/borders";
import { provinceById } from "./map-store";
import {
  STORAGE_BUDGET_BYTES,
  createMemoryStorage,
  createStateWriter,
  defaultStorage,
  readState,
  writeState,
} from "./persistence";
import {
  LORE_MAX,
  MAX_COUNTRY_ID,
  MAX_JSON_DEPTH,
  NAME_MAX,
  SLOGAN_MAX,
  clampText,
  createCountry,
  isImageDataUrl,
  sanitizeRecord,
} from "./schema";
import type { Migration } from "./migrations";
import type { StateStorage, StateWarning, StateWriter, Timers, WarningKind } from "./persistence";
import type {
  CivitasState,
  Country,
  CountryEconomics,
  JsonRecord,
  ProvinceOverride,
} from "./schema";
import type { ReadonlySignal } from "@preact/signals-react";

// The signals, the actions, and the wiring that turns a mutation into a
// debounced write. The only file in `src/state` besides the T02-T04 stores that
// imports `@preact/signals-react`.
//
// Every exported signal is a `computed` over a private writable one. An action
// is therefore the only way to change state, which is what makes it impossible
// for a mutation to bypass `markDirty()`.
//
// Every action REPLACES its container instead of mutating it. A `Map` mutated in
// place is `Object.is`-equal to itself and no subscriber ever re-renders.

const COLOR_HEX = /^#[0-9a-f]{6}$/i;

type WorldStoreOptions = {
  storage?: StateStorage;
  timers?: Timers;
  debounceMs?: number;
  chain?: readonly Migration[];
};

type CountryPatch = Partial<Pick<Country, "name" | "slogan" | "lore" | "flagDataUrl" | "colorHex">>;

const overridesSignal = signal<Map<number, ProvinceOverride>>(new Map());
const countriesSignal = signal<Country[]>([]);
const economicsSignal = signal<Map<number, CountryEconomics>>(new Map());
const nextIdSignal = signal(1);
const warningSignal = signal<StateWarning | null>(null);
const bytesSignal = signal(0);
const persistentSignal = signal(true);

const provinceOverrides: ReadonlySignal<ReadonlyMap<number, ProvinceOverride>> = computed(() => {
  return overridesSignal.value;
});
const countries: ReadonlySignal<readonly Country[]> = computed(() => {
  return countriesSignal.value;
});
const economics: ReadonlySignal<ReadonlyMap<number, CountryEconomics>> = computed(() => {
  return economicsSignal.value;
});
const nextCountryId: ReadonlySignal<number> = computed(() => {
  return nextIdSignal.value;
});
const stateWarning: ReadonlySignal<StateWarning | null> = computed(() => {
  return warningSignal.value;
});
const stateBytes: ReadonlySignal<number> = computed(() => {
  return bytesSignal.value;
});
const statePersistent: ReadonlySignal<boolean> = computed(() => {
  return persistentSignal.value;
});

const countryById: ReadonlySignal<ReadonlyMap<number, Country>> = computed(() => {
  const out = new Map<number, Country>();
  for (const country of countriesSignal.value) {
    out.set(country.id, country);
  }
  return out;
});

const countryOfProvince: ReadonlySignal<ReadonlyMap<number, number>> = computed(() => {
  const out = new Map<number, number>();
  for (const country of countriesSignal.value) {
    for (const provinceId of country.provinceIds) {
      out.set(provinceId, country.id);
    }
  }
  return out;
});

// A memory storage until `initWorldStore` runs, so importing this module has no
// side effect on `localStorage` and a mutation before init cannot write.
let storage: StateStorage = createMemoryStorage();
let writer: StateWriter | null = null;
let storageAvailable = false;

function setWarning(kind: WarningKind, message: string): void {
  // Only the latest warning is kept: a `quota` warning replaces a `repaired` one.
  warningSignal.value = { kind, message, at: Date.now() };
}

function dismissStateWarning(): void {
  if (warningSignal.value === null) {
    return;
  }
  warningSignal.value = null;
}

// Four signals rather than one state object, because four give four
// independently subscribable slices.
function currentState(): CivitasState {
  return {
    provinceOverrides: overridesSignal.value,
    countries: countriesSignal.value,
    economics: economicsSignal.value,
    nextCountryId: nextIdSignal.value,
  };
}

function writeNow(): void {
  const result = writeState(storage, currentState());

  if (result.ok) {
    bytesSignal.value = result.bytes;
    const current = warningSignal.value;
    if (current !== null && (current.kind === "quota" || current.kind === "budget")) {
      warningSignal.value = null;
    }
    if (result.bytes > STORAGE_BUDGET_BYTES) {
      setWarning(
        "budget",
        "the saved state is " +
          Math.round(result.bytes / 1024) +
          " KB and is close to the browser limit; remove a flag or a province image",
      );
    }
    return;
  }

  if (result.reason === "quota") {
    // The in-memory state is untouched and `persistent` stays true, so the next
    // dirty mark retries — a later delete may free the space.
    setWarning(
      "quota",
      "the save failed: storage is full (~" +
        Math.round(result.bytes / 1024) +
        " KB). Remove a flag or a province image.",
    );
    return;
  }

  // Retrying a broken storage every 400 ms is pointless noise.
  setWarning("unavailable", "the save failed and saving is now off: " + result.message);
  persistentSignal.value = false;
}

// Every action ends here. It is `writer.schedule()` plus the read-only guard, so
// a future-version document is never overwritten.
function markDirty(): void {
  if (writer === null) {
    return;
  }
  if (!persistentSignal.peek()) {
    return;
  }
  writer.schedule();
}

// The dependency-injection seam. Production calls it with no arguments; every
// test calls it with a fake storage and fake timers, and that call is also the
// reset between tests.
function initWorldStore(options: WorldStoreOptions = {}): StateWarning | null {
  // A re-init must not let the previous document's pending write land in the
  // new storage.
  if (writer !== null) {
    writer.cancel();
    writer = null;
  }

  if (options.storage) {
    storage = options.storage;
    storageAvailable = true;
  } else {
    const found = defaultStorage();
    storage = found.storage;
    storageAvailable = found.available;
  }

  const result = readState(storage, { chain: options.chain });

  batch(() => {
    overridesSignal.value = result.state.provinceOverrides;
    countriesSignal.value = result.state.countries;
    economicsSignal.value = result.state.economics;
    nextIdSignal.value = result.state.nextCountryId;
    bytesSignal.value = result.bytes;
    persistentSignal.value = result.writable && storageAvailable;
    if (storageAvailable) {
      warningSignal.value = result.warning;
    } else {
      warningSignal.value = {
        kind: "unavailable",
        message: "browser storage is unavailable; changes are kept for this session only",
        at: Date.now(),
      };
    }
  });

  writer = createStateWriter({
    write: writeNow,
    delayMs: options.debounceMs,
    timers: options.timers,
  });

  return warningSignal.peek();
}

function flushState(): void {
  if (writer === null) {
    return;
  }
  writer.flush();
}

// `visibilitychange` as well as `pagehide`, because iOS Safari can kill a
// backgrounded tab without ever firing `pagehide`.
function installStateFlush(): () => void {
  if (typeof window === "undefined") {
    return () => {
      // Nothing to uninstall outside a browser.
    };
  }

  const onPageHide = (): void => {
    try {
      flushState();
    } catch {
      // Never throw during unload.
    }
  };
  const onVisibility = (): void => {
    if (document.visibilityState !== "hidden") {
      return;
    }
    onPageHide();
  };

  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

// --- province overrides ---------------------------------------------------

// Three explicit setters rather than one patch object: a patch needs `undefined`
// to mean "leave alone" and `null` to mean "clear", and that tri-state is
// exactly the thing a panel gets wrong.
function writeOverrideField(
  id: number,
  field: "name" | "lore" | "imageDataUrl",
  value: string | undefined,
): void {
  // Id 0 is `NO_PROVINCE`. `Number.isInteger` is false for NaN and Infinity.
  if (!Number.isInteger(id) || id < 1) {
    return;
  }

  const map = overridesSignal.value;
  const current = map.get(id) ?? null;
  const existing = current === null ? undefined : current[field];
  // No signal write, no `markDirty`, no debounce timer for a no-op keystroke.
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
  // Deleting an emptied override is what keeps the document sparse over a long
  // session of edit-then-undo.
  if (merged.name === undefined && merged.lore === undefined && merged.imageDataUrl === undefined) {
    next.delete(id);
  } else {
    next.set(id, merged);
  }

  overridesSignal.value = next;
  markDirty();
}

// An empty name removes the override, so the manifest name comes back rather
// than an empty label.
function setProvinceName(id: number, name: string): void {
  const trimmedToCap = typeof name === "string" ? clampText(name, NAME_MAX) : "";
  writeOverrideField(id, "name", trimmedToCap === "" ? undefined : trimmedToCap);
}

function setProvinceLore(id: number, lore: string): void {
  const capped = typeof lore === "string" ? clampText(lore, LORE_MAX) : "";
  writeOverrideField(id, "lore", capped === "" ? undefined : capped);
}

// A rejected image sets no field and raises no warning: the caller already
// validated it through `downscaleImage`.
function setProvinceImage(id: number, dataUrl: string | null): void {
  if (dataUrl === null || dataUrl === "") {
    writeOverrideField(id, "imageDataUrl", undefined);
    return;
  }
  if (!isImageDataUrl(dataUrl)) {
    return;
  }
  writeOverrideField(id, "imageDataUrl", dataUrl);
}

function clearProvinceOverride(id: number): void {
  const map = overridesSignal.value;
  if (!map.has(id)) {
    return;
  }
  const next = new Map(map);
  next.delete(id);
  overridesSignal.value = next;
  markDirty();
}

function provinceOverrideOf(id: number): ProvinceOverride | null {
  return overridesSignal.value.get(id) ?? null;
}

// The layering function every panel and T07's labels use. `provinceById` returns
// `null` until the map load finishes, and the last fallback covers that window.
function provinceDisplayName(id: number): string {
  const override = overridesSignal.value.get(id);
  if (override && override.name !== undefined && override.name !== "") {
    return override.name;
  }
  const province = provinceById(id);
  if (province) {
    return province.name;
  }
  return "Province " + id;
}

// --- countries ------------------------------------------------------------

function addCountry(name?: string): Country {
  const list = countriesSignal.value;
  let id = nextIdSignal.value;

  if (id > MAX_COUNTRY_ID) {
    setWarning("quota", "the country limit of " + MAX_COUNTRY_ID + " has been reached");
    const last = list[list.length - 1];
    if (last !== undefined) {
      return last;
    }
    // A hostile document can carry a huge `nextCountryId` with no countries at
    // all. Fall back to the last legal id rather than returning nothing.
    id = MAX_COUNTRY_ID;
  }

  const country = createCountry(id, name);
  batch(() => {
    countriesSignal.value = [...list, country];
    nextIdSignal.value = Math.min(id + 1, MAX_COUNTRY_ID + 1);
  });
  markDirty();
  return country;
}

// An invalid `colorHex` is ignored rather than replaced, so a half-typed `#ab`
// in a colour box does not blank the country's colour.
function updateCountry(id: number, patch: CountryPatch): void {
  const list = countriesSignal.value;
  const at = list.findIndex((country) => {
    return country.id === id;
  });
  if (at < 0) {
    return;
  }

  const current = list[at] as Country;
  // `provinceIds` is NOT copied. `assignProvinces` is the only writer and it
  // always builds a fresh array, so a copy here defends against nothing — and
  // `label-store.ts` validates its anchor cache on this array's IDENTITY. With
  // a copy, every keystroke in a country name re-ran `resolveLabelAnchor`, up to
  // 1728 `contains` probes. T08 makes renaming a per-keystroke operation, so the
  // difference is load bearing.
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
  countriesSignal.value = copy;
  markDirty();
}

// Province overrides are NOT touched. The lore a user wrote survives the country
// being deleted.
function deleteCountry(id: number): void {
  const list = countriesSignal.value;
  const kept = list.filter((country) => {
    return country.id !== id;
  });
  if (kept.length === list.length) {
    return;
  }

  batch(() => {
    countriesSignal.value = kept;
    if (economicsSignal.value.has(id)) {
      const nextEconomics = new Map(economicsSignal.value);
      nextEconomics.delete(id);
      economicsSignal.value = nextEconomics;
    }
  });
  markDirty();
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

// The single entry point that keeps the one-owner invariant, and what T06's
// paint mode calls. `countryId === null` unassigns.
function assignProvinces(countryId: number | null, provinceIds: readonly number[]): void {
  const wanted = new Set<number>();
  for (const id of provinceIds) {
    if (Number.isInteger(id) && id >= 1) {
      wanted.add(id);
    }
  }
  if (wanted.size === 0) {
    return;
  }

  const list = countriesSignal.value;
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
  countriesSignal.value = next;
  markDirty();
}

// T05 stops here. T06 owns the effect that pushes this array to
// `setCountryAssignment` in `borders-store.ts`; this function exists so T06 does
// not invent a second copy of the conversion.
function buildCountryAssignment(maxProvinceId: number): Uint16Array {
  return buildCountryOf(countryOfProvince.value, maxProvinceId);
}

// --- economics ------------------------------------------------------------

function economicsOf(countryId: number): CountryEconomics | null {
  return economicsSignal.value.get(countryId) ?? null;
}

function hasCountry(countryId: number): boolean {
  return countriesSignal.value.some((country) => {
    return country.id === countryId;
  });
}

// An orphan slot is data `normalizeState` would drop on the next load anyway.
function setCountryEconomics(countryId: number, data: JsonRecord): void {
  if (!hasCountry(countryId)) {
    return;
  }
  const current = economicsSignal.value.get(countryId);
  const next = new Map(economicsSignal.value);
  next.set(countryId, {
    version: current ? current.version : 1,
    // A panel that hands over a `NaN` from a half-typed number input cannot make
    // the document unserialisable.
    data: sanitizeRecord(data, MAX_JSON_DEPTH),
  });
  economicsSignal.value = next;
  markDirty();
}

function patchCountryEconomics(countryId: number, patch: JsonRecord): void {
  if (!hasCountry(countryId)) {
    return;
  }
  const current = economicsSignal.value.get(countryId);
  const merged: JsonRecord = { ...(current ? current.data : {}) };
  const clean = sanitizeRecord(patch, MAX_JSON_DEPTH);
  for (const key of Object.keys(clean)) {
    merged[key] = clean[key];
  }

  const next = new Map(economicsSignal.value);
  next.set(countryId, {
    version: current ? current.version : 1,
    data: merged,
  });
  economicsSignal.value = next;
  markDirty();
}

export {
  addCountry,
  assignProvinces,
  buildCountryAssignment,
  clearProvinceOverride,
  countries,
  countryById,
  countryOfProvince,
  deleteCountry,
  dismissStateWarning,
  economics,
  economicsOf,
  flushState,
  initWorldStore,
  installStateFlush,
  nextCountryId,
  patchCountryEconomics,
  provinceDisplayName,
  provinceOverrideOf,
  provinceOverrides,
  setCountryEconomics,
  setProvinceImage,
  setProvinceLore,
  setProvinceName,
  stateBytes,
  statePersistent,
  stateWarning,
  updateCountry,
  type CountryPatch,
  type WorldStoreOptions,
};
