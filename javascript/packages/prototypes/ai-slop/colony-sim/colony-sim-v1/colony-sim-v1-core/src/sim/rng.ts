// Seeded PRNG (mulberry32) — deterministic sim, seed lives in the save.

type Rng = () => number;

// Anything that can hold the stream's position. In practice the World: see stateRng.
interface RngHolder {
  rngState: number;
}

function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The same generator, with its position kept on the world instead of in a closure.
// That is what makes the stream *state* rather than a property of whoever happens to
// be running the sim: a closure restarts on a reload, and two lockstep clients that
// built their engines at different moments would draw different numbers from the same
// tick. On the world it is snapshotted, hashed, and identical everywhere by
// construction — the seed and the command log are then the whole of the world.
//
// The arithmetic is mulberry32's, unchanged: the same seed yields the same sequence
// either way.
function stateRng(holder: RngHolder): Rng {
  return function next(): number {
    let a = holder.rngState | 0;
    a = (a + 0x6d2b79f5) | 0;
    holder.rngState = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: Rng, minInclusive: number, maxExclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxExclusive - minInclusive));
}

export type { Rng, RngHolder };
export { createRng, randInt, stateRng };
