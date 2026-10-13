import type { TPillarId } from "./pillars";

export type TTogglePillarAction = (id: TPillarId) => void;

export type TResetDayAction = () => void;

export type TAppRegistry = {
  togglePillarAction: TTogglePillarAction;
  resetDayAction: TResetDayAction;
};
