import type { THouse } from "./base/house.js";
import type { TProvincesMap } from "./base/province.js";

export type TGameTurn = {
  turn: number;
  houses: Record<string, THouse>;
  provinces: TProvincesMap;
};

export const assignProvinceSupply = (gameTurn: TGameTurn, provinceId: string, supply: number) => {
  const province = gameTurn.provinces[provinceId];
  if (!province) {
    throw new Error("Game: Province not found");
  }
  province.supply = supply;
};
