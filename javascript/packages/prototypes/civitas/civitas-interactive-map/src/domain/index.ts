// The public surface of `src/domain`: pure logic, no signals, no DOM, no I/O.
// Decisions:
// - Domain modules import each other by file path, not through this index, so no cycle can form.
// - Only names used outside `src/domain` are listed. Tests import their module directly.

// data/ — the map's source data. Loading it is I/O in `src/datasource/map-assets/map-assets.ts`.
// The folder is not named `assets/`: a test fails any import path with `/assets/`.
export {
  parseManifestText,
  type Bounds,
  type MapManifest,
  type Province,
} from "./data/manifest";
export {
  ProvinceIndex,
} from "./data/province-index";

// view/ — the camera and pointer geometry.
export {
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
  type DrawRect,
  type Point,
  type Size,
  type View,
} from "./view/view";
export {
  samplePathPixels,
} from "./view/paint-path";

// borders/ — province and country borders. The worker is `src/datasource/borders/borders-worker.ts`.
export {
  TILE_SIZE,
  buildBorderTiles,
  buildCountryOf,
  countryRuns,
  mapPixelsToIds,
  scanBorders,
  visibleTiles,
  type BorderCrossings,
  type BorderTiles,
} from "./borders/borders";

// countries/ — geometry of a whole country: its territory and its label.
export {
  aggregateCountry,
  type CountryAggregate,
} from "./countries/country-aggregate";
export {
  labelFontSize,
  layoutLabels,
  resolveLabelAnchor,
  type AnchorCandidate,
  type ContainsFn,
  type CountryLabelSource,
  type LabelCandidate,
  type LabelPlacement,
} from "./countries/label-layout";

// world/ — the saved document: its schema and its migrations.
export {
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
  type CivitasState,
  type Country,
  type ProvinceOverride,
} from "./world/schema";
export {
  MIGRATIONS,
  runMigrations,
  type Migration,
  type MigrationDoc,
} from "./world/migrations";

// interaction/ — the rules of what a click or a drag means.
export {
  EMPTY_SELECTION,
  nextSelection,
  sameSelection,
  type SelectionIntent,
  type SelectionScope,
  type SelectionState,
} from "./interaction/selection";
export {
  strokeActionFor,
  type StrokeAction,
} from "./interaction/stroke";
