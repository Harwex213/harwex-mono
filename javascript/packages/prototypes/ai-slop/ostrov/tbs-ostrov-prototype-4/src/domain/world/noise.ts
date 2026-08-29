/**
 * Value noise on an integer lattice, plus the usual octave stack on top. The
 * island shape comes from this field, so it has to be seed-stable and smooth.
 */

/** Hash of a lattice point to `0..1`. No state, so any point can be sampled. */
const hash2 = (x: number, y: number, seed: number): number => {
  let hash = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);

  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
};

/** Smoothstep, so neighbouring cells blend instead of stepping. */
const fade = (t: number): number => t * t * (3 - 2 * t);

const valueNoise = (x: number, y: number, seed: number): number => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);

  const topLeft = hash2(x0, y0, seed);
  const topRight = hash2(x0 + 1, y0, seed);
  const bottomLeft = hash2(x0, y0 + 1, seed);
  const bottomRight = hash2(x0 + 1, y0 + 1, seed);

  const top = topLeft + (topRight - topLeft) * fx;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * fx;

  return top + (bottom - top) * fy;
};

/** Octaves of `valueNoise`, normalised back to `0..1`. */
const fbm = (x: number, y: number, seed: number, octaves: number): number => {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let normaliser = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    total += amplitude * valueNoise(x * frequency, y * frequency, seed + octave * 1013);
    normaliser += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  return total / normaliser;
};

export { fbm, valueNoise };
