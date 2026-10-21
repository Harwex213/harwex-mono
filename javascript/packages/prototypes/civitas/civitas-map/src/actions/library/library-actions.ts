import type { MapImage, TDatasources } from "../../datasource/index";
import type { LibraryMode, TStore } from "../../store/index";
import { openMapImage } from "../map/map-actions";
import { loadProvinces } from "../provinces/import-actions";
import { errorMessage } from "../status/status-actions";

// The map library dialog: `Load map…` and `Load provinces…` open it, a pick
// closes it and loads the image.

async function openLibrary(store: TStore, sources: TDatasources, mode: LibraryMode): Promise<void> {
  if (mode === "provinces" && !store.map.info.value) {
    store.status.error.value = "Load the map image before loading provinces into it";

    return;
  }

  store.library.requestId.value += 1;

  const requestId = store.library.requestId.value;
  const isCurrent = (): boolean => {
    return requestId === store.library.requestId.value && store.library.state.value !== null;
  };

  store.library.state.value = { mode, status: "loading", images: [], error: null };

  try {
    const images = await sources.mapLibrary.listImages();

    if (isCurrent()) {
      store.library.state.value = { mode, status: "ready", images, error: null };
    }
  } catch (cause) {
    if (isCurrent()) {
      store.library.state.value = { mode, status: "failed", images: [], error: errorMessage(cause) };
    }
  }
}

function retryLibrary(store: TStore, sources: TDatasources): Promise<void> {
  const current = store.library.state.value;

  if (!current) {
    return Promise.resolve();
  }

  return openLibrary(store, sources, current.mode);
}

function closeLibrary(store: TStore): void {
  store.library.requestId.value += 1;
  store.library.state.value = null;
}

// The dialog closes first; the top bar then shows the load as it does for any
// other source.
function pickLibraryImage(store: TStore, sources: TDatasources, image: MapImage): Promise<void> {
  const current = store.library.state.value;

  closeLibrary(store);

  if (!current) {
    return Promise.resolve();
  }

  if (current.mode === "map") {
    return openMapImage(store, sources, image);
  }

  return loadProvinces(store, sources, async () => {
    const [imageBlob, manifestText] = await Promise.all([
      sources.mapLibrary.fetchImage(image),
      sources.mapLibrary.fetchManifest(image),
    ]);

    return { image: imageBlob, manifestText };
  });
}

export {
  closeLibrary,
  openLibrary,
  pickLibraryImage,
  retryLibrary,
};
