import { batch } from "@preact/signals-react";
import type {
  ServerMap,
  TDatasources,
} from "../../datasource/index";
import {
  adoptStrayColors,
  dropPartialAlpha,
  isPngFile,
  nextIdAfter,
  paintCountryPixels,
  planSave,
  restoreCountries,
  saveNotice,
  scanColors,
  seedProvinces,
} from "../../domain/index";
import type { TStore } from "../../store/index";
import { replaceCountries } from "../countries/country-actions";
import { markLayerChanged } from "../map/layer-commit";
import { adoptMap } from "../map/map-actions";
import { errorMessage } from "../status/status-actions";
import { applyServerLayout } from "./layout-binding";

// The backend: the maps dialog (`Maps…`), a new map, opening a stored map with
// its countries, provinces and layer images, and `Save`.

function isCurrentDialog(store: TStore, requestId: number): boolean {
  return requestId === store.server.requestId.value && store.server.dialog.value !== null;
}

async function openServerMaps(store: TStore, sources: TDatasources): Promise<void> {
  store.server.requestId.value += 1;

  const requestId = store.server.requestId.value;

  store.server.dialog.value = { status: "loading", maps: [], error: null, creating: false, createError: null };

  try {
    const maps = await sources.api.listMaps();

    if (isCurrentDialog(store, requestId)) {
      store.server.dialog.value = { status: "ready", maps, error: null, creating: false, createError: null };
    }
  } catch (cause) {
    if (isCurrentDialog(store, requestId)) {
      store.server.dialog.value = {
        status: "failed",
        maps: [],
        error: errorMessage(cause),
        creating: false,
        createError: null,
      };
    }
  }
}

