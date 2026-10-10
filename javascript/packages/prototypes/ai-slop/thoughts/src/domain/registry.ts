import type { TCategoryId } from "./thought";

export type TAddThoughtAction = (text: string) => void;
export type TDeleteThoughtAction = (id: string) => void;
export type TUpdateThoughtTextAction = (id: string, text: string) => void;
export type TMoveThoughtAction = (id: string, category: TCategoryId) => void;
export type TReorderThoughtAction = (id: string, toIndex: number) => void;
export type TRestoreDeletedAction = () => void;
export type TDismissDeletedAction = () => void;
export type TSetActiveCategoryAction = (category: TCategoryId) => void;

export type TAppRegistry = {
  addThoughtAction: TAddThoughtAction;
  deleteThoughtAction: TDeleteThoughtAction;
  updateThoughtTextAction: TUpdateThoughtTextAction;
  moveThoughtAction: TMoveThoughtAction;
  reorderThoughtAction: TReorderThoughtAction;
  restoreDeletedAction: TRestoreDeletedAction;
  dismissDeletedAction: TDismissDeletedAction;
  setActiveCategoryAction: TSetActiveCategoryAction;
};
