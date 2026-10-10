import { signal } from "@preact/signals-react";
import { createContext, useContext } from "react";
import type { TCategoryId, TThought } from "../domain/thought";

type TDeletedThought = {
  thought: TThought;
  index: number;
};

type TPulse = {
  category: TCategoryId;
  at: number;
};

type TInitialState = {
  thoughts: TThought[];
  activeCategory: TCategoryId;
};

const createStore = (initial: TInitialState) => ({
  // One array for all categories. The order inside a category is the order of its items in this array.
  thoughts: signal<TThought[]>(initial.thoughts),
  activeCategory: signal<TCategoryId>(initial.activeCategory),
  lastDeleted: signal<TDeletedThought | null>(null),
  // A tab plays a short bump animation when a thought moves into its category.
  pulse: signal<TPulse | null>(null),
});

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => useContext(StoreProvider);

export type { TDeletedThought, TInitialState, TPulse, TStore };
export { StoreProvider, createStore, useStore };
