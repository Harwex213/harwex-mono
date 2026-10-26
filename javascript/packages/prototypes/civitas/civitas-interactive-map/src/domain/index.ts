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

// world/ — the countries file the editor writes, and the country info file with the
// registration form and the economy of each country: their shapes and their parsers.
export {
  countryDisplayName,
  parseCountriesText,
  type CountriesFile,
  type Country,
} from "./world/countries-file";
export {
  CREDIT_RATINGS,
  parseCountryInfoText,
  type CountryInfo,
  type CountryInfoFile,
  type CountryProfile,
  type CreditRating,
  type EconomySnapshot,
  type ResourceBalance,
  type Sector,
  type SectorKind,
} from "./world/country-info-file";

// interaction/ — the rules of what a click or a drag means.
export {
  EMPTY_SELECTION,
  nextSelection,
  sameSelection,
  type SelectionIntent,
  type SelectionScope,
  type SelectionState,
} from "./interaction/selection";
