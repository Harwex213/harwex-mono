import { EMPTY_OBJECT } from "@/shared.ts";

export const SET_MAP_RESOLUTION_ACTION = "@@MAP/SET_MAP_RESOLUTION";

export const RESET_MAP_RESOLUTION_ACTION = "@@MAP/RESET_MAP_RESOLUTION";

export const setMapResolutionAction = (width: number, height: number) => ({
    type: SET_MAP_RESOLUTION_ACTION,
    payload: { width, height },
});

export const resetMapResolutionAction = () => ({
    type: RESET_MAP_RESOLUTION_ACTION,
    payload: EMPTY_OBJECT,
});
