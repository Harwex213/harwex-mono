export interface TProvince {
  provinceId: string;
  provinceName: string;
  center: null | [number, number];
  supply: number;
  fortress: number;
}

// key = "#rrggbb" lowercase
export type TProvincesMap = Record<string, TProvince>;
