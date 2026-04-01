import type { TGameTurn, TProvince, TWarPhase } from "@hw/faenwald-core";

export interface TMapState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export type TGameContext = {
  gameTurn: TGameTurn;
  warPhase: TWarPhase;
}

export type TMapAssets = {
  baseImg: HTMLImageElement;
  provincesImageData: ImageData;
  borderCanvas: OffscreenCanvas;
  dilatedMask: Uint8Array;
  duplicateProvincesCanvas: OffscreenCanvas | null;
  highlightCanvases: Map<string, OffscreenCanvas>;
  hoverBorderCanvases: Map<string, OffscreenCanvas>;
  provincesCenterCanvas: OffscreenCanvas | null,
  selectedColor: string | null;
  hoveredColor: string | null;
}

export const isProvinceHaveCenter = (province: TProvince) => province.center !== null;
