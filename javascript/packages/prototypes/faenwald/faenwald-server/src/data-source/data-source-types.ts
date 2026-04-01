import { THouse } from "@hw/faenwald-core";

export type TGameTurnSerialized = {
  turn: number;
  houses: Record<string, THouse>;
  supplies: Record<string, number>;
  fortresses: Record<string, number>;
}

export type TProvinceSerialized = {
  provinceId: string;
  provinceName: string;
  center: null | [number, number];
};
