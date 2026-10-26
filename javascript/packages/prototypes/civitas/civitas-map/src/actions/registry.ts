import {
  beginStroke,
  clearLayer,
  endStroke,
  extendStroke,
  fillAt,
  pickAt,
  redo,
  setHover,
  undo,
} from "./map/layer-actions";
import {
  closeLibrary,
  openLibrary,
  pickLibraryImage,
  retryLibrary,
} from "./library/library-actions";
import {
  addCountry,
  beginCountryStroke,
  deleteCountry,
  endCountryStroke,
  extendCountryStroke,
  recolorCountry,
  renameCountry,
  selectCountry,
} from "./countries/country-actions";
import { detectFromBaseMap } from "./provinces/detect-actions";
import {
  dismissError,
  dismissNotice,
  showError,
} from "./status/status-actions";
import { exportAll } from "./provinces/export-actions";
import { importProvinceFiles } from "./provinces/import-actions";
import { openMapFile } from "./map/map-actions";
import {
  addProvince,
  deleteProvince,
  recolorProvince,
  renameProvince,
  selectProvince,
  setProvinceKind,
} from "./provinces/province-actions";
import {
  setBrushShape,
  setBrushSize,
  setLayerOpacity,
  setLayerVisible,
  setMode,
  setShowBaseMap,
  setTool,
  stepBrushSize,
  toggleLayerVisible,
} from "./tools/tool-actions";
import {
  fitToViewport,
  measureViewport,
  panTo,
  zoomAtPoint,
  zoomCentre,
} from "./map/view-actions";
import type { TDatasources } from "../datasource/index";
import type { TStore } from "../store/index";

// The only way the UI changes state. Actions stay plain functions over the store;
// the registry binds the store and the datasources.
// A component declares what it uses with `Pick<TAppRegistry, ...>`.

// Actions that only read and write the store.
const storeActions = {
  addCountry,
  addProvince,
  beginCountryStroke,
  beginStroke,
  clearLayer,
  closeLibrary,
  deleteCountry,
  deleteProvince,
  dismissError,
  dismissNotice,
  endCountryStroke,
  endStroke,
  extendCountryStroke,
  extendStroke,
  fillAt,
  fitToViewport,
  measureViewport,
  panTo,
  pickAt,
  recolorCountry,
  recolorProvince,
  redo,
  renameCountry,
  renameProvince,
  selectCountry,
  selectProvince,
  setBrushShape,
  setBrushSize,
  setHover,
  setLayerOpacity,
  setLayerVisible,
  setMode,
  setProvinceKind,
  setShowBaseMap,
  setTool,
  showError,
  stepBrushSize,
  toggleLayerVisible,
  undo,
  zoomAtPoint,
  zoomCentre,
};

// Actions that also call a datasource.
const sourceActions = {
  detectFromBaseMap,
  exportAll,
  importProvinceFiles,
  openLibrary,
  openMapFile,
  pickLibraryImage,
  retryLibrary,
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

export {
  createRegistry,
  type TAppRegistry,
};
