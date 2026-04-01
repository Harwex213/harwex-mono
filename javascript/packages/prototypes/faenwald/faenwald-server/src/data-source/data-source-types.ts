import {
  TArmyUnitKind,
  TArmyUnitModifier,
  TArmyUnitRank,
  TArmyUnitType,
  THouse,
  TWarPhaseAction
} from "@hw/faenwald-core";

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

export type TSerializedArmyUnit = {
  kind: TArmyUnitKind;
  type: TArmyUnitType;
  amount: number;
  stripes: number;
  rank: TArmyUnitRank;
  modifiers: TArmyUnitModifier[];
  houseId: string;
}

export type TSerializedArmy = {
  id: string;
  units: TSerializedArmyUnit[];
  provinceId: string;
}

export type TWarPhaseSerialized = {
  phase: number;
  armies: Record<string, TSerializedArmy>;
};

export type TWarPhaseActionSerialized = {
  phase: number;
  actions: TWarPhaseAction[][];
};

export type TWarPhaseDataSource = {
  phase: number;
  armies: Record<string, TSerializedArmy>;
  actions: TWarPhaseAction[][];
};
