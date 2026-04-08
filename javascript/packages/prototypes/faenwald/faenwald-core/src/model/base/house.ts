import type { TModifierImplication, TModifierSource } from "./modifier.js";

export type THouseModifierProperty = |
  "warFatigue";

export type THouseModifier = {
  id: string;
  name: string;
  source: TModifierSource;
  implications: TModifierImplication<THouseModifierProperty>[];
};

export type THouse = {
  id: number;
  name: string;
  playerVkId: string;
  // leader: string;
  authority: number;
  domain: string[]; // provinceId[]
  vassals: string[]; // houseId[]
};
