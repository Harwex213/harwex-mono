import { useEffect } from "react";
import type { TAppRegistry } from "../../../actions/index";
import type { Tool } from "../../../domain/index";
import type { TStore } from "../../../store/index";

type TShortcutsRegistry = Pick<
  TAppRegistry,
  | "addCountry"
  | "addProvince"
  | "fitToViewport"
  | "redo"
  | "setTool"
  | "stepBrushSize"
  | "toggleLayerVisible"
  | "undo"
  | "zoomCentre"
>;

const TOOL_KEYS: Record<string, Tool> = {
  b: "brush",
  g: "bucket",
  e: "eraser",
  i: "picker",
};

// The editor's keyboard shortcuts. The page owns them because they act on the
// whole screen.
function useShortcuts(store: TStore, registry: TShortcutsRegistry): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      // A province being renamed owns its keystrokes.
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) {
        return;
      }

      // The map library dialog owns the keyboard while it is open.
      if (store.library.state.peek() !== null) {
        return;
      }

      if (event.code === "Space") {
        // Otherwise holding space to pan scrolls the page and clicks buttons.
        event.preventDefault();

        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();

        // The history holds province paint. The countries mode does not show
        // that paint, so an undo there would change what the user cannot see.
        if (store.tools.mode.peek() === "countries") {
          return;
        }

        if (event.shiftKey) {
          registry.redo();
        } else {
          registry.undo();
        }

        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (store.map.info.peek() === null) {
        return;
      }

      const key = event.key.toLowerCase();
      const provincesMode = store.tools.mode.peek() === "provinces";
      // The countries mode has no tools and no brush.
      const nextTool = provincesMode ? TOOL_KEYS[key] : undefined;

      if (nextTool) {
        registry.setTool(nextTool);

        return;
      }

      switch (event.key) {
        case "[":
          if (!provincesMode) {
            return;
          }
          registry.stepBrushSize(-1);
          break;
        case "]":
          if (!provincesMode) {
            return;
          }
          registry.stepBrushSize(1);
          break;
        case "0":
          registry.fitToViewport();
          break;
        case "+":
        case "=":
          registry.zoomCentre(1.25);
          break;
        case "-":
          registry.zoomCentre(0.8);
          break;
        case "n":
          if (provincesMode) {
            registry.addProvince();
          } else {
            registry.addCountry();
          }
          break;
        case "v":
          registry.toggleLayerVisible();
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
  }, [store, registry]);
}

export { useShortcuts };
