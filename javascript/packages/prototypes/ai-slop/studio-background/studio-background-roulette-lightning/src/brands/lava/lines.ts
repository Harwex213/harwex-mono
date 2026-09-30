// Finds the straight LED lines of the hall in a pixel mask with a Hough transform, so the shader can
// run beams of light along each line on its own. Every line segment gets an id; every pixel of the
// segment knows how far along the segment it sits.
//   R: segment id, 1..255 (0: no segment)
//   G: position along the segment, 0..1
//   B: segment length / 8, in plate pixels

const THETA_STEPS = 360;
// A line needs this many pixels on it to count.
const MIN_VOTES = 70;
// Pixels this far from a found line, in pixels, belong to it.
const LINE_HALF_WIDTH = 3.5;
// A gap this long, in pixels, splits a line into two segments.
const MAX_GAP = 20;
// Shorter segments, or segments with fewer pixels, are glare, not LED lines.
const MIN_SEGMENT = 60;
const MAX_SEGMENTS = 255;
const LENGTH_UNIT = 8;

type LineMap = {
  data: Uint8Array;
  width: number;
  height: number;
  // 1 where a pixel belongs to a segment.
  onLine: Uint8Array;
  count: number;
};

function traceLines(mask: Uint8Array, width: number, height: number): LineMap {
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    n += mask[i] ?? 0;
  }
  const xs = new Int32Array(n);
  const ys = new Int32Array(n);
  let k = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      xs[k] = i % width;
      ys[k] = Math.floor(i / width);
      k++;
    }
  }

  const cos = new Float64Array(THETA_STEPS);
  const sin = new Float64Array(THETA_STEPS);
  for (let t = 0; t < THETA_STEPS; t++) {
    const theta = (t / THETA_STEPS) * Math.PI;
    cos[t] = Math.cos(theta);
    sin[t] = Math.sin(theta);
  }
  const offset = Math.ceil(Math.hypot(width, height)) + 1;
  const bins = offset * 2;
  const acc = new Int32Array(THETA_STEPS * bins);
  const vote = (i: number, amount: number) => {
    const x = xs[i] ?? 0;
    const y = ys[i] ?? 0;
    for (let t = 0; t < THETA_STEPS; t++) {
      const rho = Math.round(x * (cos[t] ?? 0) + y * (sin[t] ?? 0)) + offset;
      acc[t * bins + rho] = (acc[t * bins + rho] ?? 0) + amount;
    }
  };
  for (let i = 0; i < n; i++) {
    vote(i, 1);
  }

  const alive = new Uint8Array(n).fill(1);
  const ids = new Uint8Array(n);
  const along = new Float32Array(n);
  const lengths: number[] = [];
  for (;;) {
    let best = 0;
    let bestVotes = 0;
    for (let j = 0; j < acc.length; j++) {
      const votes = acc[j] ?? 0;
      if (votes > bestVotes) {
        bestVotes = votes;
        best = j;
      }
    }
    if (bestVotes < MIN_VOTES || lengths.length >= MAX_SEGMENTS) {
      break;
    }
    const t = Math.floor(best / bins);
    const rho = (best % bins) - offset;
    const c = cos[t] ?? 0;
    const s = sin[t] ?? 0;
    const members: number[] = [];
    for (let i = 0; i < n; i++) {
      if (alive[i] && Math.abs((xs[i] ?? 0) * c + (ys[i] ?? 0) * s - rho) <= LINE_HALF_WIDTH) {
        members.push(i);
      }
    }
    if (members.length === 0) {
      acc[best] = 0;
      continue;
    }
    // Position of every member along the line direction.
    const position = (i: number) => -(xs[i] ?? 0) * s + (ys[i] ?? 0) * c;
    members.sort((a, b) => position(a) - position(b));
    let start = 0;
    for (let m = 1; m <= members.length; m++) {
      const isEnd = m === members.length || position(members[m] ?? 0) - position(members[m - 1] ?? 0) > MAX_GAP;
      if (!isEnd) {
        continue;
      }
      const from = position(members[start] ?? 0);
      const length = position(members[m - 1] ?? 0) - from;
      if (m - start >= MIN_SEGMENT && length >= MIN_SEGMENT && lengths.length < MAX_SEGMENTS) {
        lengths.push(length);
        for (let q = start; q < m; q++) {
          const i = members[q] ?? 0;
          ids[i] = lengths.length;
          along[i] = (position(i) - from) / length;
        }
      }
      start = m;
    }
    for (const i of members) {
      vote(i, -1);
      alive[i] = 0;
    }
  }

  const data = new Uint8Array(width * height * 4);
  const onLine = new Uint8Array(width * height);
  for (let i = 0; i < n; i++) {
    const id = ids[i] ?? 0;
    if (id === 0) {
      continue;
    }
    const pixel = (ys[i] ?? 0) * width + (xs[i] ?? 0);
    data[pixel * 4] = id;
    data[pixel * 4 + 1] = Math.round((along[i] ?? 0) * 255);
    data[pixel * 4 + 2] = Math.min(255, Math.round((lengths[id - 1] ?? 0) / LENGTH_UNIT));
    data[pixel * 4 + 3] = 255;
    onLine[pixel] = 1;
  }
  dilate(data, width, height, 2);
  return { data, width, height, onLine, count: lengths.length };
}

// Grows every segment by a few pixels, so the soft edge of a line reads the segment too.
function dilate(data: Uint8Array, width: number, height: number, steps: number): void {
  const neighbours = [-1, 1, -width, width];
  for (let step = 0; step < steps; step++) {
    const source = data.slice();
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const pixel = y * width + x;
        if (source[pixel * 4]) {
          continue;
        }
        for (const d of neighbours) {
          const from = (pixel + d) * 4;
          if (source[from]) {
            data.set(source.subarray(from, from + 4), pixel * 4);
            break;
          }
        }
      }
    }
  }
}

export type { LineMap };

export { LENGTH_UNIT, traceLines };
