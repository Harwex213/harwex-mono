import { effect } from "@preact/signals-react";
import type { TInitialState, TStore } from "../store/store";
import { createId, isCategoryId } from "./thought";
import type { TCategoryId, TThought } from "./thought";

const STORAGE_KEY = "hw-thoughts/v1";
const SAVE_DELAY_MS = 250;

type TSavedState = {
  thoughts: TThought[];
  activeCategory: TCategoryId;
};

const parseThought = (raw: unknown): TThought | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const thought = raw as Record<string, unknown>;
  if (typeof thought.id !== "string" || typeof thought.text !== "string" || !isCategoryId(thought.category)) {
    return null;
  }

  return {
    id: thought.id,
    text: thought.text,
    category: thought.category,
    createdAt: typeof thought.createdAt === "number" ? thought.createdAt : Date.now(),
    updatedAt: typeof thought.updatedAt === "number" ? thought.updatedAt : Date.now(),
  };
};

const createWelcomeThoughts = (): TThought[] => {
  const now = Date.now();
  const rows: Array<[TCategoryId, string]> = [
    ["goals", "Тап по строке — редактировать"],
    ["goals", "Свайп влево — перенести в другую вкладку"],
    ["goals", "Подержи и тяни — поменять порядок"],
    ["learn", "Как устроен localStorage"],
    ["dreams", "Увидеть северное сияние"],
  ];

  return rows.map(([category, text]) => ({
    id: createId(),
    text,
    category,
    createdAt: now,
    updatedAt: now,
  }));
};

const loadState = (): TInitialState => {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = null;
  }

  if (raw === null) {
    return {
      thoughts: createWelcomeThoughts(),
      activeCategory: "goals",
    };
  }

  try {
    const saved = JSON.parse(raw) as Partial<TSavedState>;

    return {
      thoughts: Array.isArray(saved.thoughts) ? saved.thoughts.map(parseThought).filter((item) => item !== null) : [],
      activeCategory: isCategoryId(saved.activeCategory) ? saved.activeCategory : "goals",
    };
  } catch {
    return {
      thoughts: [],
      activeCategory: "goals",
    };
  }
};

const saveState = (store: TStore) => {
  const saved: TSavedState = {
    thoughts: store.thoughts.peek(),
    activeCategory: store.activeCategory.peek(),
  };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch (error) {
    console.warn("[thoughts] Could not save", error);
  }
};

const startPersistence = (store: TStore) => {
  let timer: number | null = null;

  const flush = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    saveState(store);
  };

  const dispose = effect(() => {
    store.thoughts.value;
    store.activeCategory.value;
    if (timer !== null) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(flush, SAVE_DELAY_MS);
  });

  // Mobile browsers may kill a background tab without warning, so save when the page hides.
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      flush();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", flush);

  return () => {
    dispose();
    flush();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", flush);
  };
};

export { loadState, startPersistence };
