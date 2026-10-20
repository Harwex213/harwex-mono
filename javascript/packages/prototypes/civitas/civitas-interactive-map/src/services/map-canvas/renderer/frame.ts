import { borderPathsFor } from "./layers/border-layer";
import { buildHighlights } from "./highlights";
import { drawOverlay, drawScene } from "./passes";
import { getTintCanvas } from "./layers/tint-layer";
import {
  countryContainsPoint,
  provinceById,
  type TStore,
} from "../../../store/index";
import type { Size } from "../../../domain/index";

// One frame: size the canvases, draw the scene pass, draw the overlay pass.
// `renderFrame` reads every input fresh inside rAF, so a coalesced frame paints the newest state.

type MapCanvases = {
  scene: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
};

type PreparedFrame = {
  sceneCtx: CanvasRenderingContext2D;
  overlayCtx: CanvasRenderingContext2D;
};

function prepareFrame(canvases: MapCanvases, port: Size, ratio: number): PreparedFrame | null {
  const width = Math.max(1, Math.round(port.width * ratio));
  const height = Math.max(1, Math.round(port.height * ratio));

  for (const canvas of [canvases.scene, canvases.overlay]) {
    // Assigning `canvas.width` clears the buffer even with an unchanged value.
    if (canvas.width !== width) {
      canvas.width = width;
    }
    if (canvas.height !== height) {
      canvas.height = height;
    }
    canvas.style.width = port.width + "px";
    canvas.style.height = port.height + "px";
  }

  const sceneCtx = canvases.scene.getContext("2d");
  const overlayCtx = canvases.overlay.getContext("2d");
  if (!sceneCtx || !overlayCtx) {
    return null;
  }
  return { sceneCtx, overlayCtx };
}

function clearFrame(canvases: MapCanvases, frame: PreparedFrame): void {
  frame.sceneCtx.setTransform(1, 0, 0, 1, 0, 0);
  frame.sceneCtx.clearRect(0, 0, canvases.scene.width, canvases.scene.height);
  frame.overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
  frame.overlayCtx.clearRect(0, 0, canvases.overlay.width, canvases.overlay.height);
}

function renderFrame(store: TStore, canvases: MapCanvases): void {
  const port = store.view.viewport.value;
  const ratio = store.view.dpr.value;
  const frame = prepareFrame(canvases, port, ratio);
  if (!frame) {
    return;
  }

  const current = store.view.view.value;
  const size = store.map.mapSize.value;
  const assets = store.map.assets.value;
  if (!current || !size || !assets) {
    clearFrame(canvases, frame);
    return;
  }

  // Both passes share one callback and one view, so the overlay never slides against the art.
  drawScene({
    ctx: frame.sceneCtx,
    view: current,
    viewport: port,
    dpr: ratio,
    art: assets.art,
    mapSize: size,
  });

  drawOverlay({
    ctx: frame.overlayCtx,
    view: current,
    viewport: port,
    dpr: ratio,
    mapSize: size,
    provinceBorders: borderPathsFor(store.borders.provinceTiles.value),
    countryBorders: borderPathsFor(store.borders.countryTiles.value),
    highlights: buildHighlights(
      store.selection.hoveredProvinceId.value,
      store.selection.selectedProvinceId.value,
      (id) => {
        return provinceById(store, id);
      },
    ),
    provinceIndex: assets.index,
    // Read here, so no signal carries the canvas. `null` while nothing is tinted.
    tint: getTintCanvas(),
    // The map size, not the 1 px narrower art size.
    tintSize: size,
    labelSources: store.labels.labelSources.value,
    countryContains: (countryId, x, y) => {
      return countryContainsPoint(store, countryId, x, y);
    },
  });
}

export { renderFrame, type MapCanvases };
