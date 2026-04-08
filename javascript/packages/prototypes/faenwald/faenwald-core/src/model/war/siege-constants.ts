import type { TAssaultDeviceTemplate, TAssaultDeviceUnitType } from "./siege.js";

const SIEGE_UNIT_TEMPLATES: Record<TAssaultDeviceUnitType, TAssaultDeviceTemplate> = {
  "catapult": {
    type: "catapult",
    baseHp: 10,
    baseAttack: 10,
    baseSpeed: 0.25,
    baseCost: 1_000,
    baseTimeCost: 1,
  },
  "trebuchet": {
    type: "trebuchet",
    baseHp: 15,
    baseAttack: 40,
    baseSpeed: 0,
    baseCost: 5_000,
    baseTimeCost: 2,
  },
  "mantelet": {
    type: "mantelet",
    baseHp: 0,
    baseAttack: 0,
    baseSpeed: 0,
    baseCost: 200,
    baseTimeCost: 0.25,
  },
  "stairs": {
    type: "stairs",
    baseHp: 0,
    baseAttack: 0,
    baseSpeed: 0,
    baseCost: 200,
    baseTimeCost: 0.25,
  },
  "siege-tower": {
    type: "siege-tower",
    baseHp: 100,
    baseAttack: 0,
    baseSpeed: 1,
    baseCost: 2_000,
    baseTimeCost: 2,
  },
  "taran": {
    type: "taran",
    baseHp: 100,
    baseAttack: 20,
    baseSpeed: 1,
    baseCost: 5_000,
    baseTimeCost: 1.5,
  },
};
