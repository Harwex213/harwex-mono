import type { TArmy } from "./army.js";

export type TWarPhaseActionMove = {
  type: "move";
  armyId: string;
  targetProvinceId: string;
}

export type TWarPhaseActionRetreat = {
  type: "retreat";
  armyId: string;
  targetProvinceId: string;
}

export type TWarPhaseActionFight = {
  type: "fight";
  armyId: string;
}

export type TWarPhaseActionSiege = {
  type: "siege";
  armyId: string;
};

export type TWarPhaseActionAssault = {
  type: "siege";
  armyId: string;
};

export type TWarPhaseActionPillage = {};

export type TWarPhaseAction = |
  TWarPhaseActionMove |
  TWarPhaseActionRetreat |
  TWarPhaseActionFight |
  TWarPhaseActionSiege |
  TWarPhaseActionAssault |
  TWarPhaseActionPillage;

export type TWarPhase = {
  phase: number;
  armies: Record<string, TArmy>;
  actionRounds: TWarPhaseAction[][];
};
