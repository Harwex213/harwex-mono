import { computed, signal } from "@preact/signals-react";
import { clampSize, type BrushShape } from "../map/brush";
import { generateColor, packOpaque, toHex, type Rgb } from "../map/colors";
import { baseName, downloadJson, downloadPng } from "../map/export-file";
import { buildManifest, type ProvinceKind, type ProvinceRecord } from "../map/manifest";
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

function fitToViewport(): void {
  const info = mapInfo.value;

  if (!info) {
    return;
  }

  view.value = fit(info, viewport.value);
}

function adoptMap(loaded: LoadedMap): void {
  bitmap?.close();
  bitmap = loaded.bitmap;
  layer = new ProvinceLayer(loaded.width, loaded.height);

  mapInfo.value = { name: loaded.name, width: loaded.width, height: loaded.height };
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
  error,
  exportAll,
  exporting,
  fitToViewport,
  getBitmap,
  getLayer,
  hoverColor,
  hoverPixel,
  hoverProvince,
  layerOpacity,
  layerRevision,
  layerVisible,
  loading,
  mapInfo,
  markLayerChanged,
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
