import type { TDatasources } from "../../datasource/index";
import {
  baseName,
  buildCountriesFile,
  buildManifest,
} from "../../domain/index";
import type { TStore } from "../../store/index";
import { errorMessage } from "../status/status-actions";

// Writes `<map>-provinces.png`, `<map>-provinces.json` and, when there are
// countries, `<map>-provinces.countries.json`.
async function exportAll(store: TStore, sources: TDatasources): Promise<void> {
  const layer = store.map.layer.value;
  const info = store.map.info.value;

  if (!layer || !info) {
    return;
  }

  store.status.exporting.value = true;
  store.status.error.value = null;

  try {
    const stem = `${baseName(info.name)}-provinces`;
    const manifest = buildManifest(layer, store.provinces.list.value, info.name);

    await sources.downloads.downloadPixelsPng(layer.readPixels(), layer.width, layer.height, `${stem}.png`);
    sources.downloads.downloadJson(manifest, `${stem}.json`);

    if (store.countries.list.value.length > 0) {
      sources.downloads.downloadJson(buildCountriesFile(store.countries.list.value), `${stem}.countries.json`);
    }
  } catch (cause) {
    store.status.error.value = errorMessage(cause);
  } finally {
    store.status.exporting.value = false;
  }
}

export { exportAll };
