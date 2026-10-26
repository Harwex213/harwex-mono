// The public surface of `src/domain`: the editor's rules about colours, brushes,
// the view, the province layer, the manifest format and border detection.
// Pure: no signals, no DOM, no I/O.
// Decisions:
// - Domain modules import each other by file path, not through this index, so no cycle can form.
// - Only names used outside `src/domain` are listed. Tests import their module directly.

// colors/ — the packed RGBA word that identifies a province, hex and generated colours.
export {
  fromHex,
  pack,
  packOpaque,
  toHex,
  unpack,
  type Rgb,
} from "./colors/colors";

// brush/ — brush tips as horizontal spans, and the size limits.
export {
  MAX_SIZE,
  MIN_SIZE,
  buildMask,
  clampSize,
  type BrushMask,
  type BrushShape,
} from "./brush/brush";

// view/ — the map -> screen transform: fit, zoom at a point, zoom around the centre.
export {
  fit,
  screenToMap,
  zoomAround,
  zoomAt,
  type Size,
  type View,
} from "./view/view";

// layer/ — the province layer: pixels, strokes, fill, undo, and the dirty rectangle the renderer uploads.
export {
  ProvinceLayer,
  type Rect,
} from "./layer/province-layer";
export {
  dropPartialAlpha,
} from "./layer/opaque-pixels";

// manifest/ — building the export manifest and parsing one back in.
export {
  buildManifest,
  scanColors,
  type Manifest,
  type ProvinceKind,
} from "./manifest/manifest";
export {
  parseManifest,
} from "./manifest/parse-manifest";

// detect/ — finding provinces from borders drawn into the map, and colouring the result.
export {
  detectProvinces,
  type DetectOptions,
  type DetectStats,
} from "./detect/detect-provinces";
export {
  colorizeLabels,
  type DetectedProvince,
} from "./detect/colorize";

// files/ — what a file is, judged from its name and type, and the base name of an export.
export {
  baseName,
  isCountriesFile,
  isJsonFile,
  isMapImageFile,
  isPngFile,
} from "./files/file-types";

// provinces/ — the province registry rules and the sentences that report an import or a detection.
export {
  adoptStrayColors,
  createProvince,
  detectionNotice,
  importNotice,
  nextIdAfter,
  takenColors,
  withHex,
  type Province,
} from "./provinces/provinces";

// interaction/ — what a press on the map means.
export {
  classifyPress,
  type EditorMode,
  type Press,
  type Tool,
} from "./interaction/press";

// countries/ — countries as groups of provinces, the countries file, and the
// per-pixel province index the countries view is coloured from.
export {
  assignProvinces,
  createCountry,
  keepProvinces,
  nextCountryIdAfter,
  ownerOf,
  strokeActionFor,
  type Country,
  type StrokeAction,
} from "./countries/countries";
export {
  buildCountriesFile,
  parseCountriesFile,
} from "./countries/countries-file";
export {
  buildProvinceIndex,
  paintSlots,
  provinceAtPixel,
  unionRect,
  type ProvinceIndex,
} from "./countries/province-index";
