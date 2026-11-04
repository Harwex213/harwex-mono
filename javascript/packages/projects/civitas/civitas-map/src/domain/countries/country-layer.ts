import {
  TRANSPARENT,
  fromHex,
  packOpaque,
} from "../colors/colors";
import type { Country } from "./countries";

// The countries image: the province layer with every province painted in the
// colour of its country, transparent where nothing is painted and where a
// province is in no country. The backend keeps it beside the province layer,
// and reading it back restores which province is in which country.

type ColoredProvince = {
  id: number;
  color: number;
};

// Country colour by province colour, for every province that has a country.
function countryColorByProvinceColor(
  provinces: readonly ColoredProvince[],
  countries: readonly Country[],
): Map<number, number> {
  const colorOfId = new Map(provinces.map((province) => [province.id, province.color]));
  const out = new Map<number, number>();

  for (const country of countries) {
    const rgb = fromHex(country.colorHex);

    if (!rgb) {
      continue;
    }

    const fill = packOpaque(rgb);

    for (const provinceId of country.provinceIds) {
      const color = colorOfId.get(provinceId);

      if (color !== undefined && !out.has(color)) {
        out.set(color, fill);
      }
    }
  }

  return out;
}

function paintCountryPixels(
  layerPixels: Readonly<Uint32Array>,
  provinces: readonly ColoredProvince[],
  countries: readonly Country[],
): Uint32Array {
  const fillOf = countryColorByProvinceColor(provinces, countries);
  const out = new Uint32Array(layerPixels.length);
  // Painted areas are long runs of one colour, so the lookup is skipped while
  // the colour stays the same.
  let lastColor = TRANSPARENT;
  let lastFill = TRANSPARENT;

  for (let index = 0; index < layerPixels.length; index += 1) {
    const color = layerPixels[index];

    if (color !== lastColor) {
      lastColor = color;
      lastFill = color === TRANSPARENT ? TRANSPARENT : (fillOf.get(color) ?? TRANSPARENT);
    }

    out[index] = lastFill;
  }

  return out;
}

type RestoredCountries = {
  countries: Country[];
  // Provinces whose country the image decided, in or out of a country.
  restored: number;
};

// Reads the countries image back over the countries that are known: each
// province takes the country whose colour the image holds under the first
// pixel of that province. A transparent pixel there takes it out of every
// country. A province with no pixels, or a colour no country has, keeps the
// country it has now — the image cannot say anything about those.
function restoreCountries(
  layerPixels: Readonly<Uint32Array>,
  countryPixels: Readonly<Uint32Array>,
  provinces: readonly ColoredProvince[],
  countries: readonly Country[],
): RestoredCountries {
  if (layerPixels.length !== countryPixels.length) {
    throw new Error(
      `the countries image holds ${countryPixels.length} pixels, the layer holds ${layerPixels.length}`,
    );
  }

  const idOfColor = new Map<number, number>();

  for (const province of provinces) {
    if (!idOfColor.has(province.color)) {
      idOfColor.set(province.color, province.id);
    }
  }

  // Province colour -> the country colour found under its first pixel.
  const sampled = new Map<number, number>();
  let lastColor = TRANSPARENT;

  for (let index = 0; index < layerPixels.length; index += 1) {
    const color = layerPixels[index];

    if (color === lastColor || color === TRANSPARENT) {
      lastColor = color;
      continue;
    }

    lastColor = color;

    if (!sampled.has(color) && idOfColor.has(color)) {
      sampled.set(color, countryPixels[index]);
    }
  }

  const countryOfFill = new Map<number, number>();

  for (const country of countries) {
    const rgb = fromHex(country.colorHex);

    if (rgb && !countryOfFill.has(packOpaque(rgb))) {
      countryOfFill.set(packOpaque(rgb), country.id);
    }
  }

  // Province id -> country id, or null for no country.
  const decided = new Map<number, number | null>();

  for (const [color, fill] of sampled) {
    const provinceId = idOfColor.get(color) as number;

    if (fill === TRANSPARENT) {
      decided.set(provinceId, null);
      continue;
    }

    const countryId = countryOfFill.get(fill);

    if (countryId !== undefined) {
      decided.set(provinceId, countryId);
    }
  }

  const restoredCountries = countries.map((country) => {
    const ids = new Set(country.provinceIds.filter((provinceId) => !decided.has(provinceId)));

    for (const [provinceId, countryId] of decided) {
      if (countryId === country.id) {
        ids.add(provinceId);
      }
    }

    return { ...country, provinceIds: [...ids].sort((a, b) => a - b) };
  });

  return { countries: restoredCountries, restored: decided.size };
}

export {
  paintCountryPixels,
  restoreCountries,
  type RestoredCountries,
};
