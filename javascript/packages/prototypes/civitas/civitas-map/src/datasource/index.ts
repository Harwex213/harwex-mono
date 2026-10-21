// `src/datasource` holds all code that talks to systems outside the app's memory.
// Each subfolder covers one system. This file lists what the rest of the app may
// import from the folder.
// Decisions:
// - Datasource modules import each other by file path, not through this index, so no cycle can form.
// - Only names used outside `src/datasource` are listed. Tests import their module directly.

// datasources.ts — `createDatasources()`: builds the one object that holds every source;
// actions receive it as `sources`. The app passes no options and gets the real sources.
export {
  createDatasources,
  type DatasourceOptions,
  type TDatasources,
} from "./datasources";

// map-library/ — the list of map images on the server (`GET api/maps`) and the fetch of one image.
export {
  type MapImage,
  type MapLibrary,
} from "./map-library/map-library";

// images/ — `createImageBitmap` and canvas reads: the map bitmap, the pixels of a provinces image.
export {
  type ImageCodec,
  type LoadedMap,
} from "./images/images";

// detect/ — border detection in a web worker. `detect-worker.ts` is the worker itself.
export {
  type DetectOutcome,
  type DetectSource,
} from "./detect/detect-source";

// downloads/ — the export files handed to the browser's downloads.
export {
  type Downloads,
} from "./downloads/downloads";
