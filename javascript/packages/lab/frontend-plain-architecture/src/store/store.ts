import { signal } from "@preact/signals-react";
import { createContext, useContext } from "react";

const createButtonState = () => ({
  count: signal(0),
})

const createStore = () => ({
  buttonState: createButtonState(),
});

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => useContext(StoreProvider);

export type { TStore };
export { StoreProvider, createStore, useStore };
