/**
 * A seeded generator, so a nickname always grows the same island and a bug is
 * reproducible from the seed alone.
 */

type TRng = () => number;

const HASH_PRIME_1 = 0x9e3779b9;
const HASH_PRIME_2 = 0x85ebca6b;
const HASH_PRIME_3 = 0xc2b2ae35;

/** mulberry32: small, fast, good enough for terrain. */
const createRng = (seed: number): TRng => {
  let state = seed >>> 0;

  return () => {
    state = (state + HASH_PRIME_1) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

/** Turns any string into a seed, so `createRng(hashSeed(nickname))` is stable. */
const hashSeed = (text: string) => {
  let hash = HASH_PRIME_2;

  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), HASH_PRIME_3);
    hash = (hash << 13) | (hash >>> 19);
  }

  return hash >>> 0;
};

const randomInt = (rng: TRng, minInclusive: number, maxInclusive: number) => {
  return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
};

const pick = <T,>(rng: TRng, items: readonly T[]): T => {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) {
    throw new Error("Cannot pick from an empty list");
  }

  return item;
};

/** Picks by weight. `weightOf` must never return a negative number. */
const pickWeighted = <T,>(rng: TRng, items: readonly T[], weightOf: (item: T) => number): T => {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  let threshold = rng() * total;

  for (const item of items) {
    threshold -= weightOf(item);
    if (threshold <= 0) {
      return item;
    }
  }

  return pick(rng, items);
};

export type { TRng };
export { createRng, hashSeed, pick, pickWeighted, randomInt };
