import type { TRng } from "./rng";

/**
 * Seeded 3D Perlin noise and its fractal sum. The world generator reads it at
 * cell centres to cluster islands into archipelagos.
 */

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const gradient = (hash: number, x: number, y: number, z: number) => {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;

  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
};

type TNoise3 = (x: number, y: number, z: number) => number;

/** Improved Perlin noise over a permutation shuffled by the seed. */
const createPerlin = (rng: TRng): TNoise3 => {
  const base = Array.from({ length: 256 }, (_, index) => index);
  for (let index = base.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rng() * (index + 1));
    const swap = base[index] as number;
    base[index] = base[other] as number;
    base[other] = swap;
  }

  const perm = new Uint8Array(512);
  for (let index = 0; index < 512; index += 1) {
    perm[index] = base[index & 255] as number;
  }

  return (x, y, z) => {
    const floorX = Math.floor(x);
    const floorY = Math.floor(y);
    const floorZ = Math.floor(z);
    const X = floorX & 255;
    const Y = floorY & 255;
    const Z = floorZ & 255;
    const fx = x - floorX;
    const fy = y - floorY;
    const fz = z - floorZ;
    const u = fade(fx);
    const v = fade(fy);
    const w = fade(fz);

    const A = (perm[X] as number) + Y;
    const AA = (perm[A] as number) + Z;
    const AB = (perm[A + 1] as number) + Z;
    const B = (perm[X + 1] as number) + Y;
    const BA = (perm[B] as number) + Z;
    const BB = (perm[B + 1] as number) + Z;

    return lerp(
      lerp(
        lerp(gradient(perm[AA] as number, fx, fy, fz), gradient(perm[BA] as number, fx - 1, fy, fz), u),
        lerp(gradient(perm[AB] as number, fx, fy - 1, fz), gradient(perm[BB] as number, fx - 1, fy - 1, fz), u),
        v,
      ),
      lerp(
        lerp(gradient(perm[AA + 1] as number, fx, fy, fz - 1), gradient(perm[BA + 1] as number, fx - 1, fy, fz - 1), u),
        lerp(
          gradient(perm[AB + 1] as number, fx, fy - 1, fz - 1),
          gradient(perm[BB + 1] as number, fx - 1, fy - 1, fz - 1),
          u,
        ),
        v,
      ),
      w,
    );
  };
};

/** Fractal sum of octaves, normalised back to roughly -1..1. */
const fbm = (noise: TNoise3, x: number, y: number, z: number, octaves: number) => {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    sum += noise(x * frequency, y * frequency, z * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }

  return (sum / total) * 1.6;
};

export type { TNoise3 };
export { createPerlin, fbm };
