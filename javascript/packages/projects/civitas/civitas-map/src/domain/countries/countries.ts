// Countries: named groups of provinces. A province belongs to at most one
// country. Every function here returns a new list and leaves its input alone.

type Country = {
  id: number;
  name: string;
  colorHex: string;
  // Sorted ascending, so equal assignments compare and serialise identically.
  provinceIds: number[];
  // Kept from a loaded countries file and written back unchanged. The editor
  // does not edit them.
  slogan?: string;
  flagDataUrl?: string;
};

// What a stroke over provinces does: put them into the active country, or take
// them out of whatever country owns them.
type StrokeAction = "assign" | "erase";

const COUNTRY_COLORS: readonly string[] = [
  "#c0563f", "#4f7fb5", "#6f9e57", "#b58b3f",
  "#8a5fa8", "#3f9e96", "#b5566f", "#7a8496",
  "#a3572f", "#3f6f9e", "#8fa03f", "#9e6f3f",
  "#6f5fa8", "#3f8f6f", "#a83f5f", "#5f6f7a",
];

function countryColor(id: number): string {
  return COUNTRY_COLORS[(Math.max(1, Math.trunc(id)) - 1) % COUNTRY_COLORS.length] as string;
}

function createCountry(id: number): Country {
  return {
    id,
    name: `Country ${id}`,
    colorHex: countryColor(id),
    provinceIds: [],
  };
}

function nextCountryIdAfter(list: readonly Country[]): number {
  let max = 0;

  for (const country of list) {
    max = Math.max(max, country.id);
  }

  return max + 1;
}

// Province id -> the id of the country that owns it.
function ownerOf(list: readonly Country[]): Map<number, number> {
  const out = new Map<number, number>();

  for (const country of list) {
    for (const provinceId of country.provinceIds) {
      out.set(provinceId, country.id);
    }
  }

  return out;
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

// Moves `provinceIds` into the country `countryId`, or out of every country
// when `countryId` is null. A country that does not change keeps its identity,
// and an unchanged list is returned as is.
function assignProvinces(
  list: readonly Country[],
  countryId: number | null,
  provinceIds: Iterable<number>,
): readonly Country[] {
  const wanted = new Set(provinceIds);

  if (wanted.size === 0) {
    return list;
  }

  let changed = false;
  const next = list.map((country) => {
    const kept = country.provinceIds.filter((id) => !wanted.has(id));

    if (country.id === countryId) {
      const merged = [...kept, ...wanted].sort((a, b) => a - b);

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

  return changed ? next : list;
}

// Drops the province ids that `keep` rejects, for example after a province was
// deleted. An unchanged list is returned as is.
function keepProvinces(list: readonly Country[], keep: (provinceId: number) => boolean): readonly Country[] {
  let changed = false;
  const next = list.map((country) => {
    const kept = country.provinceIds.filter(keep);

    if (kept.length === country.provinceIds.length) {
      return country;
    }

    changed = true;

    return { ...country, provinceIds: kept };
  });

  return changed ? next : list;
}

// The stroke rule: the erase button erases. A press on a province of the active
// country takes it out again. Any other press assigns. The rule is applied once
// per stroke, so dragging back over a province does not flip it twice.
function strokeActionFor(
  provinceId: number | null,
  countryId: number,
  owners: ReadonlyMap<number, number>,
  erasing: boolean,
): StrokeAction {
  if (erasing) {
    return "erase";
  }

  if (provinceId !== null && owners.get(provinceId) === countryId) {
    return "erase";
  }

  return "assign";
}

export {
  COUNTRY_COLORS,
  assignProvinces,
  countryColor,
  createCountry,
  keepProvinces,
  nextCountryIdAfter,
  ownerOf,
  strokeActionFor,
  type Country,
  type StrokeAction,
};
