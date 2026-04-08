import type { TWarEvent_Battle, TWarEvent_FortressAssault } from "./battle.js";
import type { TArmyUnit, TArmyUnitKind, TArmyUnitType } from "./army.js";

export type TWarEvent_ProvincePillaged = {
  type: "TWarEvent_ProvincePillaged";
  eventId: string;
  armyId: string;
  percent: number;
};

export type TWarEvent_SiegeStarted = {
  type: "TWarEvent_SiegeStarted";
  eventId: string;
  provinceId: string;
  armies: string[]; // armyId[]
};

export type TWarEvent_ArmyMoved = {
  type: "TWarEvent_ArmyMoved";
  eventId: string;
  armyId: string;
  newProvinceId: string;
};

export type TWarEvent_ArmyMoveCommand = {
  type: "TWarEvent_ArmyMoveCommand";
  eventId: string;
  armyId: string;
  movement: string[]; // provinceId[]
};

export type TWarEvent_UnitStartCreating = {
  type: "TWarEvent_UnitStartCreating";
  eventId: string;
  houseId: string;
  provinceId: string;
  unitKind: TArmyUnitKind;
  unitType: TArmyUnitType;
  amount: number;
};

export type TWarEvent_UnitCreated = {
  type: "TWarEvent_UnitCreated";
  eventId: string;
  armyId: string;
  unit: TArmyUnit;
};

export type TWarEvent_ArmyCorrection = {
  type: "TWarEvent_ArmyCorrection";
  eventId: string;
  armyId: string;
  deletedUnits: string[];
  addedUnits: TArmyUnit[];
};

export type TGameTurnPhaseWarEvent = {
  type: "war";
  event: |
    TWarEvent_ProvincePillaged |
    TWarEvent_Battle |
    TWarEvent_FortressAssault |
    TWarEvent_SiegeStarted |
    TWarEvent_ArmyMoved |
    TWarEvent_ArmyMoveCommand |
    TWarEvent_ArmyCorrection |
    TWarEvent_UnitStartCreating |
    TWarEvent_UnitCreated;
};
