import type { Country } from "./countries";

// The countries file: the countries of a provinces export, by province id.
// `../civitas-interactive-map` reads the same file as `assets/countries.json`.
//
//   { "format": "civitas.countries", "version": 1,
//     "countries": [{ "id", "name", "colorHex", "provinceIds", "slogan"?, "flagDataUrl"? }] }

const COUNTRIES_FORMAT = "civitas.countries";
const COUNTRIES_VERSION = 1;
const MAX_COUNTRY_ID = 65535;
const COLOR_HEX = /^#[0-9a-f]{6}$/i;

type CountriesFile = {
  format: string;
  version: number;
  countries: Country[];
};

type ParsedCountries = {
  countries: Country[];
  // Country entries that could not be read.
  skippedCountries: number;
  // Province ids that were unknown, or already claimed by an earlier country.
  skippedProvinces: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildCountriesFile(list: readonly Country[]): CountriesFile {
  return {
    format: COUNTRIES_FORMAT,
    version: COUNTRIES_VERSION,
    countries: list.map((country) => {
      const entry: Country = {
        id: country.id,
        name: country.name,
        colorHex: country.colorHex,
        provinceIds: [...country.provinceIds].sort((a, b) => a - b),
      };

      if (country.slogan !== undefined) {
        entry.slogan = country.slogan;
      }

      if (country.flagDataUrl !== undefined) {
        entry.flagDataUrl = country.flagDataUrl;
      }

      return entry;
    }),
  };
}

// Throws on a file that is not a countries file. Inside a valid file, a bad
// country or a bad province id is skipped and counted. `isProvince` says which
// province ids exist; the first country to claim a province keeps it.
function parseCountriesFile(text: string, isProvince: (id: number) => boolean): ParsedCountries {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("the countries file is not valid JSON");
  }

  if (!isRecord(raw) || raw.format !== COUNTRIES_FORMAT) {
    throw new Error(`the countries file is not a ${COUNTRIES_FORMAT} file`);
  }

  if (raw.version !== COUNTRIES_VERSION) {
    throw new Error(`countries file version ${String(raw.version)} is not supported`);
  }

  if (!Array.isArray(raw.countries)) {
    throw new Error("the countries file has no `countries` list");
  }

  const countries: Country[] = [];
  const seenIds = new Set<number>();
  const claimed = new Set<number>();
  let skippedCountries = 0;
  let skippedProvinces = 0;

  for (const entry of raw.countries) {
    if (!isRecord(entry)) {
      skippedCountries += 1;
      continue;
    }

    const { id, name, colorHex, provinceIds, slogan, flagDataUrl } = entry;

    if (typeof id !== "number" || !Number.isInteger(id) || id < 1 || id > MAX_COUNTRY_ID || seenIds.has(id)) {
      skippedCountries += 1;
      continue;
    }

    if (typeof colorHex !== "string" || !COLOR_HEX.test(colorHex) || !Array.isArray(provinceIds)) {
      skippedCountries += 1;
      continue;
    }

    seenIds.add(id);

    const ids: number[] = [];

    for (const candidate of provinceIds) {
      if (typeof candidate !== "number" || !isProvince(candidate) || claimed.has(candidate)) {
        skippedProvinces += 1;
        continue;
      }

      claimed.add(candidate);
      ids.push(candidate);
    }

    const country: Country = {
      id,
      name: typeof name === "string" && name.trim() !== "" ? name : `Country ${id}`,
      colorHex: colorHex.toLowerCase(),
      provinceIds: ids.sort((a, b) => a - b),
    };

    if (typeof slogan === "string") {
      country.slogan = slogan;
    }

    if (typeof flagDataUrl === "string" && flagDataUrl.startsWith("data:image/")) {
      country.flagDataUrl = flagDataUrl;
    }

    countries.push(country);
  }

  return { countries, skippedCountries, skippedProvinces };
}

export {
  COUNTRIES_FORMAT,
  COUNTRIES_VERSION,
  buildCountriesFile,
  parseCountriesFile,
  type CountriesFile,
  type ParsedCountries,
};
