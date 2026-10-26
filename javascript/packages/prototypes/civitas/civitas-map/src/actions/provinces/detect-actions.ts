import { batch } from "@preact/signals-react";
import type { TDatasources } from "../../datasource/index";
import {
  detectionNotice,
  withHex,
  type DetectOptions,
} from "../../domain/index";
import type { TStore } from "../../store/index";
import { replaceCountries } from "../countries/country-actions";
import { markLayerChanged } from "../map/layer-commit";
import { errorMessage } from "../status/status-actions";

// Rebuilds the province layer from borders drawn into the base map. Replaces the
// layer and the registry wholesale and drops the countries; the UI asks first when there is work to lose.
async function detectFromBaseMap(
  store: TStore,
  sources: TDatasources,
  options: Partial<DetectOptions> = {},
): Promise<void> {
  const layer = store.map.layer.value;
  const bitmap = store.map.bitmap.value;
  const info = store.map.info.value;

  if (!layer || !bitmap || !info) {
    store.status.error.value = "Load a map image first";

    return;
  }

  store.status.detecting.value = true;
  store.status.error.value = null;
  store.status.notice.value = null;

  try {
    const rgba = sources.images.readMapPixels(bitmap);
    const outcome = await sources.detector.detect(rgba, info.width, info.height, options);

    batch(() => {
      layer.loadPixels(outcome.pixels);
      store.provinces.list.value = outcome.provinces.map((province) => {
        return withHex({
          id: province.index,
          name: `Province ${province.index}`,
          kind: "land",
          color: province.color,
        });
      });
      store.provinces.nextId.value = outcome.provinces.length + 1;
      store.provinces.activeId.value = store.provinces.list.value[0]?.id ?? null;
      replaceCountries(store, []);
      store.hover.pixel.value = null;
      store.hover.color.value = 0;
      store.map.historyRevision.value += 1;
      markLayerChanged(store);
      store.status.notice.value = detectionNotice(outcome.provinces.length, outcome.stats);
    });
  } catch (cause) {
    store.status.error.value = errorMessage(cause);
  } finally {
    store.status.detecting.value = false;
  }
}

export { detectFromBaseMap };
