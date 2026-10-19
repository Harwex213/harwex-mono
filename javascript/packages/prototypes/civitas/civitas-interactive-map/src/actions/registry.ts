import {
  beginStroke,
  cancelStroke,
  endStroke,
  extendStroke,
  setActiveCountry,
  setAssignMode,
  toggleAssignMode,
} from "./assign-actions";
import {
  disposeBorders,
  flushCountryBorders,
  scanBorders,
  startCountryBorderSync,
} from "./border-actions";
import { toggleLabels } from "./label-actions";
import { loadMap } from "./map-actions";
import {
  clearSelection,
  selectCountry,
  selectCountryOfProvince,
  selectProvince,
  setHoveredProvince,
} from "./selection-actions";
import {
  panTo,
  resetView,
  setCursor,
  setDpr,
  setPanning,
  setViewport,
  syncView,
  zoomAtPoint,
} from "./view-actions";
import {
  addCountry,
  assignProvinces,
  clearProvinceOverride,
  deleteCountry,
  dismissStateWarning,
  flushWorld,
  hydrateWorld,
  setProvinceImage,
  setProvinceLore,
  setProvinceName,
  updateCountry,
} from "./world-actions";
import type { TDatasources } from "../datasource/index";
import type { TStore } from "../store/index";

// The only way the UI changes state. Actions stay plain functions over the store;
// the registry binds the store and the datasources.
// A component declares what it uses with `Pick<TAppRegistry, ...>`.

// Actions that only read and write the store.
const storeActions = {
  cancelStroke,
  clearSelection,
  dismissStateWarning,
  panTo,
  resetView,
  selectCountry,
  selectCountryOfProvince,
  selectProvince,
  setActiveCountry,
  setAssignMode,
  setCursor,
  setDpr,
  setHoveredProvince,
  setPanning,
  setViewport,
  syncView,
  toggleAssignMode,
  toggleLabels,
  zoomAtPoint,
};

// Actions that also call a datasource.
const sourceActions = {
  addCountry,
  assignProvinces,
  beginStroke,
  clearProvinceOverride,
  deleteCountry,
  disposeBorders,
  endStroke,
  extendStroke,
  flushCountryBorders,
  flushWorld,
  hydrateWorld,
  loadMap,
  scanBorders,
  setProvinceImage,
  setProvinceLore,
  setProvinceName,
  startCountryBorderSync,
  updateCountry,
};

type BoundStore<F> = F extends (store: TStore, ...args: infer A) => infer R ? (...args: A) => R : never;
type BoundSources<F> = F extends (store: TStore, sources: TDatasources, ...args: infer A) => infer R
  ? (...args: A) => R
  : never;

type TAppRegistry = {
  [K in keyof typeof storeActions]: BoundStore<(typeof storeActions)[K]>;
} & {
  [K in keyof typeof sourceActions]: BoundSources<(typeof sourceActions)[K]>;
};

function createRegistry(store: TStore, sources: TDatasources): TAppRegistry {
  const registry: Record<string, Function> = {};
  for (const [name, action] of Object.entries(storeActions)) {
    registry[name] = (action as Function).bind(null, store);
  }
  for (const [name, action] of Object.entries(sourceActions)) {
    registry[name] = (action as Function).bind(null, store, sources);
  }
  return registry as TAppRegistry;
}

export { createRegistry, type TAppRegistry };
