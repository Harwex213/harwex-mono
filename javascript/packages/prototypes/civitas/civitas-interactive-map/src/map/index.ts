// The public surface of `src/map`: pure map logic with no signals and no DOM.
// `src/state` and `src/ui` import from here. Modules inside `src/map` import
// each other by file path, never through this index, so no import cycle can form.
//
// Only names used outside `src/map` are listed. A test imports its own module
// directly.
//
// The border worker is not exported here. `src/state/map/borders-store.ts` starts
// it by file path with `new URL("../../map/borders/borders.worker.ts", import.meta.url)`
// and imports its message types from that file.

// data/ — the map's source data.
// - manifest.ts: types and the strict parser of `assets/provinces_manifest.json`.
// - map-assets.ts: loads the two map PNGs and the manifest.
// - province-index.ts: maps a pixel of the provinces PNG to a province id.
// The folder is not named `assets/`: `scaffold.test.ts` fails any import whose
// path contains `/assets/`, because that is how a map asset leaks into the bundle.
import { indexProvincesById } from "./data/manifest";
import { LOAD_STEPS, loadMapAssets } from "./data/map-assets";
import { packRgb } from "./data/province-index";
import type { Bounds, Province } from "./data/manifest";
import type { LoadStep, LoadedMapAssets } from "./data/map-assets";
import type { ProvinceIndex } from "./data/province-index";

// view/ — the camera and pointer geometry.
// - view.ts: the view transform. Fit, zoom, pan, and map <-> screen coordinates.
// - paint-path.ts: walks the line between two pointer samples, so a fast brush
//   stroke does not skip provinces.
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

// borders/ — the lines between provinces and between countries.
// - borders.ts: extracts the borders and cuts them into tiles.
// - borders.worker.ts: the web worker around borders.ts. Not exported here.
import { TILE_SIZE, buildCountryOf, visibleTiles } from "./borders/borders";
import type { BorderTiles } from "./borders/borders";

// countries/ — geometry of a whole country.
// - country-aggregate.ts: a country's territory. Province count, pixel count,
//   bounds and centroid.
// - label-layout.ts: places the country labels. Font size, anchor point,
//   collisions.
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

export {
  // data/
  LOAD_STEPS,
  indexProvincesById,
  loadMapAssets,
  packRgb,
  type Bounds,
  type LoadStep,
  type LoadedMapAssets,
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
  buildCountryOf,
  visibleTiles,
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
};
