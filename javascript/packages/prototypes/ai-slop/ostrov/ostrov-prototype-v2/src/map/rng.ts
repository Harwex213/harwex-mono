/** Deterministic 32-bit PRNG (mulberry32). Same seed, same stream, always. */
type Rng = () => number;

function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hashes tile coordinates into a seed. Decoration is drawn from this, so a tile
 * keeps the exact same trees and boulders across pans, zooms and reloads.
 */
function hashCoords(q: number, r: number, salt: number): number {
  let value = Math.imul(q | 0, 0x27d4eb2d) ^ Math.imul(r | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
}

/** Picks an index from a weight table using one draw of `rng`. */
function weightedPick(rng: Rng, weights: readonly number[]): number {
  let total = 0;
  for (const weight of weights) {
    total += weight;
  }
  let roll = rng() * total;
  for (let index = 0; index < weights.length; index += 1) {
    roll -= weights[index]!;
    if (roll <= 0) {
      return index;
    }
  }
  return weights.length - 1;
}

export type { Rng };
export { createRng, hashCoords, weightedPick };
