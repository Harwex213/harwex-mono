import type { Bounds, Point, Province } from "./manifest";

// PURE. Everything a country layer needs to know about the shape of its
// territory: how many provinces, how many painted pixels, the union of the
// bounding boxes, and the point a label sits on.
//
// It takes a province LOOKUP rather than a `Country`, so this module imports
// nothing from `src/state/` and the maths is testable in Node, where the
// manifest never loads.

type CountryAggregate = {
  countryId: number;
  // Ids the user assigned, including any the manifest does not carry.
  provinceCount: number;
  // Ids that resolved to a manifest province. Equal to `provinceCount` for a
  // clean document, smaller when it carries a phantom id.
  resolvedCount: number;
  pixelCount: number;
  bounds: Bounds | null;
  centroid: Point | null;
};

// `max(ax + aw, bx + bw) - x`, never `max(aw, bw)`. The latter is the classic
// wrong union: it keeps the wider box's width and loses everything the other
// box adds beyond it.
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

// The centroid is area-weighted: each province's centre of mass counts for its
// `pixelCount`. A plain mean puts a country's label somewhere between its
// islands rather than over its mainland.
//
// The result is NOT rounded. T07 places a label on it and wants the sub-pixel
// value; rounding is the caller's business.
function aggregateCountry(
  countryId: number,
  provinceIds: readonly number[],
  lookup: (provinceId: number) => Province | null,
): CountryAggregate {
  let weightedX = 0;
  let weightedY = 0;
  let weight = 0;
  // The unweighted fallback accumulators, for a manifest whose `pixelCount` is
  // 0 everywhere. Impossible on the shipped asset, trivial in a re-export, and
  // an unguarded weighted mean returns `NaN` there.
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
