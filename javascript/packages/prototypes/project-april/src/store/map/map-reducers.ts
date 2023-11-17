import { TReducer, TSlice, TState } from "../internal/internal.ts";
import { mapInitialState } from "./map.ts";
import { resetMapResolutionAction, setMapResolutionAction } from "./map-actions.ts";

const setMapResolutionReducer: TReducer<TState, ReturnType<typeof setMapResolutionAction>> = (state, { payload }) => ({
    ...state,
    map: {
        ...state.map,
        width: state.map.width + payload.width,
        height: state.map.height + payload.height,
    },
});

const resetMapResolutionReducer: TReducer<TState, ReturnType<typeof resetMapResolutionAction>> = (state) => ({
    ...state,
    map: {
        ...state.map,
        width: mapInitialState.width,
        height: mapInitialState.height,
    },
});

const mapSlice: TSlice = [
    [setMapResolutionAction, setMapResolutionReducer],
    [resetMapResolutionAction, resetMapResolutionReducer],
];

export { mapSlice };
