import { signal } from "@preact/signals-react";
import { createContext, useContext } from "react";
import type { TDone } from "../domain/persistence";

const createRitualState = (done: TDone) => ({
  done: signal<TDone>(done),
});

const createStore = (done: TDone) => ({
  ritual: createRitualState(done),
});

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => useContext(StoreProvider);

export type { TStore };
export { StoreProvider, createStore, useStore };
