import { computed, signal } from "@preact/signals-react";
import {
  buildMask,
  type BrushShape,
  type Tool,
} from "../../domain/index";

// The active tool, the brush, and how the two images are shown.

function createToolsSlice() {
  const tool = signal<Tool>("brush");
  const brushSize = signal(12);
  const brushShape = signal<BrushShape>("circle");
  const layerOpacity = signal(0.65);
  const layerVisible = signal(true);
  const showBaseMap = signal(true);

  // The spans the brush writes. The stroke and the hover preview both use it, so
  // what the cursor shows is what the layer gets.
  const brushMask = computed(() => {
    return buildMask(brushSize.value, brushShape.value);
  });

  return { tool, brushSize, brushShape, brushMask, layerOpacity, layerVisible, showBaseMap };
}

type TToolsSlice = ReturnType<typeof createToolsSlice>;

export {
  createToolsSlice,
  type TToolsSlice,
};
