// The document shape, the serialiser that keeps it sparse, and the repairing
// parser that reads it back. Pure: no DOM, no signals, no storage.
//
// `normalizeState` REPAIRS where `parseManifest` THROWS, and that difference is
// deliberate. The manifest is a build artefact, so a mismatch there is a bug and
// must be loud. This document is user data that a browser, an extension or an
// older build may have damaged, and losing one malformed province override must
// not lose the other forty.

const STATE_VERSION = 1;

// A country id indexes a `Uint16Array` in `buildCountryOf` (`src/map/borders.ts`),
// so 65535 is a hard ceiling, not a style choice. Id 0 is reserved: index 0 of
// that array is `NO_PROVINCE`.
const MAX_COUNTRY_ID = 65535;

const NAME_MAX = 120;
const SLOGAN_MAX = 160;
const LORE_MAX = 8000;
// Characters, not bytes. 600 000 chars of base64 is about 440 KB of image.
const IMAGE_DATA_URL_MAX = 600000;
const MAX_JSON_DEPTH = 8;

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

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type JsonRecord = { [key: string]: JsonValue };

// Loose on purpose. T11 defines the real field set and T12 renders it. Until
// then anything JSON-safe survives a round trip untouched.
type CountryEconomics = {
  version: number;
  data: JsonRecord;
};

// In memory. Maps for the sparse keyed data, an array for the ordered country
// list — the country order is user-visible in T06's panel, and an array IS that
// order.
type CivitasState = {
  provinceOverrides: Map<number, ProvinceOverride>;
  countries: Country[];
  economics: Map<number, CountryEconomics>;
  nextCountryId: number;
};

// On disk. The `Map`s become records keyed by the decimal id, because JSON has
// no map. `version` is the SCHEMA version and is what the migrations read.
type StateDoc = {
  version: number;
  provinceOverrides: { [id: string]: ProvinceOverride };
  countries: Country[];
  economics: { [id: string]: CountryEconomics };
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

// A remote URL in a stored document is either corruption or an injection
// attempt: the app has no backend, so every image it ever wrote is a data URL.
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

// Fresh containers on every call. A shared module-level empty Map would be
// mutated by the first caller and inherited by the next.
function createEmptyState(): CivitasState {
  return {
    provinceOverrides: new Map(),
    countries: [],
    economics: new Map(),
    nextCountryId: 1,
  };
}

function createCountry(id: number, name?: string): Country {
  return {
    id,
    name: name === undefined || name === "" ? "Country " + id : clampText(name, NAME_MAX),
    slogan: "",
    lore: "",
    flagDataUrl: null,
    provinceIds: [],
    colorHex: defaultCountryColor(id),
  };
}

// Returns `undefined` for anything that cannot survive
// `JSON.stringify` -> `JSON.parse` unchanged, and for anything nested past
// `depth`. Objects and arrays are rebuilt, so a cycle cannot escape and an
// inherited key cannot enter.
function sanitizeJson(value: unknown, depth: number): JsonValue | undefined {
  if (value === null) {
    return null;
  }
  const kind = typeof value;
  if (kind === "string" || kind === "boolean") {
    return value as string | boolean;
  }
  if (kind === "number") {
    return Number.isFinite(value as number) ? (value as number) : undefined;
  }
  if (kind !== "object") {
    return undefined;
  }
  if (depth <= 0) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const out: JsonValue[] = [];
    for (const entry of value) {
      const clean = sanitizeJson(entry, depth - 1);
      if (clean !== undefined) {
        out.push(clean);
      }
    }
    return out;
  }
  if (!isPlainObject(value)) {
    return undefined;
  }
  return sanitizeRecord(value, depth);
}

function sanitizeRecord(value: unknown, depth: number): JsonRecord {
  const out: JsonRecord = {};
  if (!isPlainObject(value) || depth <= 0) {
    return out;
  }
  for (const key of Object.keys(value)) {
    const clean = sanitizeJson(value[key], depth - 1);
    if (clean !== undefined) {
      out[key] = clean;
    }
  }
  return out;
}

// Where sparsity is enforced. A province with no surviving override field is
// omitted from the document entirely — 1648 provinces must never all be written.
// Nothing returned here is a reference into `state`.
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

  // The sort is not cosmetic. It makes two states that reached the same
  // assignment stringify identically, which is what lets the round-trip test be
  // an equality test.
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

  const economics: { [id: string]: CountryEconomics } = {};
  for (const [countryId, slot] of state.economics) {
    economics[String(countryId)] = {
      version: slot.version,
      data: sanitizeRecord(slot.data, MAX_JSON_DEPTH),
    };
  }

  return {
    version: STATE_VERSION,
    provinceOverrides,
    countries,
    economics,
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
  // One province has at most one owner. The invariant is enforced here so that
  // no consumer downstream has to check it.
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

function readEconomicsRecord(
  raw: unknown,
  state: CivitasState,
  counters: { droppedEconomics: number },
): void {
  if (!isPlainObject(raw)) {
    return;
  }
  const known = new Set(state.countries.map((country) => {
    return country.id;
  }));

  for (const key of Object.keys(raw)) {
    if (!DECIMAL_ID.test(key)) {
      counters.droppedEconomics += 1;
      continue;
    }
    const id = Number(key);
    // A slot without a country is unreachable data.
    if (!known.has(id)) {
      counters.droppedEconomics += 1;
      continue;
    }
    const value = raw[key];
    if (!isPlainObject(value)) {
      counters.droppedEconomics += 1;
      continue;
    }
    const rawVersion = value.version;
    const version =
      typeof rawVersion === "number" && Number.isInteger(rawVersion) && rawVersion >= 1
        ? rawVersion
        : 1;
    state.economics.set(id, {
      version,
      data: sanitizeRecord(value.data, MAX_JSON_DEPTH),
    });
  }
}

// Never throws. Repairs rather than rejects, and reports what it repaired.
//
// It must NOT read the manifest: state is read synchronously at startup while
// the map load is still in flight, so `provinceById` returns `null` then. An
// override for an id the manifest does not carry is kept and simply never
// looked up.
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

  const economicsCounters = { droppedEconomics: 0 };
  readEconomicsRecord(raw.economics, state, economicsCounters);

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

  // Aggregated by category. A document with 1000 bad keys must not build a
  // 1000-entry array of notes.
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
  if (economicsCounters.droppedEconomics > 0) {
    repairs.push("dropped " + economicsCounters.droppedEconomics + " orphan economics slots");
  }

  return { state, repairs };
}

export {
  DEFAULT_COUNTRY_COLORS,
  IMAGE_DATA_URL_MAX,
  LORE_MAX,
  MAX_COUNTRY_ID,
  MAX_JSON_DEPTH,
  NAME_MAX,
  SLOGAN_MAX,
  STATE_VERSION,
  clampText,
  createCountry,
  createEmptyState,
  defaultCountryColor,
  isImageDataUrl,
  isPlainObject,
  normalizeState,
  sanitizeJson,
  sanitizeRecord,
  serializeState,
  type CivitasState,
  type Country,
  type CountryEconomics,
  type JsonRecord,
  type JsonValue,
  type NormalizeResult,
  type ProvinceOverride,
  type StateDoc,
};
