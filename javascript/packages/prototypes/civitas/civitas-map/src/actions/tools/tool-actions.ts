import {
  clampSize,
  type BrushShape,
  type Tool,
} from "../../domain/index";
import type { TStore } from "../../store/index";

function setTool(store: TStore, tool: Tool): void {
  store.tools.tool.value = tool;
}

function setBrushSize(store: TStore, size: number): void {
  store.tools.brushSize.value = clampSize(size);
}

// `[` and `]`: a fifth of the size per step, at least one pixel.
function stepBrushSize(store: TStore, direction: 1 | -1): void {
  const size = store.tools.brushSize.value;

  setBrushSize(store, size + direction * Math.max(1, Math.round(size * 0.2)));
}

function setBrushShape(store: TStore, shape: BrushShape): void {
  store.tools.brushShape.value = shape;
}

function setLayerOpacity(store: TStore, opacity: number): void {
  store.tools.layerOpacity.value = opacity;
}

function setLayerVisible(store: TStore, visible: boolean): void {
  store.tools.layerVisible.value = visible;
}

function toggleLayerVisible(store: TStore): void {
  store.tools.layerVisible.value = !store.tools.layerVisible.value;
}

function setShowBaseMap(store: TStore, visible: boolean): void {
  store.tools.showBaseMap.value = visible;
}

export {
  setBrushShape,
  setBrushSize,
  setLayerOpacity,
  setLayerVisible,
  setShowBaseMap,
  setTool,
  stepBrushSize,
  toggleLayerVisible,
};
