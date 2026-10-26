// The countries file: its shape and its parser. Pure.
// The editor in `../civitas-map` writes `assets/countries.json`. This app only reads it.
// The parser throws on a wrong `format` or `version`, like `parseManifest`: that is
// a different file. It repairs a bad entry instead: one broken country must not
// hide the rest.

const COUNTRIES_FORMAT = "civitas.countries";
const COUNTRIES_VERSION = 1;

// Hard ceiling: `buildCountryOf` stores country ids in a `Uint16Array`.
// Id 0 is reserved for `NO_PROVINCE`.
const MAX_COUNTRY_ID = 65535;

const COLOR_HEX = /^#[0-9a-f]{6}$/i;
const IMAGE_DATA_URL_PREFIX = "data:image/";

// The file keeps the panel order.
type Country = {
  id: number;
  name: string;
  slogan: string;
  flagDataUrl: string | null;
  provinceIds: number[];
  colorHex: string;
};

type CountriesFile = {
  countries: Country[];
  // One note per category of dropped data. Empty for a clean file.
  repairs: string[];
};

function isPlainObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The name every surface shows. A blank name falls back to "Country <id>".
function countryDisplayName(id: number, name: string): string {
  if (typeof name !== "string" || name.trim() === "") {
    return "Country " + id;
  }
  return name;
}

function isCountryId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_COUNTRY_ID;
}

function isProvinceId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

// Only data URLs are kept. The file is local data, so a remote URL means corruption.
function readFlag(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(IMAGE_DATA_URL_PREFIX)) {
    return null;
  }
  return value;
}

// Throws on a wrong format or version. Repairs and reports everything else.
function parseCountries(raw: unknown): CountriesFile {
  if (!isPlainObject(raw)) {
    throw new Error("countries file is not an object");
  }
  if (raw.format !== COUNTRIES_FORMAT) {
    throw new Error("countries format is " + JSON.stringify(raw.format) + ", expected \"" + COUNTRIES_FORMAT + "\"");
  }
  if (raw.version !== COUNTRIES_VERSION) {
    throw new Error("countries version is " + JSON.stringify(raw.version) + ", expected " + COUNTRIES_VERSION);
  }
  if (!Array.isArray(raw.countries)) {
    throw new Error("countries file has no countries list");
  }

  const countries: Country[] = [];
  const seenIds = new Set<number>();
  // Invariant enforced here: one province has at most one owner, the first country that claims it.
  const claimed = new Set<number>();
  let badCountries = 0;
  let badProvinceIds = 0;
  let stolenProvinces = 0;
  let badFlags = 0;

  for (const entry of raw.countries) {
    if (!isPlainObject(entry) || !isCountryId(entry.id) || seenIds.has(entry.id)) {
      badCountries += 1;
      continue;
    }
    if (typeof entry.colorHex !== "string" || !COLOR_HEX.test(entry.colorHex) || !Array.isArray(entry.provinceIds)) {
      badCountries += 1;
      continue;
    }
    seenIds.add(entry.id);

    const provinceIds: number[] = [];
    for (const candidate of entry.provinceIds) {
      if (!isProvinceId(candidate)) {
        badProvinceIds += 1;
        continue;
      }
      if (claimed.has(candidate)) {
        stolenProvinces += 1;
        continue;
      }
      claimed.add(candidate);
      provinceIds.push(candidate);
    }
    // Sorted ids make equal assignments compare equal.
    provinceIds.sort((a, b) => {
      return a - b;
    });

    const flagDataUrl = readFlag(entry.flagDataUrl);
    if (entry.flagDataUrl !== undefined && entry.flagDataUrl !== null && flagDataUrl === null) {
      badFlags += 1;
    }

    countries.push({
      id: entry.id,
      name: typeof entry.name === "string" ? entry.name : "",
      slogan: typeof entry.slogan === "string" ? entry.slogan : "",
      flagDataUrl,
      provinceIds,
      colorHex: entry.colorHex,
    });
  }

  const repairs: string[] = [];
  if (badCountries > 0) {
    repairs.push("dropped " + badCountries + " malformed countries");
  }
  if (badProvinceIds > 0) {
    repairs.push("dropped " + badProvinceIds + " malformed province ids");
  }
  if (stolenProvinces > 0) {
    repairs.push("dropped " + stolenProvinces + " duplicate province claims");
  }
  if (badFlags > 0) {
    repairs.push("dropped " + badFlags + " flags that are not data:image/ URLs");
  }

  return { countries, repairs };
}

function parseCountriesText(text: string): CountriesFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("countries file is not valid JSON");
  }
  return parseCountries(raw);
}

export {
  COUNTRIES_FORMAT,
  COUNTRIES_VERSION,
  MAX_COUNTRY_ID,
  countryDisplayName,
  parseCountries,
  parseCountriesText,
  type CountriesFile,
  type Country,
};
