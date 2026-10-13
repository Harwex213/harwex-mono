import { effect } from "@preact/signals-react";
import type { TStore } from "../store/store";
import type { TPillarId } from "./pillars";

const STORAGE_KEY = "hw-method-kalovcev/v1";

type TDone = Partial<Record<TPillarId, boolean>>;

type TSaved = {
  day: string;
  done: TDone;
};

const today = () => new Date().toDateString();

// A new day starts a new ritual: marks from yesterday do not carry over.
const loadRitual = (): TDone => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const saved = JSON.parse(raw) as TSaved;
    if (saved.day !== today()) {
      return {};
    }
    return saved.done;
  } catch {
    return {};
  }
};

const startPersistence = (store: TStore) => {
  effect(() => {
    const saved: TSaved = { day: today(), done: store.ritual.done.value };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Private mode or blocked storage: the ritual still works for this visit.
    }
  });
};

export type { TDone };
export { loadRitual, startPersistence };
