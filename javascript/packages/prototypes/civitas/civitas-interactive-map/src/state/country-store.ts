import { computed, effect } from "@preact/signals-react";
import { SELECTED_TINT_ALPHA, TINT_ALPHA, tintWordFor } from "../ui/tint-layer";
import { aggregateCountry } from "../map/country-aggregate";
import { borderPhase, setCountryAssignment } from "./borders-store";
import { getMapAssets, loadPhase, provinceById } from "./map-store";
import { selectedCountryId } from "./selection-store";
import { buildCountryAssignment, countries, countryOfProvince } from "./world-store";
import { createStateWriter } from "./persistence";
import type { CountryAggregate } from "../map/country-aggregate";
import type { Country } from "./schema";
import type { StateWriter, Timers } from "./persistence";
import type { ReadonlySignal } from "@preact/signals-react";

// The derived half of the country model: the tint word table, the per-country
// aggregates T07's labels sit on, and the debounced push of the assignment into
// the T04 border worker.
//
// Signals only, no DOM. It imports `tintWordFor` from `../ui/tint-layer` — the
// same direction `borders-store.ts` already imports `buildBorderPaths` from
// `../ui/border-layer`.
//
// THE TRAP IN THIS FILE. `getMapAssets()` is a plain module variable and
// notifies nobody. Every computed below that touches the manifest must ALSO
// read `loadPhase.value`, or a country hydrated from localStorage never tints
// until something else happens to invalidate.

// 120, not T05's 400. The border push has to stay visibly live during a drag.
const BORDER_PUSH_MS = 120;

type CountrySyncOptions = { timers?: Timers; delayMs?: number };

const maxProvinceId: ReadonlySignal<number> = computed(() => {
  if (loadPhase.value !== "ready") {
    return 0;
  }
  const assets = getMapAssets();
  if (!assets) {
    return 0;
  }
  let max = 0;
  for (const province of assets.manifest.provinces) {
    if (province.id > max) {
      max = province.id;
    }
  }
  return max;
});

// PURE, and exported for its test: in Node the manifest never loads, so the
// computed below can only ever produce a length-1 array.
//
// One 32-bit word per province id. Index 0 stays 0 — `NO_PROVINCE` is never
// tinted. The hex is parsed once per COUNTRY, not once per province.
//
// `emphasisCountryId` is T08's selected country: it gets a higher alpha and
// nothing else. Both extra parameters are optional and default to no emphasis,
// so a call with two arguments is byte-identical to the pre-T08 output.
function buildTintWordTable(
  list: readonly Country[],
  max: number,
  emphasisCountryId?: number | null,
  emphasisAlpha?: number,
): Uint32Array {
  const out = new Uint32Array(Math.max(0, max) + 1);
  const emphasisId = emphasisCountryId ?? null;
  for (const country of list) {
    const alpha =
      country.id === emphasisId ? (emphasisAlpha ?? SELECTED_TINT_ALPHA) : TINT_ALPHA;
    const word = tintWordFor(country.colorHex, alpha);
    if (word === 0) {
      continue;
    }
    for (const provinceId of country.provinceIds) {
      if (provinceId >= 1 && provinceId <= max) {
        out[provinceId] = word;
      }
    }
  }
  return out;
}

// Reading `selectedCountryId` here is what makes the selected country deepen on
// the map. It is cheap: `diffTintWords` repaints only the ids whose word
// changed, which is the previously-selected country's provinces plus the newly
// selected one's, once, on the click — not per frame.
const countryTintWords: ReadonlySignal<Uint32Array> = computed(() => {
  return buildTintWordTable(
    countries.value,
    maxProvinceId.value,
    selectedCountryId.value,
    SELECTED_TINT_ALPHA,
  );
});

// THE `computed` IS THE CACHE the brief asks for. It recomputes only when the
// countries array identity changes, which is exactly "on assignment change" —
// and `assignProvinces` returns without writing when nothing actually changed.
// A full recompute is 1648 `Map` lookups, tens of microseconds; per-country
// memoisation would be more code for no measurable gain.
const countryAggregates: ReadonlySignal<ReadonlyMap<number, CountryAggregate>> = computed(() => {
  // Read only to subscribe to the manifest's arrival: the aggregates are empty
  // until `provinceById` resolves anything.
  void maxProvinceId.value;
  const out = new Map<number, CountryAggregate>();
  for (const country of countries.value) {
    out.set(country.id, aggregateCountry(country.id, country.provinceIds, provinceById));
  }
  return out;
});

let writer: StateWriter | null = null;
let stopEffect: (() => void) | null = null;

function pushCountryBorders(): void {
  const max = maxProvinceId.peek();
  if (max <= 0) {
    return;
  }
  setCountryAssignment(buildCountryAssignment(max));
}

// Why debounce at all, when `borders-store` already coalesces? The coalescing
// bounds worker concurrency at one in flight plus one queued, but every
// response still costs `buildBorderPaths` on the MAIN thread — T04 measured
// 5.7 ms for 180 tiles. At 30 pointermove events a second that is 17% of the
// frame budget plus 180 discarded `Path2D` per response. 120 ms caps a
// one-second drag at about 8 recomputes while keeping the border visibly live.
function initCountrySync(options: CountrySyncOptions = {}): () => void {
  disposeCountrySync();

  writer = createStateWriter({
    write: pushCountryBorders,
    delayMs: options.delayMs ?? BORDER_PUSH_MS,
    timers: options.timers,
  });

  // Write-free, so it is legal in an effect. `setCountryAssignment` runs from a
  // timer callback, outside any tracking context.
  //
  // `borderPhase` matters: the first push usually happens while the worker is
  // still scanning, when `setCountryAssignment` returns early, so the effect has
  // to re-run when the scan completes.
  stopEffect = effect(() => {
    void countryOfProvince.value;
    void borderPhase.value;
    void maxProvinceId.value;
    const current = writer;
    if (current === null) {
      return;
    }
    current.schedule();
  });

  return disposeCountrySync;
}

// Fires the pending push immediately. `endStroke` calls it, so releasing the
// mouse updates the border within one worker round trip instead of waiting out
// the window.
function flushCountryBorders(): void {
  if (writer === null) {
    return;
  }
  writer.flush();
}

function disposeCountrySync(): void {
  if (stopEffect !== null) {
    stopEffect();
    stopEffect = null;
  }
  if (writer !== null) {
    writer.cancel();
    writer = null;
  }
}

export {
  BORDER_PUSH_MS,
  buildTintWordTable,
  countryAggregates,
  countryTintWords,
  disposeCountrySync,
  flushCountryBorders,
  initCountrySync,
  maxProvinceId,
  type CountrySyncOptions,
};
