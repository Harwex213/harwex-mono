import { type Observable, Subject } from "rxjs";
import type { Dispatch, MiddlewareAPI } from "redux";
import { signal } from "@preact/signals-react";
import type { TAction, TState } from "./internal.ts";
import { initialState } from "./initial-state.ts";

type TEpic = (action$: Observable<TAction>) => Observable<TAction>;

const actions$ = new Subject<TAction>();

const stateSignal = signal<TState>(initialState);

interface EpicMiddleware {
    (api: MiddlewareAPI<Dispatch, TState>): (next: (action: unknown) => TAction) => (action: TAction) => TAction;
}

const createRootMiddleware: EpicMiddleware = (store) => (next) => (action) => {
    let result = next(action);

    actions$.next(action);

    stateSignal.value = store.getState();

    return result;
};

const runEpic = (rootEpic: TEpic, dispatch: Dispatch<TAction>) => {
    const actionsFromEpic$ = rootEpic(actions$.asObservable());

    actionsFromEpic$.subscribe((next) => {
        dispatch(next);
    });
};

export { type TEpic, stateSignal, createRootMiddleware, runEpic };
