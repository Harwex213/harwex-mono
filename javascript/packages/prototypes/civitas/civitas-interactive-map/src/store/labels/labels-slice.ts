import { computed, signal } from "@preact/signals-react";
import {
  aggregateCountry,
  countryDisplayName,
  resolveLabelAnchor,
  type AnchorCandidate,
  type Country,
  type CountryAggregate,
  type CountryLabelSource,
  type Point,
} from "../../domain/index";
import { countryContainsPoint, provinceById } from "../selectors";
import type { TMapSlice } from "../map/map-slice";
import type { TWorldSlice } from "../world/world-slice";

// Per-country aggregates and the label sources for the renderer.
// Anchors are derived, never persisted.

type AnchorEntry = { ids: readonly number[]; anchor: Point | null };

const EMPTY: readonly CountryLabelSource[] = [];

function createLabelsSlice(map: TMapSlice, world: TWorldSlice) {
  const slices = { map, world };

  // Not persisted: the L key is a quick check of what lies under a label.
  const showLabels = signal(true);

  // A memo, not state: nothing subscribes to it.
  // An entry is valid while `provinceIds` keeps its array identity.
  // `assignProvinces` builds a new array only for a changed country, so a rename costs nothing.
  const anchorCache = new Map<number, AnchorEntry>();

  // No finer cache: a full recompute is 1648 `Map` lookups, tens of microseconds.
  const aggregates = computed(() => {
    const out = new Map<number, CountryAggregate>();
    // Read so the aggregates fill in when the manifest arrives.
    void map.provincesById.value;
    for (const country of world.countries.value) {
      out.set(
        country.id,
        aggregateCountry(country.id, country.provinceIds, (id) => {
          return provinceById(slices, id);
        }),
      );
    }
    return out as ReadonlyMap<number, CountryAggregate>;
  });

  function anchorFor(country: Country, aggregate: CountryAggregate): Point | null {
    const cached = anchorCache.get(country.id);
    if (cached && cached.ids === country.provinceIds) {
      return cached.anchor;
    }

    const candidates: AnchorCandidate[] = [];
    for (const provinceId of country.provinceIds) {
      const province = provinceById(slices, provinceId);
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
    // A total order, so the anchor does not depend on the order of `provinceIds`.
    candidates.sort((a, b) => {
      return b.pixelCount - a.pixelCount || a.x - b.x || a.y - b.y;
    });

    const resolved = resolveLabelAnchor({
      countryId: country.id,
      centroid: aggregate.centroid,
      provinces: candidates,
      contains: (countryId, x, y) => {
        return countryContainsPoint(slices, countryId, x, y);
      },
    });
    const anchor = resolved === null ? null : resolved.point;
    anchorCache.set(country.id, { ids: country.provinceIds, anchor });
    return anchor;
  }

  // Gated on the map load. Before it, `provinceAt` is `null` everywhere, and the
  // cache would fill with `null` anchors for good.
  const labelSources = computed<readonly CountryLabelSource[]>(() => {
    if (!showLabels.value) {
      return EMPTY;
    }
    if (map.phase.value !== "ready") {
      return EMPTY;
    }
    void map.assets.value;

    const byCountry = aggregates.value;
    const alive = new Set<number>();
    const out: CountryLabelSource[] = [];

    for (const country of world.countries.value) {
      alive.add(country.id);
      const aggregate = byCountry.get(country.id);
      if (!aggregate || aggregate.bounds === null || aggregate.centroid === null) {
        continue;
      }
      // The fallback keeps the label when the user clears the name.
      const text = countryDisplayName(country.id, country.name).trim().toUpperCase();
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

  return { showLabels, aggregates, labelSources, anchorCache };
}

export { createLabelsSlice };
