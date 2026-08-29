/**
 * `mulberry32`: a small deterministic generator. The same seed always rebuilds
 * the same island, so a seed in the UI is enough to share a map.
 */
const createRng = (seed: number) => {
  let state = seed >>> 0;

  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

export { createRng };
