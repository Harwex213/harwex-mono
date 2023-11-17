import { TWithMapEditorState, TWithMapState } from "../map/map.ts";

type TAction<T extends object = object> = {
    type: string;
    payload: T;
};

type TReducer<S, A extends TAction = TAction> = (state: S, action: A) => S;

type TSlice = [(...args: any[]) => TAction<any>, TReducer<TState, TAction<any>>][];

type TState = TWithMapState & TWithMapEditorState;

export { type TState, type TSlice, type TReducer, type TAction };
