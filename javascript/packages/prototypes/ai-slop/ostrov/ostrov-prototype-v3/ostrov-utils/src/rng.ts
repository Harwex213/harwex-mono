/** Deterministic 32-bit generator (mulberry32). Same seed, same result. */
const createRng = (seed: number) => {
  let state = seed >>> 0;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  const range = (min: number, max: number) => min + next() * (max - min);

  /** Integer in `[min, max]`, both ends included. */
  const int = (min: number, max: number) => Math.floor(range(min, max + 1));

  return { next, range, int };
};

type TRng = ReturnType<typeof createRng>;

/** Folds a text seed into a 32-bit number (FNV-1a). */
const hashSeed = (text: string) => {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
};

/** Mixes extra numbers into a seed, for per-tile generators. */
const mixSeed = (seed: number, ...parts: number[]) => {
  let hash = seed >>> 0;

  for (const part of parts) {
    hash = Math.imul(hash ^ (part + 0x9e3779b9), 0x85ebca6b) >>> 0;
  }

  return hash >>> 0;
};

/** Fisher-Yates over a copy of the list, driven by the given generator. */
const shuffled = <TItem>(items: readonly TItem[], rng: TRng): TItem[] => {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = rng.int(0, index);
    const held = copy[index]!;

    copy[index] = copy[swap]!;
    copy[swap] = held;
  }

  return copy;
};

export type { TRng };
export { createRng, hashSeed, mixSeed, shuffled };
