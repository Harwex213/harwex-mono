import { createRng } from "./rng";

/**
 * Value noise on an integer lattice, smoothed and summed over several octaves.
 * Perlin would look slightly better, but value noise is a dozen lines and the
 * island only needs blobby, believable height.
 */
type TNoiseField = (x: number, y: number) => number;

const LATTICE = 256;

const smooth = (t: number): number => t * t * (3 - 2 * t);

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const createValueNoise = (seed: number): TNoiseField => {
  const random = createRng(seed);
  const lattice = new Float32Array(LATTICE * LATTICE);
  for (let index = 0; index < lattice.length; index += 1) {
    lattice[index] = random();
  }

  const at = (x: number, y: number): number => {
    const wrappedX = ((x % LATTICE) + LATTICE) % LATTICE;
    const wrappedY = ((y % LATTICE) + LATTICE) % LATTICE;

    return lattice[wrappedY * LATTICE + wrappedX]!;
  };

  return (x, y) => {
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    const fractionX = smooth(x - cellX);
    const fractionY = smooth(y - cellY);
    const top = lerp(at(cellX, cellY), at(cellX + 1, cellY), fractionX);
    const bottom = lerp(at(cellX, cellY + 1), at(cellX + 1, cellY + 1), fractionX);

    return lerp(top, bottom, fractionY);
  };
};

/** Sums `octaves` of `field`, each one twice as fine and half as loud. */
const fractalNoise = (field: TNoiseField, x: number, y: number, octaves: number): number => {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let normaliser = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    total += field(x * frequency, y * frequency) * amplitude;
    normaliser += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return total / normaliser;
};

export type { TNoiseField };
export { createValueNoise, fractalNoise };
