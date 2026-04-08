import type { TArmyUnitModifier } from "./army.js";

export type TAssaultDeviceUnitType = |
  "catapult" |
  "trebuchet" |
  "mantelet" |
  "stairs" |
  "siege-tower" |
  "taran";

export type TAssaultDevice = {
  id: string;
  type: TAssaultDeviceUnitType;
  baseHp: number;
  baseAttack: number;
  baseSpeed: number;
  baseCost: number;
  baseTimeCost: number;
  stripes: number;
  rank: number;
  modifiers: TArmyUnitModifier[];
  armyId: string;
};

export type TAssaultDeviceTemplate = Pick<
  TAssaultDevice,
  "type" |
  "baseHp" |
  "baseAttack" |
  "baseSpeed" |
  "baseCost" |
  "baseTimeCost"
>;

export type TSiegeArmy = {
  provinceId: string;
};
