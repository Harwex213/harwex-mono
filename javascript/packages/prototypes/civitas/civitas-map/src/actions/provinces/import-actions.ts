import { batch } from "@preact/signals-react";
import type { TDatasources } from "../../datasource/index";
import {
  adoptStrayColors,
  dropPartialAlpha,
  importNotice,
  isCountriesFile,
  isJsonFile,
  isPngFile,
  nextIdAfter,
  parseCountriesFile,
  parseManifest,
  scanColors,
  withHex,
} from "../../domain/index";
import type { TStore } from "../../store/index";
import { replaceCountries } from "../countries/country-actions";
import { markLayerChanged } from "../map/layer-commit";
import { errorMessage } from "../status/status-actions";

// The parts of a provinces export, from whichever source supplied them.
type ProvinceExport = {
  image: Blob | null;
  manifestText: string | null;
  countriesText: string | null;
};

// The sentence the import notice ends with, or "" without a countries file.
function countriesSentence(loaded: number, skippedCountries: number, skippedProvinces: number): string {
  const parts = [`Loaded ${loaded} ${loaded === 1 ? "country" : "countries"}.`];

  if (skippedCountries > 0) {
    parts.push(`Skipped ${skippedCountries} unreadable ${skippedCountries === 1 ? "country" : "countries"}.`);
  }

  if (skippedProvinces > 0) {
    parts.push(`Skipped ${skippedProvinces} unknown or doubly claimed province ${skippedProvinces === 1 ? "id" : "ids"}.`);
  }

  return parts.join(" ");
}

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

    // All parts are read before any is applied, so a broken manifest leaves
    // the layer as it was instead of half-loading over it.
    const parsed =
      source.manifestText !== null ? parseManifest(source.manifestText, info.width, info.height) : null;
    const pixels = source.image
      ? await sources.images.decodeProvinces(source.image, info.width, info.height)
      : null;
    const dropped = pixels ? dropPartialAlpha(pixels) : null;

    // A countries file of the wrong format throws here, before anything is
    // applied. Its province ids are checked once the registry is known.
    if (source.countriesText !== null) {
      parseCountriesFile(source.countriesText, () => true);
    }

    batch(() => {
      if (pixels) {
        layer.loadPixels(pixels);
      }

      const listed = (parsed?.records ?? []).map(withHex);
      const next = adoptStrayColors(listed, scanColors(layer).keys());
      const known = new Set(next.map((province) => province.id));
      // Country ids point at province ids, so the countries of an earlier
      // registry are dropped rather than carried over to the new one.
      const countries = source.countriesText !== null
        ? parseCountriesFile(source.countriesText, (id) => known.has(id))
        : null;

      store.provinces.list.value = next;
      replaceCountries(store, countries?.countries ?? []);
      store.provinces.nextId.value = nextIdAfter(next);
      store.provinces.activeId.value = next[0]?.id ?? null;
      store.hover.pixel.value = null;
      store.hover.color.value = 0;
      store.map.historyRevision.value += 1;
      markLayerChanged(store);

      const notice = importNotice({
        listed: listed.length,
        adopted: next.length - listed.length,
        skipped: parsed ? parsed.skipped : null,
        dropped,
        manifestSource: parsed?.source ?? null,
        mapName: info.name,
      });

      store.status.notice.value = countries
        ? `${notice} ${countriesSentence(countries.countries.length, countries.skippedCountries, countries.skippedProvinces)}`
        : notice;
    });
  } catch (cause) {
    store.status.error.value = errorMessage(cause);
  } finally {
    store.status.loading.value = false;
  }
}

// Files dropped on the window: the provinces PNG, the JSON manifest, or both,
// and the countries file.
async function importProvinceFiles(store: TStore, sources: TDatasources, files: readonly File[]): Promise<void> {
  const imageFile = files.find(isPngFile) ?? null;
  const manifestFile = files.find((file) => isJsonFile(file) && !isCountriesFile(file)) ?? null;
  const countriesFile = files.find(isCountriesFile) ?? null;

  if (store.map.info.value && !imageFile && !manifestFile) {
    store.status.error.value = "Pick an exported provinces PNG, its JSON manifest, or both";

    return;
  }

  await loadProvinces(store, sources, async () => {
    return {
      image: imageFile,
      manifestText: manifestFile ? await manifestFile.text() : null,
      countriesText: countriesFile ? await countriesFile.text() : null,
    };
  });
}

export {
  importProvinceFiles,
  loadProvinces,
  type ProvinceExport,
};
