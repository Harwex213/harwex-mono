import { effect, untracked } from "@preact/signals-react";
import { bindInput } from "./input-handler";
import { renderFrame } from "./renderer/frame";
import {
  SELECTED_TINT_ALPHA,
  buildTintWordTable,
  disposeTintLayer,
  syncTintLayer,
} from "./renderer/layers/tint-layer";
import { provinceById } from "../../store/index";
import type { MapCanvases } from "./renderer/frame";
import type { TMapCanvasServiceRegistry } from "./map-canvas-registry";
import type { TStore } from "../../store/index";

// Runs the map canvas outside React.
// The widget renders the host and two canvases and passes them to `attach`.
// The service then owns input, resize and dpr watches, signal effects, rAF and host `data-*` attributes.
class MapCanvasService {
  private readonly store: TStore;
  private readonly registry: TMapCanvasServiceRegistry;
  private canvases: MapCanvases | null = null;
  private frame = 0;
  private cleanups: (() => void)[] = [];

  constructor(store: TStore, registry: TMapCanvasServiceRegistry) {
    this.store = store;
    this.registry = registry;
  }

  attach(host: HTMLElement, canvases: MapCanvases): void {
    if (this.canvases) {
      throw new Error("MapCanvasService is already attached");
    }
    this.canvases = canvases;
    this.cleanups.push(this.watchFrameInputs());
    this.cleanups.push(this.watchTint());
    this.cleanups.push(this.watchMapPhase());
    this.cleanups.push(this.watchViewport(host));
    this.cleanups.push(bindInput(host, this.store, this.registry));
    this.cleanups.push(this.watchDpr());
    this.cleanups.push(this.watchHostAttributes(host));
  }

  dispose(): void {
    // Effects go first, so the writes below schedule no new frame.
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups = [];
    if (this.frame !== 0) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    if (this.canvases) {
      this.canvases = null;
      this.registry.disposeBorders();
      disposeTintLayer();
    }
  }

  // One rAF per frame: a pending handle absorbs later requests.
  // No cancel, or a wheel burst keeps cancelling its own frame.
  private scheduleDraw(): void {
    if (this.frame !== 0) {
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.canvases) {
        renderFrame(this.store, this.canvases);
      }
    });
  }

  // One draw path for all inputs, hover included.
  // A hover repaint costs one `drawImage`, and the setters dedupe, so a second path does not pay off.
  private watchFrameInputs(): () => void {
    const store = this.store;
    return effect(() => {
      void store.view.view.value;
      void store.view.viewport.value;
      void store.view.dpr.value;
      void store.map.phase.value;
      void store.selection.hoveredProvinceId.value;
      void store.selection.selectedProvinceId.value;
      void store.borders.provinceTiles.value;
      void store.borders.countryTiles.value;
      // A rename changes no other input.
      void store.labels.labelSources.value;
      this.scheduleDraw();
    });
  }

  // Reads the selected country, so the selected country gets a deeper tint.
  // `syncTintLayer` repaints only the ids whose colour changed.
  private watchTint(): () => void {
    const store = this.store;
    return effect(() => {
      const words = buildTintWordTable(
        store.world.countries.value,
        store.map.maxProvinceId.value,
        store.selection.selectedCountryId.value,
        SELECTED_TINT_ALPHA,
      );
      const assets = store.map.assets.value;
      if (!assets) {
        return;
      }
      syncTintLayer(assets.index, words, (id) => {
        return provinceById(store, id);
      });
      this.scheduleDraw();
    });
  }

  // Map size and viewport arrive from two async sources, so `syncView` runs from both paths.
  // The actions run `untracked`, so the effect subscribes to the phase alone.
  private watchMapPhase(): () => void {
    const store = this.store;
    const registry = this.registry;
    return effect(() => {
      void store.map.phase.value;
      untracked(() => {
        registry.syncView();
        void registry.scanBorders();
      });
    });
  }

  // `getBoundingClientRect`, so the viewport matches the rect the pointer maths uses.
  private watchViewport(host: HTMLElement): () => void {
    const registry = this.registry;
    const observer = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect();
      registry.setViewport(rect.width, rect.height);
    });
    observer.observe(host);
    const initial = host.getBoundingClientRect();
    registry.setViewport(initial.width, initial.height);
    return () => {
      observer.disconnect();
    };
  }

  // A `resolution` query fires only when the ratio leaves its value, so the query is re-armed each time.
  private watchDpr(): () => void {
    const registry = this.registry;
    let media: MediaQueryList | null = null;
    const update = (): void => {
      const next = window.devicePixelRatio || 1;
      registry.setDpr(next);
      if (media) {
        media.removeEventListener("change", update);
      }
      media = window.matchMedia("(resolution: " + next + "dppx)");
      media.addEventListener("change", update);
    };
    update();
    return () => {
      if (media) {
        media.removeEventListener("change", update);
      }
    };
  }

  // Host CSS picks the cursor from these attributes.
  private watchHostAttributes(host: HTMLElement): () => void {
    const store = this.store;
    return effect(() => {
      host.dataset.mode = store.assign.mode.value ? "assign" : "pan";
      host.dataset.painting = store.assign.painting.value ? "true" : "false";
      host.dataset.panning = store.view.panning.value ? "true" : "false";
    });
  }
}

function createMapCanvasService(store: TStore, registry: TMapCanvasServiceRegistry): MapCanvasService {
  return new MapCanvasService(store, registry);
}

export { MapCanvasService, createMapCanvasService };
