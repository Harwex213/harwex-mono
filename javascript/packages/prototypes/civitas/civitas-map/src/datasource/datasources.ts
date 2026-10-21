import {
  createDetectSource,
  type DetectSource,
} from "./detect/detect-source";
import {
  createDownloads,
  type Downloads,
} from "./downloads/downloads";
import {
  createImageCodec,
  type ImageCodec,
} from "./images/images";
import {
  createMapLibrary,
  type MapLibrary,
} from "./map-library/map-library";

// This file builds the object that holds every external system the app talks to.
// An external system is anything outside the app's own memory: the server, the
// browser's image decoder and downloads, a worker thread.

// Actions receive this object as `sources` and call the external systems only
// through it.
type TDatasources = {
  // Lists the map images on the server and fetches the one the operator picks.
  mapLibrary: MapLibrary;
  // Decodes images into a bitmap or into pixels.
  images: ImageCodec;
  // Runs border detection in a web worker.
  detector: DetectSource;
  // Hands the export files to the browser's downloads.
  downloads: Downloads;
};

type DatasourceOptions = Partial<TDatasources>;

// The app calls `createDatasources()` with no options and gets the real systems.
// A test passes fakes through `options`.
function createDatasources(options: DatasourceOptions = {}): TDatasources {
  return {
    mapLibrary: options.mapLibrary ?? createMapLibrary(),
    images: options.images ?? createImageCodec(),
    detector: options.detector ?? createDetectSource(),
    downloads: options.downloads ?? createDownloads(),
  };
}

export {
  createDatasources,
  type DatasourceOptions,
  type TDatasources,
};
