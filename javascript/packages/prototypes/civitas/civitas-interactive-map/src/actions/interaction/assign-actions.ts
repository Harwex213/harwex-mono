import { batch } from "@preact/signals-react";
import {
  strokeActionFor,
  type StrokeAction,
} from "../../domain/index";
import { flushCountryBorders } from "../map/border-actions";
import { assignProvinces } from "../world/world-actions";
import type { TDatasources } from "../../datasource/index";
import type { TStore } from "../../store/index";

// Assign mode and the brush stroke. Country writes go through `assignProvinces`,
// which keeps the one-owner invariant.

function setAssignMode(store: TStore, on: boolean): void {
  if (store.assign.mode.peek() === on) {
    return;
  }
  store.assign.mode.value = on;
}

function toggleAssignMode(store: TStore): void {
  store.assign.mode.value = !store.assign.mode.peek();
}

function setActiveCountry(store: TStore, id: number | null): void {
  if (store.assign.pickedCountryId.peek() === id) {
    return;
  }
  store.assign.pickedCountryId.value = id;
}

function applyStroke(store: TStore, sources: TDatasources, ids: readonly number[]): void {
  const stroke = store.assign.stroke.peek();
  if (stroke === null || ids.length === 0) {
    return;
  }
  // `assignProvinces` with an unknown id still strips owners. Without this check,
  // a country deleted mid-stroke turns the drag into a mass unassign.
  if (!store.world.countryById.peek().has(stroke.countryId)) {
    cancelStroke(store);
    return;
  }
  // Erase strips any owner, not only the active country.
  assignProvinces(store, sources, stroke.action === "assign" ? stroke.countryId : null, ids);
}

// Decisions:
// - The action is decided once per stroke, so re-entering a province does not toggle it back.
// - `null` means no stroke started. The caller then pans, so the map stays usable with no country picked.
function beginStroke(
  store: TStore,
  sources: TDatasources,
  provinceId: number | null,
  altKey: boolean,
): StrokeAction | null {
  if (!store.assign.mode.peek()) {
    return null;
  }
  const countryId = store.assign.activeCountryId.peek();
  if (countryId === null) {
    return null;
  }

  const action = strokeActionFor(provinceId, countryId, store.world.countryOfProvince.peek(), altKey);
  const visited = new Set<number>();
  batch(() => {
    store.assign.stroke.value = { countryId, action, visited };
    store.assign.painting.value = true;
  });

  if (provinceId !== null) {
    visited.add(provinceId);
    applyStroke(store, sources, [provinceId]);
  }
  return action;
}

// Takes all ids of one pointermove, so the countries array is replaced once per event.
function extendStroke(store: TStore, sources: TDatasources, provinceIds: readonly number[]): void {
  const stroke = store.assign.stroke.peek();
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
  applyStroke(store, sources, fresh);
}

function endStroke(store: TStore, sources: TDatasources): void {
  if (store.assign.stroke.peek() === null && !store.assign.painting.peek()) {
    return;
  }
  batch(() => {
    store.assign.stroke.value = null;
    store.assign.painting.value = false;
  });
  flushCountryBorders(store, sources);
}

// Keeps the applied writes but skips the border flush of `endStroke`.
function cancelStroke(store: TStore): void {
  batch(() => {
    store.assign.stroke.value = null;
    store.assign.painting.value = false;
  });
}

export {
  beginStroke,
  cancelStroke,
  endStroke,
  extendStroke,
  setActiveCountry,
  setAssignMode,
  toggleAssignMode,
};