function closeServerMaps(store: TStore): void {
  store.server.requestId.value += 1;
  store.server.dialog.value = null;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

// Fetches the image, the stored layout and the layer images together, and only
// then replaces the open map, so a failed request leaves the editor as it was.
// The province layer image is painted back into the layer, so its provinces are
// editable straight away; the countries image then restores which province is
// in which country.
async function openServerMap(store: TStore, sources: TDatasources, map: ServerMap): Promise<void> {
  store.status.loading.value = true;
  store.status.error.value = null;

  try {
    const [image, layout, provincesImage, countriesImage] = await Promise.all([
      sources.api.fetchMapImage(map),
      sources.api.fetchLayout(map.id),
      sources.api.fetchLayerImage(map, "provinces"),
      sources.api.fetchLayerImage(map, "countries"),
    ]);
    const loaded = await sources.images.decodeMap(image, map.name);
    const provincePixels = provincesImage
      ? await sources.images.decodeProvinces(provincesImage, loaded.width, loaded.height)
      : null;
    const countryPixels = countriesImage
      ? await sources.images.decodeProvinces(countriesImage, loaded.width, loaded.height)
      : null;

    if (provincePixels) {
      dropPartialAlpha(provincePixels);
    }

    if (countryPixels) {
      dropPartialAlpha(countryPixels);
    }

    batch(() => {
      adoptMap(store, loaded);
      store.server.map.value = map;
      store.server.layout.value = layout;

      const layer = store.map.layer.value;
      const seeded = seedProvinces(layout);
      let list = seeded;

      if (provincePixels && layer) {
        layer.loadPixels(provincePixels);
        list = adoptStrayColors(seeded, scanColors(layer).keys());
      }

      if (list.length === 0) {
        return;
      }

      store.provinces.list.value = list;
      store.provinces.nextId.value = nextIdAfter(list);
      store.provinces.activeId.value = list[0].id;
      replaceCountries(store, []);
      applyServerLayout(store);

      if (countryPixels && layer) {
        const restored = restoreCountries(
          layer.readPixels(),
          countryPixels,
          store.provinces.list.value,
          store.countries.list.value,
        );

        replaceCountries(store, restored.countries);
      }

      markLayerChanged(store);

      const parts = [
        `Loaded ${plural(layout.countries.length, "country", "countries")} and ` +
          `${plural(list.length, "province", "provinces")} from the backend.`,
      ];

      if (!provincePixels) {
        parts.push("The province layer was never saved: detect borders or load provinces to paint them; they are matched by colour.");
      }

      store.status.notice.value = parts.join(" ");
    });
  } catch (cause) {
    store.status.error.value = errorMessage(cause);
  } finally {
    store.status.loading.value = false;
  }
}

// The dialog closes first; the top bar then shows the load.
function pickServerMap(store: TStore, sources: TDatasources, map: ServerMap): Promise<void> {
  closeServerMaps(store);

  return openServerMap(store, sources, map);
}

// Uploads a new map and opens it. The backend takes png only.
async function createServerMap(store: TStore, sources: TDatasources, name: string, image: File | null): Promise<void> {
  const current = store.server.dialog.value;

  if (!current || current.creating) {
    return;
  }

  const fail = (createError: string): void => {
    const latest = store.server.dialog.value;

    if (latest) {
      store.server.dialog.value = { ...latest, creating: false, createError };
    }
  };

  if (name.trim().length === 0) {
    fail("Name the map");

    return;
  }

  if (!image || !isPngFile(image)) {
    fail("Pick a png image");

    return;
  }

  const requestId = store.server.requestId.value;

  store.server.dialog.value = { ...current, creating: true, createError: null };

  try {
    const map = await sources.api.createMap(name.trim(), image);

    if (!isCurrentDialog(store, requestId)) {
      return;
    }

    await pickServerMap(store, sources, map);
  } catch (cause) {
    if (isCurrentDialog(store, requestId)) {
      fail(errorMessage(cause));
    }
  }
}

// Uploads the province layer and the countries image of it. Both replace what
// the backend held, so they always carry the editor's current state. Answers
// the map with its new image urls.
async function saveLayerImages(store: TStore, sources: TDatasources, map: ServerMap): Promise<ServerMap> {
  const layer = store.map.layer.value;

  if (!layer) {
    return map;
  }

  const pixels = layer.readPixels();
  const countryPixels = paintCountryPixels(pixels, store.provinces.list.value, store.countries.list.value);
  const [provincesPng, countriesPng] = await Promise.all([
    sources.images.encodePng(pixels, layer.width, layer.height),
    sources.images.encodePng(countryPixels, layer.width, layer.height),
  ]);

  await sources.api.saveLayerImage(map.id, "provinces", provincesPng);

  return sources.api.saveLayerImage(map.id, "countries", countriesPng);
}

// Replaces everything the backend holds for the map with the editor's state:
// the countries with their provinces in one request, so a country or province
// deleted in the editor is deleted there too, then the province layer and
// countries images.
async function saveToServer(store: TStore, sources: TDatasources): Promise<void> {
  const map = store.server.map.value;

  if (!map || !store.server.layout.value) {
    store.status.error.value = "Open a map from the backend with Maps… before saving";

    return;
  }

  store.status.saving.value = true;
  store.status.error.value = null;
  store.status.notice.value = null;

  const layer = store.map.layer.value;
  const painted = layer ? new Set(scanColors(layer).keys()) : null;
  const plan = planSave(
    store.provinces.list.value,
    store.countries.list.value,
    painted && painted.size > 0 ? painted : null,
  );

  try {
    const saved = await sources.api.saveLayout(map.id, plan.layout);

    if (store.server.map.value === map) {
      store.server.layout.value = saved;
    }

    const withLayers = await saveLayerImages(store, sources, map);

    if (store.server.map.value === map) {
      store.server.map.value = withLayers;
    }

    store.status.notice.value = saveNotice(saved, plan);
  } catch (cause) {
    store.status.error.value = `Save failed: ${errorMessage(cause)}`;
  } finally {
    store.status.saving.value = false;
  }
}

export {
  closeServerMaps,
  createServerMap,
  openServerMaps,
  pickServerMap,
  saveToServer,
};
