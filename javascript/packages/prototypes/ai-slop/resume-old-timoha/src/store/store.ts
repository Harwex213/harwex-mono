import { signal } from "@preact/signals-react";
import { createContext, useContext } from "react";

const createOfferState = () => ({
  hired: signal(false),
  // Monthly salary of one candidate, in BYN. The duo takes the same one salary.
  salary: signal(1500),
});

const createStore = () => ({
  offer: createOfferState(),
});

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => useContext(StoreProvider);

export type { TStore };
export { StoreProvider, createStore, useStore };
