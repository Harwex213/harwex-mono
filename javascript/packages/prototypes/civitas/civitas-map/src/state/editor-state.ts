import { computed, signal } from "@preact/signals-react";
import { clampSize, type BrushShape } from "../map/brush";
import { generateColor, packOpaque, toHex, unpack, type Rgb } from "../map/colors";
import { baseName, downloadJson, downloadPng } from "../map/export-file";
import { decodePixels, isJsonFile, isPngFile, parseManifest } from "../map/import-provinces";
import {
  buildManifest,
  scanColors,
  type ProvinceKind,
  type ProvinceRecord,
} from "../map/manifest";
import { loadMapFile, loadMapUrl, type LoadedMap } from "../map/map-image";
import { ProvinceLayer } from "../map/province-layer";
import { fit, type View } from "../map/view";

type Tool = "brush" | "bucket" | "eraser" | "picker";

type Province = ProvinceRecord & {
  hex: string;
};

// The bitmap and the layer are plain values, not signals: they are large mutable
// objects that no component renders directly, and the renderer reads them
// through a ref on every frame. What components need is the *identity* of the
// loaded map, which `mapInfo` carries.
let bitmap: ImageBitmap | null = null;
let layer: ProvinceLayer | null = null;

const mapInfo = signal<{ name: string; width: number; height: number } | null>(null);
const loading = signal(false);
const error = signal<string | null>(null);
// Non-fatal outcome of the last import. An import can succeed and still have
// something the operator needs to know — colours adopted, entries skipped — and
// silently dropping that would make the editor disagree with their file.
const notice = signal<string | null>(null);
const exporting = signal(false);

const view = signal<View>({ scale: 1, x: 0, y: 0 });
const viewport = signal({ width: 1, height: 1 });

const tool = signal<Tool>("brush");
const brushSize = signal(12);
const brushShape = signal<BrushShape>("circle");
const layerOpacity = signal(0.65);
const layerVisible = signal(true);
const showBaseMap = signal(true);

const provinces = signal<Province[]>([]);
const activeProvinceId = signal<number | null>(null);
const hoverPixel = signal<{ x: number; y: number } | null>(null);
const hoverColor = signal<number>(0);

// Bumped whenever the layer's pixels change, so the renderer and the history
// buttons have something to react to. The pixels themselves live outside the
// signal graph.
const layerRevision = signal(0);
const historyRevision = signal(0);

const activeProvince = computed(() => {
  const id = activeProvinceId.value;

  if (id === null) {
    return null;
  }

  return provinces.value.find((province) => province.id === id) ?? null;
});

const hoverProvince = computed(() => {
  const color = hoverColor.value;

  if (color === 0) {
    return null;
  }

  return provinces.value.find((province) => province.color === color) ?? null;
});

// `historyRevision` is read for the dependency only. The flags themselves sit on
// the layer, which is outside the signal graph.
const canUndo = computed(() => {
  void historyRevision.value;

  return layer?.canUndo ?? false;
});

const canRedo = computed(() => {
  void historyRevision.value;

  return layer?.canRedo ?? false;
});

let nextProvinceId = 1;

function getBitmap(): ImageBitmap | null {
  return bitmap;
}

function getLayer(): ProvinceLayer | null {
  return layer;
}

function takenColors(): Set<number> {
  return new Set(provinces.value.map((province) => province.color));
}

function makeProvince(name?: string): Province {
  const id = nextProvinceId;
  const rgb = generateColor(id, takenColors());

  nextProvinceId += 1;

  return {
    id,
    name: name ?? `Province ${id}`,
    kind: "land",
    color: packOpaque(rgb),
    hex: toHex(rgb),
  };
}

function addProvince(): Province {
  const province = makeProvince();

  provinces.value = [...provinces.value, province];
  activeProvinceId.value = province.id;

  return province;
}

function renameProvince(id: number, name: string): void {
  provinces.value = provinces.value.map((province) => {
    if (province.id !== id) {
      return province;
    }

    return { ...province, name };
  });
}

function setProvinceKind(id: number, kind: ProvinceKind): void {
  provinces.value = provinces.value.map((province) => {
    if (province.id !== id) {
      return province;
    }

    return { ...province, kind };
  });
}

