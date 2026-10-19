// The saved document: its shape, a sparse serialiser and a repairing parser. Pure.
// `normalizeState` repairs where `parseManifest` throws. The manifest is a build
// artefact, so a mismatch is a bug. The state is user data, so one bad entry
// must not lose the rest.

const STATE_VERSION = 1;

// Hard ceiling: `buildCountryOf` stores country ids in a `Uint16Array`.
// Id 0 is reserved for `NO_PROVINCE`.
const MAX_COUNTRY_ID = 65535;

const NAME_MAX = 120;
const SLOGAN_MAX = 160;
const LORE_MAX = 8000;
// Characters, not bytes. 600 000 chars of base64 is about 440 KB of image.
const IMAGE_DATA_URL_MAX = 600000;

const DEFAULT_COUNTRY_COLORS: readonly string[] = [
  "#c0563f", "#4f7fb5", "#6f9e57", "#b58b3f",
  "#8a5fa8", "#3f9e96", "#b5566f", "#7a8496",
  "#a3572f", "#3f6f9e", "#8fa03f", "#9e6f3f",
  "#6f5fa8", "#3f8f6f", "#a83f5f", "#5f6f7a",
];

const COLOR_HEX = /^#[0-9a-f]{6}$/i;
const DECIMAL_ID = /^[1-9][0-9]*$/;
const IMAGE_DATA_URL_PREFIX = "data:image/";

type ProvinceOverride = {
  name?: string;
  lore?: string;
  imageDataUrl?: string;
};

type Country = {
  id: number;
  name: string;
  slogan: string;
  lore: string;
  flagDataUrl: string | null;
  provinceIds: number[];
  colorHex: string;
};

// In memory. The country array keeps the user-visible panel order.
type CivitasState = {
  provinceOverrides: Map<number, ProvinceOverride>;
  countries: Country[];
  nextCountryId: number;
};

// On disk. Maps become records keyed by decimal id. `version` is the schema
// version that the migrations read.
type StateDoc = {
  version: number;
  provinceOverrides: { [id: string]: ProvinceOverride };
  countries: Country[];
  nextCountryId: number;
};

type NormalizeResult = {
  state: CivitasState;
  repairs: string[];
};

function isPlainObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampText(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, max);
}

// Only data URLs are valid. The app has no backend, so a remote URL means
// corruption or injection.
function isImageDataUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  if (value.length === 0 || value.length > IMAGE_DATA_URL_MAX) {
    return false;
  }
  return value.startsWith(IMAGE_DATA_URL_PREFIX);
}

function defaultCountryColor(id: number): string {
  const index = Math.abs(Math.trunc(id) - 1) % DEFAULT_COUNTRY_COLORS.length;
  return DEFAULT_COUNTRY_COLORS[index] as string;
}

// Fresh containers on every call, so callers never share a mutable Map.
function createEmptyState(): CivitasState {
  return {
    provinceOverrides: new Map(),
    countries: [],
    nextCountryId: 1,
  };
}

// The name every surface shows. A blank name falls back to "Country <id>".
// No clamp and no trim: `updateCountry` clamps, and trimming would fight the
// user while typing.
function countryDisplayName(id: number, name: string): string {
  if (typeof name !== "string" || name.trim() === "") {
    return "Country " + id;
  }
  return name;
}

function createCountry(id: number, name?: string): Country {
  const requested = name === undefined ? "" : clampText(name, NAME_MAX);
  return {
    id,
    name: countryDisplayName(id, requested),
    slogan: "",
    lore: "",
    flagDataUrl: null,
    provinceIds: [],
    colorHex: defaultCountryColor(id),
  };
}

// Enforces sparsity: a province without override fields is omitted.
// The result shares no references with `state`.
function serializeState(state: CivitasState): StateDoc {
  const provinceOverrides: { [id: string]: ProvinceOverride } = {};
  for (const [id, override] of state.provinceOverrides) {
    const kept: ProvinceOverride = {};
    if (typeof override.name === "string" && override.name !== "") {
      kept.name = override.name;
    }
    if (typeof override.lore === "string" && override.lore !== "") {
      kept.lore = override.lore;
    }
    if (typeof override.imageDataUrl === "string" && override.imageDataUrl !== "") {
      kept.imageDataUrl = override.imageDataUrl;
    }
    if (Object.keys(kept).length > 0) {
      provinceOverrides[String(id)] = kept;
    }
  }

  // Sorted ids make equal assignments stringify identically.
  const countries: Country[] = state.countries.map((country) => {
    return {
      id: country.id,
      name: country.name,
      slogan: country.slogan,
      lore: country.lore,
      flagDataUrl: country.flagDataUrl,
      provinceIds: [...country.provinceIds].sort((a, b) => {
        return a - b;
      }),
      colorHex: country.colorHex,
    };
  });

  return {
    version: STATE_VERSION,
    provinceOverrides,
    countries,
    nextCountryId: state.nextCountryId,
  };
}

