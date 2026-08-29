/** Deterministic 32-bit PRNG. Same seed, same map, on every machine. */
type TRng = () => number;

const createRng = (seed: number): TRng => {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

/** Turns a user-typed seed string into the 32-bit number `createRng` wants. */
const hashSeed = (seed: string): number => {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const randomSeed = (): string => Math.floor(Math.random() * 0xffffffff).toString(36);

const randomInRange = (rng: TRng, min: number, max: number): number => min + rng() * (max - min);

export type { TRng };
export { createRng, hashSeed, randomInRange, randomSeed };
