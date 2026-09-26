import type { TRng } from "./types";

/**
 * The one random source of the prototype. Everything seeded goes through here,
 * so two runs with the same seed see the same board (plan §7).
 */

const MULBERRY_INCREMENT = 0x6d2b79f5;
const UINT32_DIVISOR = 4294967296;
const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

const createRng = (seed: number): TRng => {
  let state = Math.floor(seed) >>> 0;
  if (state === 0) {
    state = 1;
  }
  const next = (): number => {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_DIVISOR;
  };
  const int = (min: number, max: number): number => {
    if (max <= min) {
      return min;
    }
    return min + Math.floor(next() * (max - min + 1));
  };
  const pick = <T,>(items: readonly T[]): T => {
    const item = items[int(0, items.length - 1)];
    if (item === undefined) {
      throw new Error("createRng.pick: the list is empty");
    }
    return item;
  };
  return { next, int, pick };
};

/** A stable 32-bit hash of a string. Used where a pure function needs a seed but holds no state. */
const hashString = (text: string): number => {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
};

/** The same hash mapped into [0, 1). */
const hashUnit = (text: string): number => {
  return hashString(text) / UINT32_DIVISOR;
};

export { createRng, hashString, hashUnit };
