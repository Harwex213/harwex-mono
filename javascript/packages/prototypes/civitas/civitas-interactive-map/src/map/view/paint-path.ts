// PURE. The integer line walk that stops a fast drag from skipping provinces
// between two pointer samples.
//
// A pointermove at 60 Hz during a flick jumps 100+ CSS pixels, which at the
// 0.317 fit scale is over 300 map pixels — dozens of provinces. Sampling only
// the event's own pixel leaves holes through the painted region.

// The cost is bounded no matter how far the pointer jumped. Above the cap the
// walk subsamples, which can skip a one-pixel-wide province on a
// viewport-length flick; a full-viewport flick at fit scale is about 3 000 map
// pixels, so the cap is unreachable in practice.
const MAX_PATH_SAMPLES = 4096;

// Visits integer map pixels from (x0, y0) to (x1, y1) inclusive. Returns the
// number of samples taken. A non-finite coordinate visits nothing.
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
