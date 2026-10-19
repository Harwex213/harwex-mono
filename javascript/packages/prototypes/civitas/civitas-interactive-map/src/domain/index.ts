// The public surface of `src/domain`: pure logic, no signals, no DOM, no I/O.
// Decisions:
// - Domain modules import each other by file path, not through this index, so no cycle can form.
// - Only names used outside `src/domain` are listed. Tests import their module directly.

// data/ — the map's source data. Loading it is I/O in `src/datasource/map-assets.ts`.
// The folder is not named `assets/`: a test fails any import path with `/assets/`.
import { indexProvincesById, parseManifestText } from "./data/manifest";
import { createProvinceIndex, packRgb, sampleIntegrity } from "./data/province-index";
import type { Bounds, MapManifest, Province } from "./data/manifest";
import type { ProvinceIndex } from "./data/province-index";
import { LOAD_STEPS } from "./data/loaded-map";
import type { LoadStep, LoadedMapAssets } from "./data/loaded-map";

// view/ — the camera and pointer geometry.
import {
  fitView,
  isFittedScale,
  mapToScreen,
  resizeView,
  screenToMap,
  shouldSmooth,
  snapView,
  sourceRect,
  translateTo,
  zoomAt,
} from "./view/view";
import { samplePathPixels } from "./view/paint-path";
import type { DrawRect, Point, Size, View } from "./view/view";

// borders/ — province and country borders. The worker is `src/datasource/borders-worker.ts`.
import {
  TILE_SIZE,
  buildBorderTiles,
  buildCountryOf,
  countryRuns,
  mapPixelsToIds,
  scanBorders,
  visibleTiles,
} from "./borders/borders";
import type { BorderCrossings, BorderTiles } from "./borders/borders";

// countries/ — geometry of a whole country: its territory and its label.
import { aggregateCountry } from "./countries/country-aggregate";
import { labelFontSize, layoutLabels, resolveLabelAnchor } from "./countries/label-layout";
import type { CountryAggregate } from "./countries/country-aggregate";
import type {
  AnchorCandidate,
  ContainsFn,
  CountryLabelSource,
  LabelCandidate,
  LabelPlacement,
} from "./countries/label-layout";

// world/ — the saved document: its schema and its migrations.
import {
  LORE_MAX,
  MAX_COUNTRY_ID,
  NAME_MAX,
  SLOGAN_MAX,
  STATE_VERSION,
  clampText,
  countryDisplayName,
  createCountry,
  createEmptyState,
  isImageDataUrl,
  isPlainObject,
  normalizeState,
  serializeState,
} from "./world/schema";
import { MIGRATIONS, runMigrations } from "./world/migrations";
import type { CivitasState, Country, ProvinceOverride } from "./world/schema";
import type { Migration, MigrationDoc } from "./world/migrations";

// interaction/ — the rules of what a click or a drag means.
import { EMPTY_SELECTION, nextSelection, sameSelection } from "./interaction/selection";
import { strokeActionFor } from "./interaction/stroke";
import type { SelectionIntent, SelectionScope, SelectionState } from "./interaction/selection";
import type { StrokeAction } from "./interaction/stroke";

export {
  // data/
  LOAD_STEPS,
  createProvinceIndex,
  indexProvincesById,
  packRgb,
  parseManifestText,
  sampleIntegrity,
  type Bounds,
  type LoadStep,
  type LoadedMapAssets,
  type MapManifest,
  type Province,
  type ProvinceIndex,
  // view/
  fitView,
  isFittedScale,
  mapToScreen,
  resizeView,
  samplePathPixels,
  screenToMap,
  shouldSmooth,
  snapView,
  sourceRect,
  translateTo,
  zoomAt,
  type DrawRect,
  type Point,
  type Size,
  type View,
  // borders/
  TILE_SIZE,
  buildBorderTiles,
  buildCountryOf,
  countryRuns,
  mapPixelsToIds,
  scanBorders,
  visibleTiles,
  type BorderCrossings,
  type BorderTiles,
  // countries/
  aggregateCountry,
  labelFontSize,
  layoutLabels,
  resolveLabelAnchor,
  type AnchorCandidate,
  type ContainsFn,
  type CountryAggregate,
  type CountryLabelSource,
  type LabelCandidate,
  type LabelPlacement,
  // world/
  LORE_MAX,
  MAX_COUNTRY_ID,
  MIGRATIONS,
  NAME_MAX,
  SLOGAN_MAX,
  STATE_VERSION,
  clampText,
  countryDisplayName,
  createCountry,
  createEmptyState,
  isImageDataUrl,
  isPlainObject,
  normalizeState,
  runMigrations,
  serializeState,
  type CivitasState,
  type Country,
  type Migration,
  type MigrationDoc,
  type ProvinceOverride,
  // interaction/
  EMPTY_SELECTION,
  nextSelection,
  sameSelection,
  strokeActionFor,
  type SelectionIntent,
  type SelectionScope,
  type SelectionState,
  type StrokeAction,
};
