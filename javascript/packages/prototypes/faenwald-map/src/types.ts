export interface Province {
  provinceId: string;
  provinceName: string;
}

// key = "#rrggbb" lowercase
export type ProvincesMap = Record<string, Province>;

export interface MapState {
  offsetX: number;
  offsetY: number;
  scale: number;
}
