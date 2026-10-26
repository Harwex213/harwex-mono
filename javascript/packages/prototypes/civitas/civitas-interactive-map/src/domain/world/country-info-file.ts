// The country info file: the registration form of each country and the result
// of its economy calculator for the current year. Pure.
// `assets/countries-info.json` refers to the countries of `countries.json` by id.
// The app only shows this data. The calculator formulas are not part of the app.
// Like `parseCountries`, the parser throws on a wrong `format` or `version` and
// repairs a bad entry instead.

const COUNTRY_INFO_FORMAT = "civitas.countries-info";
const COUNTRY_INFO_VERSION = 1;

// The steps of the credit rating, best first.
const CREDIT_RATINGS = ["A+", "A", "B", "C", "D", "E", "F"] as const;

// The five base sectors of the economy, in display order. A country may add up to
// two sectors of its own as `other`.
const SECTOR_KINDS = ["agriculture", "lightIndustry", "heavyIndustry", "commerce", "extraction", "other"] as const;
const MAX_OTHER_SECTORS = 2;

type CreditRating = (typeof CREDIT_RATINGS)[number];

type SectorKind = (typeof SECTOR_KINDS)[number];

type Sector = {
  kind: SectorKind;
  // The name of an `other` sector. Empty for a base sector: the UI names those.
  title: string;
  // Millions of arlings.
  volume: number;
  // Yearly growth in percent. Negative is a decline.
  growthPct: number;
};

type ResourceBalance = {
  title: string;
  // Units per turn. Positive is a surplus, negative a deficit.
  balance: number;
};

// The registration form.
type CountryProfile = {
  capital: string;
  region: string;
  history: string;
  culture: string;
  religion: string;
  government: string;
  democraticElections: boolean;
  ideology: string;
};

// The calculator result for one year.
type EconomySnapshot = {
  year: number;
  // Millions of arlings, as the calculator reports it. Not the sum of the sectors.
  gdp: number;
  growthPct: number;
  sectors: Sector[];
  creditRating: CreditRating;
  // 0 is total state planning, 100 is a free market, 50 is neutral.
  stateControl: number;
  emissionPct: number;
  militarySpendingPct: number;
  // Financial points (ФС) and military-industrial points (ВПК) for the turn.
  fs: number;
  vpk: number;
  fsReserve: number;
  vpkStockpile: number;
  resources: ResourceBalance[];
};

type CountryInfo = {
  countryId: number;
  profile: CountryProfile;
  // `null` while the country has no calculator yet.
  economy: EconomySnapshot | null;
};

type CountryInfoFile = {
  info: CountryInfo[];
  // One note per category of dropped data. Empty for a clean file.
  repairs: string[];
};

function isPlainObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readProfile(raw: unknown): CountryProfile {
  const source = isPlainObject(raw) ? raw : {};
  return {
    capital: text(source.capital),
    region: text(source.region),
    history: text(source.history),
    culture: text(source.culture),
    religion: text(source.religion),
    government: text(source.government),
    democraticElections: source.democraticElections === true,
    ideology: text(source.ideology),
  };
}

function readSector(raw: unknown): Sector | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  if (!(SECTOR_KINDS as readonly unknown[]).includes(raw.kind)) {
    return null;
  }
  if (!isFiniteNumber(raw.volume) || raw.volume < 0 || !isFiniteNumber(raw.growthPct)) {
    return null;
  }
  return {
    kind: raw.kind as SectorKind,
    title: text(raw.title),
    volume: raw.volume,
    growthPct: raw.growthPct,
  };
}

function readResource(raw: unknown): ResourceBalance | null {
  if (!isPlainObject(raw) || typeof raw.title !== "string" || raw.title === "" || !isFiniteNumber(raw.balance)) {
    return null;
  }
  return { title: raw.title, balance: raw.balance };
}

