import { effect, signal } from "@preact/signals-react";
import type { TStore } from "../../store/index";
import { InputHandler } from "./input-handler";
import type { TMapCanvasServiceRegistry } from "./map-canvas-registry";
import { CountryCanvas } from "./renderer/country-canvas";
import { LayerCanvas } from "./renderer/layer-canvas";
import {
  drawPreview,
  drawScene,
} from "./renderer/render";

// Owns the map canvas outside React: the input listeners, the ResizeObserver,
// the space key, the signal effects that redraw, and the requestAnimationFrame
// scheduling. React renders the host and the two canvases and calls `attach`
// and `dispose`.

type MapCanvases = {
  scene: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
};

type MapCanvasService = {
  attach(host: HTMLElement, canvases: MapCanvases): void;
  dispose(): void;
};

// Sizes the canvas backing store to the viewport at device resolution. The
// canvas is driven in CSS pixels, so a 1px outline is one device pixel on a 2x
// display instead of two.
function prepareCanvas(canvas: HTMLCanvasElement, size: { width: number; height: number }, dpr: number): CanvasRenderingContext2D | null {
  canvas.width = Math.round(size.width * dpr);
  canvas.height = Math.round(size.height * dpr);
  canvas.style.width = `${size.width}px`;
  canvas.style.height = `${size.height}px`;

  return canvas.getContext("2d");
}

function createMapCanvasService(store: TStore, registry: TMapCanvasServiceRegistry): MapCanvasService {
  const cleanups: Array<() => void> = [];
  // Held space pans with any tool. A signal, so the cursor effect follows it.
  const spaceHeld = signal(false);
  // The canvas copy of the current layer. Rebuilt when the layer is replaced.
  let layerCanvas: LayerCanvas | null = null;
  // The countries view. Rebuilt when the layer's pixels or the province
  // registry change, which is rare in the countries mode.
  let countryCanvas: CountryCanvas | null = null;

  function currentLayerCanvas(): LayerCanvas | null {
    const layer = store.map.layer.peek();

    if (!layer) {
      layerCanvas = null;

      return null;
    }

    if (layerCanvas?.layer !== layer) {
      layerCanvas = new LayerCanvas(layer);
    } else {
      layerCanvas.sync();
    }

    return layerCanvas;
  }

  function currentCountryCanvas(): CountryCanvas | null {
    const layer = store.map.layer.peek();
    const provinces = store.provinces.list.peek();
    const revision = store.map.layerRevision.peek();

    if (!layer) {
      countryCanvas = null;

      return null;
    }

    if (countryCanvas?.layer !== layer || countryCanvas.provinces !== provinces || countryCanvas.revision !== revision) {
      countryCanvas = new CountryCanvas(layer, provinces, revision);
    }

    countryCanvas.sync(store.countries.owners.peek(), store.countries.list.peek());

    return countryCanvas;
  }

  function listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener, options);
    cleanups.push(() => {
      target.removeEventListener(type, listener, options);
    });
  }

  // Runs `draw` on the next frame after any signal it reads in `read` changes. A
  // newer change cancels a frame that has not run yet.
  function frameEffect<T>(read: () => T, draw: (input: T) => void): void {
    cleanups.push(effect(() => {
      const input = read();
      const frame = requestAnimationFrame(() => {
        draw(input);
      });

      return () => {
        cancelAnimationFrame(frame);
      };
    }));
  }

  function attach(host: HTMLElement, canvases: MapCanvases): void {
    const input = new InputHandler(host, store, registry, spaceHeld);

    listen(host, "pointerdown", input.onPointerDown);
    listen(host, "pointermove", input.onPointerMove);
    listen(host, "pointerup", input.onPointerEnd);
    listen(host, "pointercancel", input.onPointerEnd);
    listen(host, "pointerleave", input.onPointerLeave);
    listen(host, "contextmenu", input.onContextMenu);
    listen(host, "wheel", input.onWheel, { passive: false });

    const onKey = (event: KeyboardEvent): void => {
      if (event.code === "Space") {
        spaceHeld.value = event.type === "keydown";
      }
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    cleanups.push(() => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    });

    const observer = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect();

      registry.measureViewport(rect.width, rect.height);
    });

    observer.observe(host);
    cleanups.push(() => {
      observer.disconnect();
    });

    cleanups.push(effect(() => {
      const tool = store.tools.tool.value;
      const picking = store.tools.mode.value === "provinces" && tool === "picker";

      host.dataset.cursor = spaceHeld.value ? "pan" : picking ? "picker" : "paint";
    }));

    frameEffect(
      () => {
        // Read for the dependency: the pixels changed, the reference did not.
        void store.map.layerRevision.value;
        void store.map.layer.value;

        const countriesMode = store.tools.mode.value === "countries";

        if (countriesMode) {
          // Read for the dependency: the country canvas reads them with `peek`.
          void store.provinces.list.value;
          void store.countries.list.value;
        }

        return {
          countriesMode,
          size: store.view.viewport.value,
          view: store.view.view.value,
          bitmap: store.map.bitmap.value,
          showBaseMap: store.tools.showBaseMap.value,
          showLayer: store.tools.layerVisible.value,
          layerOpacity: store.tools.layerOpacity.value,
        };
      },
      (scene) => {
        const dpr = window.devicePixelRatio || 1;
        const ctx = prepareCanvas(canvases.scene, scene.size, dpr);

        if (!ctx) {
          return;
        }

        drawScene({
          ctx,
          cssWidth: scene.size.width,
          cssHeight: scene.size.height,
          dpr,
          view: scene.view,
          bitmap: scene.bitmap,
          layer: scene.countriesMode ? currentCountryCanvas() : currentLayerCanvas(),
          showBaseMap: scene.showBaseMap,
          showLayer: scene.showLayer,
          layerOpacity: scene.layerOpacity,
        });
      },
    );

    frameEffect(
      () => {
        const tool = store.tools.tool.value;
        const countriesMode = store.tools.mode.value === "countries";

        return {
          size: store.view.viewport.value,
          view: store.view.view.value,
          cursor: store.hover.pixel.value,
          mask: store.tools.brushMask.value,
          color: store.provinces.active.value?.color ?? 0,
          erasing: tool === "eraser",
          // Bucket and picker act on one pixel, and the countries mode on one
          // province, so a brush footprint would overstate what a click does.
          crosshairOnly: countriesMode || tool === "bucket" || tool === "picker",
        };
      },
      (preview) => {
        const dpr = window.devicePixelRatio || 1;
        const ctx = prepareCanvas(canvases.overlay, preview.size, dpr);

        if (!ctx) {
          return;
        }

        drawPreview({
          ctx,
          cssWidth: preview.size.width,
          cssHeight: preview.size.height,
          dpr,
          view: preview.view,
          mask: preview.mask,
          cursor: preview.cursor,
          color: preview.color,
          erasing: preview.erasing,
          crosshairOnly: preview.crosshairOnly,
        });
      },
    );
  }

  function dispose(): void {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }

    layerCanvas = null;
    countryCanvas = null;
  }

  return { attach, dispose };
}

export {
  createMapCanvasService,
  type MapCanvasService,
  type MapCanvases,
};
