import { computed, signal } from "@preact/signals-react";
import { countryById, countryOfProvince } from "./world-store";
import { provinceById } from "./map-store";
import type { Country } from "./schema";
import type { Province } from "../map/manifest";
import type { ReadonlySignal } from "@preact/signals-react";

// Selection: three slots held in ONE signal, so a write is atomic and needs no
// `batch`. The whole rule lives in the pure `nextSelection` below — the same
// split `strokeActionFor` uses in `assign-store.ts` — so the transition table is
// unit tested in Node without touching a signal.
//
// Both hover setters skip the write when the value is unchanged. A pointer move
// inside one province must not schedule a repaint.
//
// There is no import cycle. `world-store` imports `map-store`, `persistence`,
// `schema` and `../map/borders`, and none of them import this file.

type SelectionScope = "none" | "province" | "country";

type SelectionState = {
  provinceId: number | null;
  // Only meaningful at scope "country". At scope "province" the country is
  // DERIVED live from `countryOfProvince`, so a province repainted into another
  // country updates the plaque while the drag is still running.
  countryId: number | null;
  scope: SelectionScope;
};

type SelectionIntent =
  | { kind: "province"; provinceId: number | null }
  | { kind: "countryOfProvince"; provinceId: number | null }
  | { kind: "country"; countryId: number | null }
  | { kind: "clear" };

const EMPTY: SelectionState = { provinceId: null, countryId: null, scope: "none" };

// PURE. The complete transition table.
//
// Two rules that are easy to get wrong, stated out loud:
//
// - Right-clicking an UNASSIGNED province does not clear the province. There is
//   no country to select, so the intent degrades to a province selection.
//   Clearing would make right-click feel broken over the two thirds of the map
//   that belongs to nobody.
// - A `country` intent keeps the current province only when that province is
//   inside the country. Otherwise the province slot would point at a province of
//   a different country while the plaque showed this one.
function nextSelection(
  current: SelectionState,
  intent: SelectionIntent,
  ownerOf: ReadonlyMap<number, number>,
): SelectionState {
  if (intent.kind === "clear") {
    return EMPTY;
  }

  if (intent.kind === "province") {
    if (intent.provinceId === null) {
      return EMPTY;
    }
    return { provinceId: intent.provinceId, countryId: null, scope: "province" };
  }

  if (intent.kind === "countryOfProvince") {
    if (intent.provinceId === null) {
      return EMPTY;
    }
    const owner = ownerOf.get(intent.provinceId);
    if (owner === undefined) {
      return { provinceId: intent.provinceId, countryId: null, scope: "province" };
    }
    return { provinceId: intent.provinceId, countryId: owner, scope: "country" };
  }

  if (intent.countryId === null) {
    return {
      provinceId: current.provinceId,
      countryId: null,
      scope: current.provinceId === null ? "none" : "province",
    };
  }

  const kept =
    current.provinceId !== null && ownerOf.get(current.provinceId) === intent.countryId
      ? current.provinceId
      : null;
  return { provinceId: kept, countryId: intent.countryId, scope: "country" };
}

// PURE. A fresh object always notifies, so without this guard a click on the
// already-selected province repaints the map and re-runs the tint diff.
function sameSelection(left: SelectionState, right: SelectionState): boolean {
  return (
    left.provinceId === right.provinceId &&
    left.countryId === right.countryId &&
    left.scope === right.scope
  );
}

const hoveredSignal = signal<number | null>(null);
const selectionSignal = signal<SelectionState>(EMPTY);

const hoveredProvinceId: ReadonlySignal<number | null> = computed(() => {
  return hoveredSignal.value;
});

const selectedProvinceId: ReadonlySignal<number | null> = computed(() => {
  return selectionSignal.value.provinceId;
});

// A COMPUTED, never a stored value. At scope "country" it is the stored id
// validated against `countryById`, so a deleted country cannot linger in the
// selection — the same trick `activeCountryId` uses in `assign-store.ts`.
// Otherwise it reads the owner LIVE.
const selectedCountryId: ReadonlySignal<number | null> = computed(() => {
  const current = selectionSignal.value;
  if (current.scope === "country" && current.countryId !== null) {
    return countryById.value.has(current.countryId) ? current.countryId : null;
  }
  if (current.provinceId === null) {
    return null;
  }
  return countryOfProvince.value.get(current.provinceId) ?? null;
});

// Downgrades rather than reporting a state the data no longer supports.
const selectionScope: ReadonlySignal<SelectionScope> = computed(() => {
  const current = selectionSignal.value;
  if (current.scope === "country" && selectedCountryId.value !== null) {
    return "country";
  }
  if (current.provinceId !== null) {
    return "province";
  }
  return "none";
});

const selectedCountry: ReadonlySignal<Country | null> = computed(() => {
  const id = selectedCountryId.value;
  if (id === null) {
    return null;
  }
  return countryById.value.get(id) ?? null;
});

// `null` until the map load finishes. Only `bounds` / `pixelCount` readouts use
// it, and every one of those has a "—" fallback.
const selectedProvince: ReadonlySignal<Province | null> = computed(() => {
  const id = selectedProvinceId.value;
  if (id === null) {
    return null;
  }
  return provinceById(id);
});

function apply(intent: SelectionIntent): void {
  const current = selectionSignal.value;
  const next = nextSelection(current, intent, countryOfProvince.peek());
  if (sameSelection(current, next)) {
    return;
  }
  selectionSignal.value = next;
}

function setHoveredProvince(id: number | null): void {
  if (hoveredSignal.value === id) {
    return;
  }
  hoveredSignal.value = id;
}

// Left click.
function selectProvince(id: number | null): void {
  apply({ kind: "province", provinceId: id });
}

// Right click.
function selectCountryOfProvince(id: number | null): void {
  apply({ kind: "countryOfProvince", provinceId: id });
}

// A list row, in `CountryPanel` today and in T10's province list later.
function selectCountry(countryId: number | null): void {
  apply({ kind: "country", countryId });
}

function clearSelection(): void {
  apply({ kind: "clear" });
}

export {
  clearSelection,
  hoveredProvinceId,
  nextSelection,
  sameSelection,
  selectCountry,
  selectCountryOfProvince,
  selectProvince,
  selectedCountry,
  selectedCountryId,
  selectedProvince,
  selectedProvinceId,
  selectionScope,
  setHoveredProvince,
  type SelectionIntent,
  type SelectionScope,
  type SelectionState,
};
