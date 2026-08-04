import { useEffect } from "react";
import { clampScale } from "../map/view";
import {
  addProvince,
  brushSize,
  fitToViewport,
  layerVisible,
  mapInfo,
  redo,
  setBrushSize,
  tool,
  undo,
  view,
  viewport,
} from "../state/editor-state";

const TOOL_KEYS: Record<string, "brush" | "bucket" | "eraser" | "picker"> = {
  b: "brush",
  g: "bucket",
  e: "eraser",
  i: "picker",
};

// Zoom from the keyboard steps around the middle of the viewport, since there is
// no cursor position to aim at.
function zoomCentre(factor: number): void {
  const size = viewport.value;
  const current = view.value;
  const scale = clampScale(current.scale * factor);
  const cx = size.width / 2;
  const cy = size.height / 2;

  view.value = {
    scale,
    x: cx - ((cx - current.x) / current.scale) * scale,
    y: cy - ((cy - current.y) / current.scale) * scale,
  };
}

function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      // A province being renamed owns its keystrokes.
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) {
        return;
      }

      if (event.code === "Space") {
        // Otherwise holding space to pan scrolls the page and clicks buttons.
        event.preventDefault();

        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();

        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }

        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (mapInfo.value === null) {
        return;
      }

      const key = event.key.toLowerCase();
      const nextTool = TOOL_KEYS[key];

      if (nextTool) {
        tool.value = nextTool;

        return;
      }

      switch (event.key) {
        case "[":
          setBrushSize(brushSize.value - Math.max(1, Math.round(brushSize.value * 0.2)));
          break;
        case "]":
          setBrushSize(brushSize.value + Math.max(1, Math.round(brushSize.value * 0.2)));
          break;
        case "0":
          fitToViewport();
          break;
        case "+":
        case "=":
          zoomCentre(1.25);
          break;
        case "-":
          zoomCentre(0.8);
          break;
        case "n":
          addProvince();
          break;
        case "v":
          layerVisible.value = !layerVisible.value;
          break;
        default:
          return;
      }

      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}

export { useShortcuts };
