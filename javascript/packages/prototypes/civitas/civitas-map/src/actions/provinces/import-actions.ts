import { batch } from "@preact/signals-react";
import type { TDatasources } from "../../datasource/index";
import {
  adoptStrayColors,
  dropPartialAlpha,
  importNotice,
  isJsonFile,
  isPngFile,
  nextIdAfter,
  parseManifest,
  scanColors,
  withHex,
} from "../../domain/index";
import type { TStore } from "../../store/index";
import { markLayerChanged } from "../map/layer-commit";
import { errorMessage } from "../status/status-actions";

// The two halves of a provinces export, from whichever source supplied them.
type ProvinceExport = {
  image: Blob | null;
  manifestText: string | null;
};

// Loads an export back in: the province PNG, its manifest, or both. The base map
// has to be open first, because the layer is sized from it and a province image
// of another size cannot be placed.
async function loadProvinces(
  store: TStore,
  sources: TDatasources,
  read: () => Promise<ProvinceExport>,
): Promise<void> {
  const layer = store.map.layer.value;
  const info = store.map.info.value;

  if (!layer || !info) {
    store.status.error.value = "Load the map image before loading provinces into it";

    return;
  }

  store.status.loading.value = true;
  store.status.error.value = null;
  store.status.notice.value = null;

  try {
    const source = await read();

    // Both halves are read before either is applied, so a broken manifest leaves
    // the layer as it was instead of half-loading over it.
    const parsed =
      source.manifestText !== null ? parseManifest(source.manifestText, info.width, info.height) : null;
    const pixels = source.image
      ? await sources.images.decodeProvinces(source.image, info.width, info.height)
      : null;
    const dropped = pixels ? dropPartialAlpha(pixels) : null;

    batch(() => {
      if (pixels) {
        layer.loadPixels(pixels);
      }

      const listed = (parsed?.records ?? []).map(withHex);
      const next = adoptStrayColors(listed, scanColors(layer).keys());

      store.provinces.list.value = next;
      store.provinces.nextId.value = nextIdAfter(next);
      store.provinces.activeId.value = next[0]?.id ?? null;
      store.hover.pixel.value = null;
      store.hover.color.value = 0;
      store.map.historyRevision.value += 1;
      markLayerChanged(store);

      store.status.notice.value = importNotice({
        listed: listed.length,
        adopted: next.length - listed.length,
        skipped: parsed ? parsed.skipped : null,
        dropped,
        manifestSource: parsed?.source ?? null,
        mapName: info.name,
      });
    });
  } catch (cause) {
    store.status.error.value = errorMessage(cause);
  } finally {
    store.status.loading.value = false;
  }
}

// Files dropped on the window: the provinces PNG, the JSON manifest, or both.
async function importProvinceFiles(store: TStore, sources: TDatasources, files: readonly File[]): Promise<void> {
  const imageFile = files.find(isPngFile) ?? null;
  const manifestFile = files.find(isJsonFile) ?? null;

  if (store.map.info.value && !imageFile && !manifestFile) {
    store.status.error.value = "Pick an exported provinces PNG, its JSON manifest, or both";

    return;
  }

  await loadProvinces(store, sources, async () => {
    return {
      image: imageFile,
      manifestText: manifestFile ? await manifestFile.text() : null,
    };
  });
}

export {
  importProvinceFiles,
  loadProvinces,
  type ProvinceExport,
};