function readOverrideRecord(
  raw: unknown,
  state: CivitasState,
  counters: { badKeys: number; badValues: number; badImages: number },
): void {
  if (!isPlainObject(raw)) {
    return;
  }
  // `Object.keys` only, so an inherited or `__proto__` key cannot reach the loop.
  for (const key of Object.keys(raw)) {
    if (!DECIMAL_ID.test(key)) {
      counters.badKeys += 1;
      continue;
    }
    const id = Number(key);
    if (!Number.isSafeInteger(id) || id < 1) {
      counters.badKeys += 1;
      continue;
    }
    const value = raw[key];
    if (!isPlainObject(value)) {
      counters.badValues += 1;
      continue;
    }

    const kept: ProvinceOverride = {};
    if (typeof value.name === "string" && value.name !== "") {
      kept.name = clampText(value.name, NAME_MAX);
    }
    if (typeof value.lore === "string" && value.lore !== "") {
      kept.lore = clampText(value.lore, LORE_MAX);
    }
    if (value.imageDataUrl !== undefined) {
      if (isImageDataUrl(value.imageDataUrl)) {
        kept.imageDataUrl = value.imageDataUrl;
      } else {
        counters.badImages += 1;
      }
    }
    if (Object.keys(kept).length > 0) {
      state.provinceOverrides.set(id, kept);
    }
  }
}

function readCountryList(
  raw: unknown,
  state: CivitasState,
  counters: { badCountries: number; resetColors: number; stolenProvinces: number },
): void {
  if (!Array.isArray(raw)) {
    if (raw !== undefined) {
      counters.badCountries += 1;
    }
    return;
  }

  const seenIds = new Set<number>();
  // Invariant enforced here: one province has at most one owner.
  const claimed = new Set<number>();

  for (const entry of raw) {
    if (!isPlainObject(entry)) {
      counters.badCountries += 1;
      continue;
    }
    const id = entry.id;
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1 || id > MAX_COUNTRY_ID) {
      counters.badCountries += 1;
      continue;
    }
    if (seenIds.has(id)) {
      counters.badCountries += 1;
      continue;
    }
    seenIds.add(id);

    const country = createCountry(id);
    if (typeof entry.name === "string" && entry.name !== "") {
      country.name = clampText(entry.name, NAME_MAX);
    }
    if (typeof entry.slogan === "string") {
      country.slogan = clampText(entry.slogan, SLOGAN_MAX);
    }
    if (typeof entry.lore === "string") {
      country.lore = clampText(entry.lore, LORE_MAX);
    }
    if (isImageDataUrl(entry.flagDataUrl)) {
      country.flagDataUrl = entry.flagDataUrl;
    }
    if (typeof entry.colorHex === "string" && COLOR_HEX.test(entry.colorHex)) {
      country.colorHex = entry.colorHex;
    } else if (entry.colorHex !== undefined) {
      counters.resetColors += 1;
    }

    if (Array.isArray(entry.provinceIds)) {
      const ids: number[] = [];
      for (const candidate of entry.provinceIds) {
        if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate < 1) {
          continue;
        }
        if (claimed.has(candidate)) {
          counters.stolenProvinces += 1;
          continue;
        }
        claimed.add(candidate);
        ids.push(candidate);
      }
      ids.sort((a, b) => {
        return a - b;
      });
      country.provinceIds = ids;
    }

    state.countries.push(country);
  }
}

// Never throws. Repairs and reports each repair.
// Does not read the manifest: state loads at startup before the map does.
// An override for an unknown id is kept and never looked up.
function normalizeState(raw: unknown): NormalizeResult {
  const state = createEmptyState();
  const repairs: string[] = [];

  if (!isPlainObject(raw)) {
    repairs.push("the saved state was not an object");
    return { state, repairs };
  }

  const overrideCounters = { badKeys: 0, badValues: 0, badImages: 0 };
  readOverrideRecord(raw.provinceOverrides, state, overrideCounters);

  const countryCounters = { badCountries: 0, resetColors: 0, stolenProvinces: 0 };
  readCountryList(raw.countries, state, countryCounters);

  let nextCountryId = 1;
  const rawNext = raw.nextCountryId;
  if (typeof rawNext === "number" && Number.isInteger(rawNext) && rawNext >= 1) {
    nextCountryId = Math.min(rawNext, MAX_COUNTRY_ID + 1);
  }
  for (const country of state.countries) {
    if (country.id + 1 > nextCountryId) {
      nextCountryId = country.id + 1;
    }
  }
  state.nextCountryId = nextCountryId;

  // One note per category, not one per bad entry.
  const badOverrides = overrideCounters.badKeys + overrideCounters.badValues;
  if (badOverrides > 0) {
    repairs.push("dropped " + badOverrides + " malformed province overrides");
  }
  if (overrideCounters.badImages > 0) {
    repairs.push("dropped " + overrideCounters.badImages + " invalid province images");
  }
  if (countryCounters.badCountries > 0) {
    repairs.push("dropped " + countryCounters.badCountries + " malformed countries");
  }
  if (countryCounters.resetColors > 0) {
    repairs.push("reset " + countryCounters.resetColors + " country colours");
  }
  if (countryCounters.stolenProvinces > 0) {
    repairs.push("dropped " + countryCounters.stolenProvinces + " duplicate province claims");
  }

  return { state, repairs };
}

export {
  DEFAULT_COUNTRY_COLORS,
  IMAGE_DATA_URL_MAX,
  LORE_MAX,
  MAX_COUNTRY_ID,
  NAME_MAX,
  SLOGAN_MAX,
  STATE_VERSION,
  clampText,
  countryDisplayName,
  createCountry,
  createEmptyState,
  defaultCountryColor,
  isImageDataUrl,
  isPlainObject,
  normalizeState,
  serializeState,
  type CivitasState,
  type Country,
  type NormalizeResult,
  type ProvinceOverride,
  type StateDoc,
};