// Recolouring rewrites the province's existing pixels in the same step, so the
// image never holds a colour the registry does not know.
function recolorProvince(id: number, rgb: Rgb): boolean {
  const target = provinces.value.find((province) => province.id === id);
  const color = packOpaque(rgb);

  if (!target || target.color === color) {
    return false;
  }

  if (takenColors().has(color)) {
    error.value = `${toHex(rgb)} is already used by another province`;

    return false;
  }

  if (layer) {
    layer.beginStroke();
    layer.replaceColor(target.color, color);
    layer.flushDirty();
    commitStroke();
  }

  provinces.value = provinces.value.map((province) => {
    if (province.id !== id) {
      return province;
    }

    return { ...province, color, hex: toHex(rgb) };
  });

  return true;
}

function deleteProvince(id: number): void {
  const target = provinces.value.find((province) => province.id === id);

  if (!target) {
    return;
  }

  if (layer) {
    layer.beginStroke();
    layer.replaceColor(target.color, 0);
    layer.flushDirty();
    commitStroke();
  }

  provinces.value = provinces.value.filter((province) => province.id !== id);

  if (activeProvinceId.value === id) {
    activeProvinceId.value = provinces.value.at(-1)?.id ?? null;
  }
}

function selectProvinceByColor(color: number): boolean {
  const found = provinces.value.find((province) => province.color === color);

  if (!found) {
    return false;
  }

  activeProvinceId.value = found.id;

  return true;
}

function commitStroke(): void {
  if (layer?.endStroke()) {
    historyRevision.value += 1;
  }

  layerRevision.value += 1;
}

function undo(): void {
  if (layer?.undo()) {
    historyRevision.value += 1;
    layerRevision.value += 1;
  }
}

function redo(): void {
  if (layer?.redo()) {
    historyRevision.value += 1;
    layerRevision.value += 1;
  }
}

function markLayerChanged(): void {
  layerRevision.value += 1;
}

function setBrushSize(size: number): void {
  brushSize.value = clampSize(size);
}

// A map can finish loading before the canvas has been measured — an upload
// decodes faster than the first `ResizeObserver` callback arrives. Fitting
// against a 1x1 viewport clamps the zoom to the minimum and leaves the map
// invisible, so an unmeasured viewport defers the fit to `measureViewport`.
let fitPending = false;

function fitToViewport(): void {
  const info = mapInfo.value;

  if (!info) {
    return;
  }

  const size = viewport.value;

  if (size.width <= 1 || size.height <= 1) {
    fitPending = true;

    return;
  }

  fitPending = false;
  view.value = fit(info, size);
}

function measureViewport(width: number, height: number): void {
  viewport.value = { width: Math.max(1, width), height: Math.max(1, height) };

  if (fitPending) {
    fitToViewport();
  }
}

function adoptMap(loaded: LoadedMap): void {
  bitmap?.close();
  bitmap = loaded.bitmap;
  layer = new ProvinceLayer(loaded.width, loaded.height);

  mapInfo.value = { name: loaded.name, width: loaded.width, height: loaded.height };
  notice.value = null;
  provinces.value = [];
  nextProvinceId = 1;
  activeProvinceId.value = null;
  hoverPixel.value = null;
  hoverColor.value = 0;
  historyRevision.value += 1;

  // A fresh map starts with one province, so the brush is usable straight away
  // instead of refusing the first stroke.
  addProvince();
  fitToViewport();
  markLayerChanged();
}

