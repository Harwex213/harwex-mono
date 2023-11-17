import { TState } from "./internal.ts";
import { mapInitialState } from "../map/map.ts";

const initialState: TState = {
    map: mapInitialState,
    mapEditor: {
        nextRegionId: 0,
    },
};

export { initialState };
