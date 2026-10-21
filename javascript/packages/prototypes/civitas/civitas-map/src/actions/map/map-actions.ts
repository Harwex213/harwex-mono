import { batch } from "@preact/signals-react";
import type { LoadedMap, MapImage, TDatasources } from "../../datasource/index";
import {
  ProvinceLayer,
  isMapImageFile,
} from "../../domain/index";
import type { TStore } from "../../store/index";
import { addProvince } from "../provinces/province-actions";
import { errorMessage } from "../status/status-actions";
import { markLayerChanged } from "./layer-commit";
import { fitToViewport } from "./view-actions";

// Dev builds serve `assets/maps/map.png` from the package folder (see the rspack
// config), which saves picking the map on every reload.
const SAMPLE_IMAGE: MapImage = {
  name: "map.png",
  url: "/assets/maps/map.png",
  bytes: 0,
  manifestUrl: null,
};

// A new map replaces everything: the layer, the registry, the history.
function adoptMap(store: TStore, loaded: LoadedMap): void {
  batch(() => {
    store.map.bitmap.value?.close();
    store.map.bitmap.value = loaded.bitmap;
    store.map.layer.value = new ProvinceLayer(loaded.width, loaded.height);
    store.map.info.value = { name: loaded.name, width: loaded.width, height: loaded.height };
    store.status.notice.value = null;
    store.provinces.list.value = [];
    store.provinces.nextId.value = 1;
    store.provinces.activeId.value = null;
    store.hover.pixel.value = null;
    store.hover.color.value = 0;
    store.map.historyRevision.value += 1;

    // A fresh map starts with one province, so the brush is usable straight away
    // instead of refusing the first stroke.
    addProvince(store);
    fitToViewport(store);
    markLayerChanged(store);
  });
}

async function openMap(store: TStore, load: () => Promise<LoadedMap>): Promise<void> {
  store.status.loading.value = true;
  store.status.error.value = null;

  try {
    adoptMap(store, await load());
  } catch (cause) {
    store.status.error.value = errorMessage(cause);
  } finally {
    store.status.loading.value = false;
  }
}

// A map file dropped on the window.
function openMapFile(store: TStore, sources: TDatasources, file: File): Promise<void> {
  return openMap(store, async () => {
    if (!isMapImageFile(file)) {
      throw new Error(`${file.name} is not a png, jpg or webp image`);
    }

    return sources.images.decodeMap(file, file.name);
  });
}

// An image picked in the map library.
function openMapImage(store: TStore, sources: TDatasources, image: MapImage): Promise<void> {
  return openMap(store, async () => {
    return sources.images.decodeMap(await sources.mapLibrary.fetchImage(image), image.name);
  });
}

function openSampleMap(store: TStore, sources: TDatasources): Promise<void> {
  return openMapImage(store, sources, SAMPLE_IMAGE);
}

export {
  openMapFile,
  openMapImage,
  openSampleMap,
};
