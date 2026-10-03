import type { TPoint } from "./tech/types";
import type { TSize } from "../store/store";

export type TStartLearningAction = (techId: string) => void;
export type TAdvanceLearningAction = (now: number) => void;
export type TSelectTechAction = (techId: string | null) => void;
export type THoverTechAction = (techId: string | null) => void;
export type TRestartAction = () => void;
export type TZoomCanvasAction = (factor: number, anchor: TPoint) => void;
export type TPanCanvasAction = (dx: number, dy: number) => void;
export type TResizeCanvasAction = (size: TSize) => void;

export type TAppRegistry = {
  startLearningAction: TStartLearningAction;
  advanceLearningAction: TAdvanceLearningAction;
  selectTechAction: TSelectTechAction;
  hoverTechAction: THoverTechAction;
  restartAction: TRestartAction;
  zoomCanvasAction: TZoomCanvasAction;
  panCanvasAction: TPanCanvasAction;
  resizeCanvasAction: TResizeCanvasAction;
};
