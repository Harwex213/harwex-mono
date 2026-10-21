import type { Bounds, Point, Province } from "../data/manifest";

// Pure geometry of a country's territory: counts, union bounds and label point.
// Takes a province lookup instead of a `Country`, so that it stays testable
// without the store or the manifest.

type CountryAggregate = {
  countryId: number;
  // Ids the user assigned, including any the manifest does not carry.
  provinceCount: number;
  // Ids found in the manifest. Smaller than `provinceCount` when the document holds a phantom id.
  resolvedCount: number;
  pixelCount: number;
  bounds: Bounds | null;
  centroid: Point | null;
};

// Width is `max(right edges) - x`. `max(widths)` would lose the part of the narrower box that sticks out.
function unionBounds(a: Bounds | null, b: Bounds): Bounds {
  if (a === null) {
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

// Decisions:
// - The centroid is weighted by `pixelCount`, so that the label sits over the mainland, not between islands.
// - The centroid is not rounded. Label placement wants the sub-pixel value.
function aggregateCountry(
  countryId: number,
  provinceIds: readonly number[],
  lookup: (provinceId: number) => Province | null,
): CountryAggregate {
  let weightedX = 0;
  let weightedY = 0;
  let weight = 0;
  // Unweighted fallback for a manifest with `pixelCount` 0 everywhere. The weighted mean would be `NaN`.
  let plainX = 0;
  let plainY = 0;
  let resolved = 0;
  let pixelCount = 0;
  let bounds: Bounds | null = null;

  for (const provinceId of provinceIds) {
    const province = lookup(provinceId);
    if (province === null) {
      continue;
    }
    resolved += 1;
    bounds = unionBounds(bounds, province.bounds);

    const pixels = province.pixelCount > 0 ? province.pixelCount : 0;
    pixelCount += pixels;
    weightedX += province.centroid.x * pixels;
    weightedY += province.centroid.y * pixels;
    weight += pixels;
    plainX += province.centroid.x;
    plainY += province.centroid.y;
  }

  let centroid: Point | null = null;
  if (weight > 0) {
    centroid = { x: weightedX / weight, y: weightedY / weight };
  } else if (resolved > 0) {
    centroid = { x: plainX / resolved, y: plainY / resolved };
  }

  return {
    countryId,
    provinceCount: provinceIds.length,
    resolvedCount: resolved,
    pixelCount,
    bounds,
    centroid,
  };
}

export { aggregateCountry, unionBounds, type CountryAggregate };
