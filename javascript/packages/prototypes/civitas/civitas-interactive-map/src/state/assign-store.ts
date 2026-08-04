import { computed, signal } from "@preact/signals-react";
import { assignProvinces, countryById, countryOfProvince } from "./world-store";
import { flushCountryBorders } from "./country-store";
import type { ReadonlySignal } from "@preact/signals-react";

// Assignment mode and the paint-stroke state machine. It owns no country data:
// every write goes through `world-store.assignProvinces`, which is T05's single
// entry point for the one-owner invariant.

type StrokeAction = "assign" | "erase";

const modeSignal = signal(false);
const activeIdSignal = signal<number | null>(null);
const paintingSignal = signal(false);

const assignMode: ReadonlySignal<boolean> = computed(() => {
  return modeSignal.value;
});

// A `computed` over `countryById`, so deleting the active country disarms
// assignment with no extra wiring and no stale id can ever reach
// `assignProvinces`. Assign mode itself is left on and simply inert.
const activeCountryId: ReadonlySignal<number | null> = computed(() => {
  const id = activeIdSignal.value;
  if (id === null) {
    return null;
  }
  return countryById.value.has(id) ? id : null;
});

const painting: ReadonlySignal<boolean> = computed(() => {
  return paintingSignal.value;
});

// Stroke state is a plain module variable, not a signal — nothing renders from
// it except `painting`.
let stroke: { countryId: number; action: StrokeAction; visited: Set<number> } | null = null;

function setAssignMode(on: boolean): void {
  if (modeSignal.value === on) {
    return;
  }
  modeSignal.value = on;
}

function toggleAssignMode(): void {
  modeSignal.value = !modeSignal.value;
}

function setActiveCountry(id: number | null): void {
  if (activeIdSignal.value === id) {
    return;
  }
  activeIdSignal.value = id;
}

// PURE, and the whole rule in one function. Clicking a province already in the
// active country removes it, clicking anything else assigns it (reassigning it
// away from its previous owner), and Alt always erases.
function strokeActionFor(
  provinceId: number | null,
  countryId: number,
  ownerOf: ReadonlyMap<number, number>,
  altKey: boolean,
): StrokeAction {
  if (altKey) {
    return "erase";
  }
  if (provinceId !== null && ownerOf.get(provinceId) === countryId) {
    return "erase";
  }
  return "assign";
}

function applyStroke(ids: readonly number[]): void {
  if (stroke === null || ids.length === 0) {
    return;
  }
  // MANDATORY. T05 pinned that `assignProvinces` with an id naming no country
  // still strips the provinces from their owners, so without this check a
  // country deleted mid-stroke turns the rest of the drag into a silent mass
  // unassign.
  if (!countryById.peek().has(stroke.countryId)) {
    cancelStroke();
    return;
  }
  // Erase passes `null`, which strips the province from whatever country holds
  // it. An eraser erases; it does not check ownership first.
  assignProvinces(stroke.action === "assign" ? stroke.countryId : null, ids);
}

// THE ACTION IS DECIDED ONCE, HERE, AND HELD FOR THE WHOLE STROKE. Deciding it
// per province would make a drag that re-enters a province toggle it back, and
// a drag across a rival country would leave a trail of half-assigned provinces.
//
// Returns the action the stroke is locked to, or `null` when no stroke started —
// the caller then falls back to a pan gesture, so the map stays usable with the
// mode armed but no country picked.
function beginStroke(provinceId: number | null, altKey: boolean): StrokeAction | null {
  if (!assignMode.peek()) {
    return null;
  }
  const countryId = activeCountryId.peek();
  if (countryId === null) {
    return null;
  }

  const action = strokeActionFor(provinceId, countryId, countryOfProvince.peek(), altKey);
  stroke = { countryId, action, visited: new Set<number>() };
  paintingSignal.value = true;

  if (provinceId !== null) {
    stroke.visited.add(provinceId);
    applyStroke([provinceId]);
  }
  return action;
}

// A BATCH, one call per pointermove event. Each `assignProvinces` replaces the
// countries array and invalidates `countryOfProvince`, `countryTintWords` and
// `countryAggregates`, so batching removes a straight N-times multiplier.
function extendStroke(provinceIds: readonly number[]): void {
  if (stroke === null) {
    return;
  }
  const fresh: number[] = [];
  for (const id of provinceIds) {
    if (stroke.visited.has(id)) {
      continue;
    }
    stroke.visited.add(id);
    fresh.push(id);
  }
  if (fresh.length === 0) {
    return;
  }
  applyStroke(fresh);
}

function endStroke(): void {
  if (stroke === null && !paintingSignal.value) {
    return;
  }
  stroke = null;
  paintingSignal.value = false;
  flushCountryBorders();
}

// The same as `endStroke` without the flush. A pointer cancel keeps whatever was
// already applied — those writes are in the store — but does not force an extra
// worker round trip.
function cancelStroke(): void {
  stroke = null;
  if (paintingSignal.value) {
    paintingSignal.value = false;
  }
}

export {
  activeCountryId,
  assignMode,
  beginStroke,
  cancelStroke,
  endStroke,
  extendStroke,
  painting,
  setActiveCountry,
  setAssignMode,
  strokeActionFor,
  toggleAssignMode,
  type StrokeAction,
};
