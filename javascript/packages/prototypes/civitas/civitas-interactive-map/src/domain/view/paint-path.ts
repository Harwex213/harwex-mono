// Integer line walk between two pointer samples. A fast drag jumps hundreds of
// map pixels per event, so painting only the event pixel would leave holes.

// Bounds the cost of one walk. A full-viewport flick is about 3000 map pixels,
// so the cap is not reached in practice.
const MAX_PATH_SAMPLES = 4096;

// Visits (x0, y0) to (x1, y1) inclusive and returns the sample count.
function samplePathPixels(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (x: number, y: number) => void,
): number {
  if (
    !Number.isFinite(x0) ||
    !Number.isFinite(y0) ||
    !Number.isFinite(x1) ||
    !Number.isFinite(y1)
  ) {
    return 0;
  }

  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) {
    visit(Math.round(x0), Math.round(y0));
    return 1;
  }

  const count = Math.min(Math.round(steps), MAX_PATH_SAMPLES);
  for (let at = 0; at <= count; at += 1) {
    const t = at / count;
    visit(Math.round(x0 + dx * t), Math.round(y0 + dy * t));
  }
  return count + 1;
}

export { MAX_PATH_SAMPLES, samplePathPixels };
