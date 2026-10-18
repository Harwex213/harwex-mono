// The public surface of `src/state`: signals, actions and the code that saves the
// document. `src/ui` and `src/App.tsx` import from here. Modules inside
// `src/state` import each other by file path, never through this index: the
// stores already reference each other, and a store that imported the index would
// form an import cycle.
//
// Only names used outside `src/state` are listed. A test imports its own module
// directly.
//
// Importing this file starts nothing. No module here runs code at the top level
// beyond creating signals. `App.tsx` calls `initWorldStore`, `installStateFlush`,
// `initCountrySync` and `ensureMapLoaded` itself, in that order.
//
// The folders are layers. A lower layer never imports a higher one, except for
// one edge: `interaction/assign-store.ts` calls `flushCountryBorders` from
// `countries/country-store.ts`.
//   map/ <- world/ <- interaction/selection-store <- countries/ <- interaction/assign-store

// map/ — the loaded map and the camera. Imports nothing else from `src/state`
// except `map-store.ts`.
// - map-store.ts: the load status and the loaded assets (bitmaps, manifest,
//   province index), with the lookups `provinceAt` and `provinceById`.
// - view-store.ts: the current view (zoom and pan) that every layer draws with.
// - borders-store.ts: runs the border worker and holds the finished `Path2D`s.
import {
  ensureMapLoaded,
  getMapAssets,
  loadError,
  loadPhase,
  loadProgress,
  loadStep,
  mapSize,
  provinceAt,
  provinceById,
} from "./map/map-store";
import {
  cursorMap,
  dpr,
  mapPixelAt,
  panTo,
  panning,
  resetView,
  setCursor,
  setDpr,
  setViewport,
  syncView,
  view,
  viewFitted,
  viewport,
  zoomAtPoint,
} from "./map/view-store";
import {
  borderError,
  borderPhase,
  borderStats,
  bordersVersion,
  countryBorderStats,
  disposeBorders,
  ensureBordersScanned,
  getCountryBorderPaths,
  getProvinceBorderPaths,
} from "./map/borders-store";

// world/ — the saved document and the stores that own it.
// - schema.ts: the document shape, the serialiser and the repairing parser. Pure.
// - migrations.ts: the migration chain up to `STATE_VERSION`. Pure.
// - persistence.ts: reads and writes the document in storage.
// - world-store.ts: the signals and actions of the world (countries, province
//   ownership) and the debounced write of the document.
import { countryDisplayName } from "./world/schema";
import {
  addCountry,
  countries,
  countryById,
  deleteCountry,
  dismissStateWarning,
  initWorldStore,
  installStateFlush,
  provinceDisplayName,
  stateWarning,
  updateCountry,
} from "./world/world-store";

// countries/ — data derived from the countries for drawing.
// - country-store.ts: the tint words, the country aggregates, and the effect
//   that pushes the province -> country assignment to the border worker.
// - label-store.ts: the label sources, the label toggle and the point-in-country
//   test.
import { countryAggregates, countryTintWords, initCountrySync } from "./countries/country-store";
import { countryContainsPoint, countryLabelSources, showLabels, toggleLabels } from "./countries/label-store";

// interaction/ — what the user is doing right now. Never saved.
// - selection-store.ts: the selection, three slots in one signal, and the hover.
// - assign-store.ts: the assign mode and the state machine of a brush stroke.
import {
  hoveredProvinceId,
  selectCountry,
  selectCountryOfProvince,
  selectProvince,
  selectedCountry,
  selectedCountryId,
  selectedProvinceId,
  selectionScope,
  setHoveredProvince,
} from "./interaction/selection-store";
import {
  activeCountryId,
  assignMode,
  beginStroke,
  cancelStroke,
  endStroke,
  extendStroke,
  painting,
  setActiveCountry,
  setAssignMode,
  toggleAssignMode,
} from "./interaction/assign-store";

export {
  // map/
  borderError,
  borderPhase,
  borderStats,
  bordersVersion,
  countryBorderStats,
  cursorMap,
  disposeBorders,
  dpr,
  ensureBordersScanned,
  ensureMapLoaded,
  getCountryBorderPaths,
  getMapAssets,
  getProvinceBorderPaths,
  loadError,
  loadPhase,
  loadProgress,
  loadStep,
  mapPixelAt,
  mapSize,
  panTo,
  panning,
  provinceAt,
  provinceById,
  resetView,
  setCursor,
  setDpr,
  setViewport,
  syncView,
  view,
  viewFitted,
  viewport,
  zoomAtPoint,
  // world/
  addCountry,
  countries,
  countryById,
  countryDisplayName,
  deleteCountry,
  dismissStateWarning,
  initWorldStore,
  installStateFlush,
  provinceDisplayName,
  stateWarning,
  updateCountry,
  // countries/
  countryAggregates,
  countryContainsPoint,
  countryLabelSources,
  countryTintWords,
  initCountrySync,
  showLabels,
  toggleLabels,
  // interaction/
  activeCountryId,
  assignMode,
  beginStroke,
  cancelStroke,
  endStroke,
  extendStroke,
  hoveredProvinceId,
  painting,
  selectCountry,
  selectCountryOfProvince,
  selectProvince,
  selectedCountry,
  selectedCountryId,
  selectedProvinceId,
  selectionScope,
  setActiveCountry,
  setAssignMode,
  setHoveredProvince,
  toggleAssignMode,
};
