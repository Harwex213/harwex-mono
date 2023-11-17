import { Reducer } from "redux";
import { TAction, TReducer, TSlice, TState } from "./internal.ts";
import { initialState } from "./initial-state.ts";
import { mapSlice } from "../map/map-reducers.ts";

const createRootReducer = (...sliceDeclarations: TSlice[]): Reducer<TState, TAction> => {
    const actionToReducer = new Map<string, TReducer<TState>>();

    for (const sliceDeclaration of sliceDeclarations) {
        for (const [actionCreator, reducer] of sliceDeclaration) {
            const type = actionCreator().type;
            if (actionToReducer.has(type)) {
                throw new Error("Such reducer with type '" + type + "' already exists");
            }
            actionToReducer.set(type, reducer);
        }
    }

    return (state, action) => {
        const reducer = actionToReducer.get(action.type);
        return reducer && state ? reducer(state, action) : initialState;
    };
};

const sliceDeclarations: TSlice[] = [mapSlice];

const rootReducer = createRootReducer(...sliceDeclarations);

export { rootReducer };