// `null` when a required number or the rating is missing: half an economy would
// show wrong totals. A bad sector or resource row is dropped on its own.
function readEconomy(raw: unknown, counters: { badRows: number }): EconomySnapshot | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  const numbers = [
    "year",
    "gdp",
    "growthPct",
    "stateControl",
    "emissionPct",
    "militarySpendingPct",
    "fs",
    "vpk",
    "fsReserve",
    "vpkStockpile",
  ] as const;
  for (const key of numbers) {
    if (!isFiniteNumber(raw[key])) {
      return null;
    }
  }
  if (!(CREDIT_RATINGS as readonly unknown[]).includes(raw.creditRating)) {
    return null;
  }

  const sectors: Sector[] = [];
  let others = 0;
  for (const entry of Array.isArray(raw.sectors) ? raw.sectors : []) {
    const sector = readSector(entry);
    if (sector === null || (sector.kind === "other" && others >= MAX_OTHER_SECTORS)) {
      counters.badRows += 1;
      continue;
    }
    if (sector.kind === "other") {
      others += 1;
    }
    sectors.push(sector);
  }

  const resources: ResourceBalance[] = [];
  for (const entry of Array.isArray(raw.resources) ? raw.resources : []) {
    const resource = readResource(entry);
    if (resource === null) {
      counters.badRows += 1;
      continue;
    }
    resources.push(resource);
  }

  return {
    year: raw.year as number,
    gdp: raw.gdp as number,
    growthPct: raw.growthPct as number,
    sectors,
    creditRating: raw.creditRating as CreditRating,
    stateControl: Math.min(100, Math.max(0, raw.stateControl as number)),
    emissionPct: raw.emissionPct as number,
    militarySpendingPct: raw.militarySpendingPct as number,
    fs: raw.fs as number,
    vpk: raw.vpk as number,
    fsReserve: raw.fsReserve as number,
    vpkStockpile: raw.vpkStockpile as number,
    resources,
  };
}

// Throws on a wrong format or version. Repairs and reports everything else.
function parseCountryInfo(raw: unknown): CountryInfoFile {
  if (!isPlainObject(raw)) {
    throw new Error("country info file is not an object");
  }
  if (raw.format !== COUNTRY_INFO_FORMAT) {
    throw new Error(
      "country info format is " + JSON.stringify(raw.format) + ", expected \"" + COUNTRY_INFO_FORMAT + "\"",
    );
  }
  if (raw.version !== COUNTRY_INFO_VERSION) {
    throw new Error("country info version is " + JSON.stringify(raw.version) + ", expected " + COUNTRY_INFO_VERSION);
  }
  if (!Array.isArray(raw.countries)) {
    throw new Error("country info file has no countries list");
  }

  const info: CountryInfo[] = [];
  const seenIds = new Set<number>();
  let badEntries = 0;
  let badEconomies = 0;
  const counters = { badRows: 0 };

  for (const entry of raw.countries) {
    if (!isPlainObject(entry)) {
      badEntries += 1;
      continue;
    }
    const id = entry.countryId;
    if (typeof id !== "number" || !Number.isInteger(id) || id < 1 || seenIds.has(id)) {
      badEntries += 1;
      continue;
    }
    seenIds.add(id);

    const economy = readEconomy(entry.economy, counters);
    if (economy === null && entry.economy !== undefined && entry.economy !== null) {
      badEconomies += 1;
    }

    info.push({ countryId: id, profile: readProfile(entry.profile), economy });
  }

  const repairs: string[] = [];
  if (badEntries > 0) {
    repairs.push("dropped " + badEntries + " malformed entries");
  }
  if (badEconomies > 0) {
    repairs.push("dropped " + badEconomies + " incomplete economies");
  }
  if (counters.badRows > 0) {
    repairs.push("dropped " + counters.badRows + " malformed sector or resource rows");
  }

  return { info, repairs };
}

function parseCountryInfoText(source: string): CountryInfoFile {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    throw new Error("country info file is not valid JSON");
  }
  return parseCountryInfo(raw);
}

export {
  COUNTRY_INFO_FORMAT,
  COUNTRY_INFO_VERSION,
  CREDIT_RATINGS,
  SECTOR_KINDS,
  parseCountryInfo,
  parseCountryInfoText,
  type CountryInfo,
  type CountryInfoFile,
  type CountryProfile,
  type CreditRating,
  type EconomySnapshot,
  type ResourceBalance,
  type Sector,
  type SectorKind,
};
