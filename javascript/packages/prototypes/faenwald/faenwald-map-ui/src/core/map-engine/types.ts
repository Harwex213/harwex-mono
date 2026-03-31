export interface TProvince {
  provinceId: string;
  provinceName: string;
}

// key = "#rrggbb" lowercase
export type TProvincesMap = Record<string, TProvince>;

export interface TMapState {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export type TMapAssets = {
  baseImg: HTMLImageElement;
  provincesImageData: ImageData;
  provincesMap: TProvincesMap;
  borderCanvas: OffscreenCanvas;
  dilatedMask: Uint8Array;
  duplicateProvincesCanvas: OffscreenCanvas | null;
  highlightCanvas: OffscreenCanvas | null;
  selectedColor: string | null;
}
