type TRng = () => number;

/** mulberry32: small, fast, and good enough for shop rolls and spawn jitter. */
const createRng = (seed: number): TRng => {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const randomRange = (rng: TRng, from: number, to: number): number => from + rng() * (to - from);

const pickOne = <T,>(rng: TRng, items: readonly T[]): T => {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) {
    throw new Error("Cannot pick from an empty list");
  }

  return item;
};

export type { TRng };
export { createRng, pickOne, randomRange };
