import { applyMiddleware, createStore, Middleware } from "redux";
import { TAction, TState } from "./internal/internal.ts";
import { rootReducer } from "./internal/root-reducer.ts";
import { createRootMiddleware, runEpic, stateSignal, type TEpic } from "./internal/root-middleware.ts";

const createDevMiddleware: Middleware = () => (next) => (action) => {
    console.log("devMiddleware:", (action as TAction).type);

    return next(action);
};

const { dispatch: reduxDispatch } = createStore<TState, TAction>(
    rootReducer,
    applyMiddleware(createRootMiddleware as Middleware, createDevMiddleware),
);

const dispatch = reduxDispatch;

export { type TEpic, stateSignal, dispatch, runEpic };