async function openMap(load: () => Promise<LoadedMap>): Promise<void> {
  loading.value = true;
  error.value = null;

  try {
    adoptMap(await load());
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
}

function openMapFile(file: File): Promise<void> {
  return openMap(() => loadMapFile(file));
}

function openMapUrl(url: string): Promise<void> {
  return openMap(() => loadMapUrl(url));
}

function withHex(record: ProvinceRecord): Province {
  return { ...record, hex: toHex(unpack(record.color)) };
}

// Colours sitting in the layer that no manifest entry claims. They are adopted
// as provinces instead of being left as orphan paint: the alternative is an
// export whose image holds colours its manifest does not describe.
function adoptStrayColors(current: Province[]): Province[] {
  const currentLayer = layer;

  if (!currentLayer) {
    return current;
  }

  const known = new Set(current.map((province) => province.color));
  const strays = [...scanColors(currentLayer).keys()].filter((color) => !known.has(color));

  if (strays.length === 0) {
    return current;
  }

  let id = current.reduce((highest, province) => Math.max(highest, province.id), 0);

  return [
    ...current,
    ...strays.map((color) => {
      id += 1;

      return withHex({ id, name: `Province ${id}`, kind: "land", color });
    }),
  ];
}

// Loads an export back in: the province PNG, its manifest, or both. The base map
// has to be open first, because the layer is sized from it and a province image
// of another size cannot be placed.
async function importProvinces(files: readonly File[]): Promise<void> {
  const currentLayer = layer;
  const info = mapInfo.value;

  if (!currentLayer || !info) {
    error.value = "Load the map image before loading provinces into it";

    return;
  }

  const imageFile = files.find(isPngFile);
  const manifestFile = files.find(isJsonFile);

  if (!imageFile && !manifestFile) {
    error.value = "Pick an exported provinces PNG, its JSON manifest, or both";

    return;
  }

  loading.value = true;
  error.value = null;
  notice.value = null;

  try {
    // Both files are read before either is applied, so a broken manifest leaves
    // the layer as it was instead of half-loading over it.
    const parsed = manifestFile
      ? parseManifest(await manifestFile.text(), info.width, info.height)
      : null;
    const decoded = imageFile ? await decodePixels(imageFile, info.width, info.height) : null;

    if (decoded) {
      currentLayer.loadPixels(decoded.pixels);
    }

    const listed = (parsed?.records ?? []).map(withHex);
    const next = adoptStrayColors(listed);

    provinces.value = next;
    nextProvinceId = next.reduce((highest, province) => Math.max(highest, province.id), 0) + 1;
    activeProvinceId.value = next[0]?.id ?? null;
    hoverPixel.value = null;
    hoverColor.value = 0;
    historyRevision.value += 1;
    markLayerChanged();

    const parts = [`${listed.length} province${listed.length === 1 ? "" : "s"} from the manifest`];
    const adopted = next.length - listed.length;

    if (adopted > 0) {
      parts.push(`${adopted} unlisted colour${adopted === 1 ? "" : "s"} adopted`);
    }
    if (parsed && parsed.skipped > 0) {
      parts.push(`${parsed.skipped} unusable entr${parsed.skipped === 1 ? "y" : "ies"} skipped`);
    }
    if (decoded && decoded.dropped > 0) {
      parts.push(`${decoded.dropped} part-transparent pixels dropped`);
    }
    if (parsed?.source && parsed.source !== info.name) {
      parts.push(`manifest was exported from "${parsed.source}"`);
    }

    notice.value = `Loaded ${parts.join(", ")}.`;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
}

async function exportAll(): Promise<void> {
  const currentLayer = layer;
  const info = mapInfo.value;

  if (!currentLayer || !info) {
    return;
  }

  exporting.value = true;
  error.value = null;

  try {
    const stem = `${baseName(info.name)}-provinces`;
    const manifest = buildManifest(currentLayer, provinces.value, info.name);

    await downloadPng(currentLayer.canvas, `${stem}.png`);
    downloadJson(manifest, `${stem}.json`);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    exporting.value = false;
  }
}

function clearLayer(): void {
  layer?.clear();
  historyRevision.value += 1;
  markLayerChanged();
}

function dismissError(): void {
  error.value = null;
}

function dismissNotice(): void {
  notice.value = null;
}

export {
  activeProvince,
  activeProvinceId,
  addProvince,
  brushShape,
  brushSize,
  canRedo,
  canUndo,
  clearLayer,
  commitStroke,
  deleteProvince,
  dismissError,
  dismissNotice,
  error,
  exportAll,
  exporting,
  fitToViewport,
  getBitmap,
  getLayer,
  hoverColor,
  hoverPixel,
  hoverProvince,
  importProvinces,
  layerOpacity,
  layerRevision,
  layerVisible,
  loading,
  mapInfo,
  markLayerChanged,
  measureViewport,
  notice,
  openMapFile,
  openMapUrl,
  provinces,
  recolorProvince,
  redo,
  renameProvince,
  selectProvinceByColor,
  setBrushSize,
  setProvinceKind,
  showBaseMap,
  tool,
  undo,
  view,
  viewport,
  type Province,
  type Tool,
};
