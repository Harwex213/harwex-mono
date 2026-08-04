import { computed, signal } from "@preact/signals-react";
import { countryAggregates, maxProvinceId } from "./country-store";
import { countries, countryOfProvince } from "./world-store";
import { loadPhase, provinceAt, provinceById } from "./map-store";
import { resolveLabelAnchor } from "../map/label-layout";
import type { AnchorCandidate, CountryLabelSource } from "../map/label-layout";
import type { CountryAggregate } from "../map/country-aggregate";
import type { Country } from "./schema";
import type { Point } from "../map/view";
import type { ReadonlySignal, Signal } from "@preact/signals-react";

// The derived half of T07: what the renderer needs to draw a country name, plus
// the "is this map pixel in that country" predicate the anchor chain and the
// nudge test both run on.
//
// Anchors are DERIVED, never persisted. Nothing here enters `civitas.state.v1`.

type AnchorEntry = { ids: readonly number[]; anchor: Point | null };

const EMPTY: readonly CountryLabelSource[] = [];

// Keyed by countryId, validated by `provinceIds` ARRAY IDENTITY.
// `assignProvinces` returns the same `Country` object — and therefore the same
// `provinceIds` array — for every country it did not touch, and builds a fresh
// array for every country it did. So `entry.ids === country.provinceIds` is an
// exact "the territory is unchanged" test with no hashing, and a rename costs
// nothing.
const anchorCache = new Map<number, AnchorEntry>();

// Deliberately NOT persisted. It is the verification instrument for "the label
// is not in the sea": press L, see what is underneath.
const showLabels: Signal<boolean> = signal(true);

function toggleLabels(): void {
  showLabels.value = !showLabels.value;
}

// `.peek()`, not `.value`. This runs both inside the `countryLabelSources`
// computed — which already depends on everything `countryOfProvince` derives
// from — and inside a `requestAnimationFrame` callback where there is no
// tracking context at all. `.peek()` is correct in both and cannot accidentally
// widen a dependency set.
//
// `provinceAt` floors its arguments, returns `null` outside the map, `null` on
// unpainted pixels (the sea), and `null` for everything until the load
// finishes. All three are exactly what this predicate wants.
function countryContainsPoint(countryId: number, x: number, y: number): boolean {
  const provinceId = provinceAt(x, y);
  if (provinceId === null) {
    return false;
  }
  return countryOfProvince.peek().get(provinceId) === countryId;
}

function anchorFor(country: Country, aggregate: CountryAggregate): Point | null {
  const cached = anchorCache.get(country.id);
  if (cached && cached.ids === country.provinceIds) {
    return cached.anchor;
  }

  const candidates: AnchorCandidate[] = [];
  for (const provinceId of country.provinceIds) {
    const province = provinceById(provinceId);
    if (province === null) {
      continue;
    }
    candidates.push({
      x: province.centroid.x,
      y: province.centroid.y,
      pixelCount: province.pixelCount,
      bounds: province.bounds,
    });
  }
  // Descending by area, `x` then `y` breaking a tie so the order is total and
  // the anchor does not depend on the order `provinceIds` happens to be in.
  candidates.sort((a, b) => {
    return b.pixelCount - a.pixelCount || a.x - b.x || a.y - b.y;
  });

  const resolved = resolveLabelAnchor({
    countryId: country.id,
    centroid: aggregate.centroid,
    provinces: candidates,
    contains: countryContainsPoint,
  });
  const anchor = resolved === null ? null : resolved.point;
  anchorCache.set(country.id, { ids: country.provinceIds, anchor });
  return anchor;
}

// Gating on `loadPhase === "ready"` does double duty. It is the invalidation
// subscription — `provinceById` and `provinceAt` read `getMapAssets()`, a plain
// module variable that notifies nobody, so without this read a country hydrated
// from localStorage would never get an anchor. And it guarantees no anchor is
// ever computed while `provinceAt` returns `null` for every pixel, which would
// fill the cache with `null` and leave every country unlabelled forever.
const countryLabelSources: ReadonlySignal<readonly CountryLabelSource[]> = computed(() => {
  if (!showLabels.value) {
    return EMPTY;
  }
  if (loadPhase.value !== "ready") {
    return EMPTY;
  }
  void maxProvinceId.value;

  const aggregates = countryAggregates.value;
  const list = countries.value;
  const alive = new Set<number>();
  const out: CountryLabelSource[] = [];

  for (const country of list) {
    alive.add(country.id);
    const aggregate = aggregates.get(country.id);
    if (!aggregate || aggregate.bounds === null || aggregate.centroid === null) {
      continue;
    }
    const text = country.name.trim().toUpperCase();
    if (text === "") {
      continue;
    }
    const anchor = anchorFor(country, aggregate);
    if (anchor === null) {
      continue;
    }
    out.push({
      countryId: country.id,
      text,
      anchor,
      bounds: aggregate.bounds,
      area: aggregate.pixelCount,
    });
  }

  for (const id of [...anchorCache.keys()]) {
    if (!alive.has(id)) {
      anchorCache.delete(id);
    }
  }

  return out;
});

function clearLabelAnchorCache(): void {
  anchorCache.clear();
}

function labelAnchorCacheSize(): number {
  return anchorCache.size;
}

export {
  clearLabelAnchorCache,
  countryContainsPoint,
  countryLabelSources,
  labelAnchorCacheSize,
  showLabels,
  toggleLabels,
};
