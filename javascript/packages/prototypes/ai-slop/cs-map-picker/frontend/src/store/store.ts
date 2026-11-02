import { computed, signal } from "@preact/signals-react";
import { createContext, useContext } from "react";
import { readStoredPicks } from "../domain/storage";
import type { TMeta, TPickView, TRoute, TStoredPick } from "../domain/types";

const createPickState = () => {
  const view = signal<TPickView | null>(null);
  const loadError = signal<string | null>(null);
  const actionError = signal<string | null>(null);
  const selectedMap = signal<string | null>(null);
  const busy = signal(false);
  // The live update stream of the open pick. Not a signal: the UI never reads it.
  const connection = { source: null as EventSource | null };

  return { view, loadError, actionError, selectedMap, busy, connection };
};

const createStore = () => {
  const storedPicks = signal<TStoredPick[]>(readStoredPicks());
  const route = signal<TRoute>({ name: "home" });
  const pick = createPickState();

  // This browser's seat in the open pick, or null for a spectator.
  const session = computed(() => {
    const current = route.value;
    if (current.name !== "pick") {
      return null;
    }
    return storedPicks.value.find((stored) => stored.id === current.id) ?? null;
  });

  return {
    route,
    meta: signal<TMeta | null>(null),
    metaError: signal<string | null>(null),
    storedPicks,
    myPickViews: signal<TPickView[]>([]),
    formError: signal<string | null>(null),
    formBusy: signal(false),
    pick,
    session,
  };
};

type TStore = ReturnType<typeof createStore>;

const StoreProvider = createContext<TStore>(null!);

const useStore = () => useContext(StoreProvider);

export type { TStore };
export { StoreProvider, createStore, useStore };
