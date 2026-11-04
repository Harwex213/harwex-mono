import {
  fromHex,
  packOpaque,
} from "../colors/colors";
import type { Country } from "../countries/countries";
import type { Province } from "../provinces/provinces";

// The countries and provinces a map holds on the backend, and how they meet the
// editor's registry. The backend knows a province only by name and colour, so
// the hex is the key: a province of the layer whose colour equals a stored hex
// is that stored province. Ids differ on both sides — uuids there, small
// integers here — and never cross.

type ServerProvince = {
  id: string;
  name: string;
  hex: string;
};

type ServerCountry = {
  id: string;
  name: string;
  hex: string;
  provinces: ServerProvince[];
};

type ServerLayout = {
  countries: ServerCountry[];
};

type BoundLayout = {
  provinces: Province[];
  // Null when the backend has no countries, so the caller keeps its own.
  countries: Country[] | null;
  // Stored provinces whose colour the registry holds, and all stored provinces.
  matched: number;
  stored: number;
};

// What `Save` sends: the whole layout, which replaces what the backend held.
type SaveLayout = {
  countries: Array<{
    name: string;
    hex: string;
    provinces: Array<{ name: string; hex: string }>;
  }>;
};

type SavePlan = {
  layout: SaveLayout;
  // Provinces in no country. The backend files every province under a country,
  // so these live in the province layer image only.
  unassigned: number;
  // Provinces with no paint on the layer, left out of the save.
  unpainted: number;
};

function normalHex(hex: string): string {
  return hex.trim().toLowerCase();
}

// Hex -> the stored province and the country it is filed under.
function storedProvinces(layout: ServerLayout): Map<string, { province: ServerProvince; country: ServerCountry }> {
  const out = new Map<string, { province: ServerProvince; country: ServerCountry }>();

  for (const country of layout.countries) {
    for (const province of country.provinces) {
      const hex = normalHex(province.hex);

      if (!out.has(hex)) {
        out.set(hex, { province, country });
      }
    }
  }

  return out;
}

// The registry of a map opened from the backend, before any layer is loaded: one
// province per stored one, in its stored colour. They hold no pixels yet; a
// detection or an import that paints those colours brings them to life.
function seedProvinces(layout: ServerLayout): Province[] {
  const out: Province[] = [];
  const taken = new Set<number>();

  for (const { province } of storedProvinces(layout).values()) {
    const rgb = fromHex(province.hex);

    if (!rgb) {
      continue;
    }

    const color = packOpaque(rgb);

    if (taken.has(color)) {
      continue;
    }

    taken.add(color);
    out.push({
      id: out.length + 1,
      name: province.name,
      kind: "land",
      color,
      hex: normalHex(province.hex),
    });
  }

  return out;
}

// Gives the registry what the backend knows: a province whose colour matches a
// stored one takes its name, and the stored countries are rebuilt over the
// registry's ids. A stored province the registry lacks is left out of its
// country rather than invented.
function bindLayout(provinces: readonly Province[], layout: ServerLayout): BoundLayout {
  const stored = storedProvinces(layout);
  const idByHex = new Map<string, number>();
  let matched = 0;

  const named = provinces.map((province) => {
    const entry = stored.get(normalHex(province.hex));

    if (!entry) {
      return province;
    }

    if (!idByHex.has(normalHex(province.hex))) {
      matched += 1;
    }

    idByHex.set(normalHex(province.hex), province.id);

    return entry.province.name === province.name ? province : { ...province, name: entry.province.name };
  });

  if (layout.countries.length === 0) {
    return { provinces: named, countries: null, matched, stored: stored.size };
  }

  const countries = layout.countries.map((country, index): Country => {
    const ids = new Set<number>();

    for (const province of country.provinces) {
      const hex = normalHex(province.hex);
      const id = idByHex.get(hex);

      // A colour stored twice belongs to the country that came first.
      if (id !== undefined && stored.get(hex)?.country === country) {
        ids.add(id);
      }
    }

    return {
      id: index + 1,
      name: country.name,
      colorHex: normalHex(country.hex),
      provinceIds: [...ids].sort((a, b) => a - b),
    };
  });

  return { provinces: named, countries, matched, stored: stored.size };
}

// The editor's countries and their provinces, as the backend stores them.
// `painted` is the set of colours on the layer. A province without paint is
// left out: it is a stored row whose shape was deleted, and saving it would keep
// it alive forever. Null keeps every province — for a layer with no paint at all,
// where nothing has been drawn or loaded yet and dropping everything would wipe
// the stored names.
function planSave(
  provinces: readonly Province[],
  countries: readonly Country[],
  painted: ReadonlySet<number> | null = null,
): SavePlan {
  const kept = painted ? provinces.filter((province) => painted.has(province.color)) : provinces;
  const byId = new Map(kept.map((province) => [province.id, province]));
  const owned = new Set<number>();

  const layout: SaveLayout = {
    countries: countries.map((country) => {
      const members: Array<{ name: string; hex: string }> = [];

      for (const provinceId of country.provinceIds) {
        const province = byId.get(provinceId);

        if (!province || owned.has(provinceId)) {
          continue;
        }

        owned.add(provinceId);
        members.push({ name: province.name, hex: normalHex(province.hex) });
      }

      return { name: country.name, hex: normalHex(country.colorHex), provinces: members };
    }),
  };

  const unassigned = kept.filter((province) => !owned.has(province.id)).length;

  return { layout, unassigned, unpainted: provinces.length - kept.length };
}

function bindNotice(bound: BoundLayout): string {
  if (bound.stored === 0) {
    return "";
  }

  return `Matched ${bound.matched} of ${bound.stored} stored province${bound.stored === 1 ? "" : "s"} by colour.`;
}

function saveNotice(saved: ServerLayout, plan: SavePlan): string {
  const { unassigned, unpainted } = plan;
  const countries = saved.countries.length;
  const provinces = saved.countries.reduce((sum, country) => sum + country.provinces.length, 0);
  const parts = [
    `Saved ${countries} countr${countries === 1 ? "y" : "ies"} and ` +
      `${provinces} province${provinces === 1 ? "" : "s"}, replacing what the backend held, ` +
      "and the province and countries layers.",
  ];

  if (unassigned > 0) {
    parts.push(
      `${unassigned} province${unassigned === 1 ? " in no country is" : "s in no country are"} ` +
        "kept in the province layer only.",
    );
  }

  if (unpainted > 0) {
    parts.push(
      `${unpainted} province${unpainted === 1 ? "" : "s"} with no paint on the layer ` +
        `${unpainted === 1 ? "was" : "were"} left out.`,
    );
  }

  return parts.join(" ");
}

export {
  bindLayout,
  bindNotice,
  planSave,
  saveNotice,
  seedProvinces,
  type BoundLayout,
  type SaveLayout,
  type SavePlan,
  type ServerCountry,
  type ServerLayout,
  type ServerProvince,
};
