import type { TStoredPick } from "./types";

const STORAGE_KEY = "cs-map-picker:picks";

// Storage can be blocked (private window): the app then keeps picks for this tab only.
const readStoredPicks = (): TStoredPick[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as TStoredPick[]) : [];
  } catch {
    return [];
  }
};

const writeStoredPicks = (picks: TStoredPick[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(picks));
  } catch {
    // storage blocked
  }
};

export { readStoredPicks, writeStoredPicks };
