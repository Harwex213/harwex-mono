import type { TRng } from "./rng";

/**
 * Value noise on a 256x256 lattice with smoothstep interpolation, summed over
 * several octaves. Cheap, seedable and smooth enough for a coastline.
 */
const LATTICE = 256;
const LATTICE_MASK = LATTICE - 1;

type TNoiseField = (x: number, y: number) => number;

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const createValueNoise = (rng: TRng): TNoiseField => {
  const lattice = new Float32Array(LATTICE * LATTICE);

  for (let index = 0; index < lattice.length; index += 1) {
    lattice[index] = rng();
  }

  const at = (x: number, y: number): number => lattice[(y & LATTICE_MASK) * LATTICE + (x & LATTICE_MASK)]!;

  return (x, y) => {
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    const fractionX = smoothstep(x - cellX);
    const fractionY = smoothstep(y - cellY);
    const top = lerp(at(cellX, cellY), at(cellX + 1, cellY), fractionX);
    const bottom = lerp(at(cellX, cellY + 1), at(cellX + 1, cellY + 1), fractionX);

    return lerp(top, bottom, fractionY);
  };
};

/**
 * Standard deviation of one smoothstep-interpolated value-noise layer. Blending
 * four lattice corners narrows the uniform 0..1 spread a lot, which is why the
 * number is well under the 0.289 of the raw lattice.
 */
const OCTAVE_SIGMA = 0.19;

/** Deviations of the sum mapped onto the edges of the 0..1 output range. */
const SIGMA_RANGE = 2.6;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Fractal sum of `octaves` value-noise layers, each one twice as fine and half
 * as loud as the one before.
 *
 * Summing octaves piles up independent layers, so the sum bunches around its
 * mean much more tightly than one layer does. Dividing by the sum of amplitudes
 * would leave a field that hardly ever reaches the ends of `0..1`, and a
 * coastline cut out of such a field stays a circle. The sum is normalised by its
 * own standard deviation instead, which restores the full range.
 */
const createFbm = (rng: TRng, octaves: number, persistence: number): TNoiseField => {
  const field = createValueNoise(rng);
  const offsetX = rng() * LATTICE;
  const offsetY = rng() * LATTICE;

  let energy = 0;
  let amplitude = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    energy += amplitude * amplitude;
    amplitude *= persistence;
  }

  const gain = 0.5 / (SIGMA_RANGE * OCTAVE_SIGMA * Math.sqrt(energy));

  return (x, y) => {
    let sum = 0;
    let frequency = 1;
    let weight = 1;

    for (let octave = 0; octave < octaves; octave += 1) {
      sum += (field((x + offsetX) * frequency, (y + offsetY) * frequency) - 0.5) * weight;
      frequency *= 2;
      weight *= persistence;
    }

    return clamp01(0.5 + sum * gain);
  };
};

export type { TNoiseField };
export { createFbm, createValueNoise };
