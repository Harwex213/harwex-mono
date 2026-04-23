export interface TProvinceRaw {
  provinceId: string;
  provinceName: string;
  center: null | [number, number];
}

export interface TProvince extends TProvinceRaw {
  turnover: number;
  supply: number;
  fortress: number;
}
