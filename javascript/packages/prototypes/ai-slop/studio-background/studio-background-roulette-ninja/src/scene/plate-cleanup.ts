// Removes the crimson neon line around the video wall from the studio plate.
// The line is ~4 px wide with almost no glow, so each of its pixels is replaced by a blend
// of the plate 5 px to either side of it, plus a faint gunmetal trim where the line was.

// Line centres in plate pixels, measured on the red-minus-max(g,b) profile.
const LEFT_X = 351.8;
const RIGHT_X = 1184.3;
const TOP_Y = 130.6;
const BOTTOM_Y = 531;
const REACH = 5;
const TRIM = 9;

function cleanPlate(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("2d context unavailable");
  }
  ctx.drawImage(image, 0, 0);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = frame.data;
  const width = canvas.width;

  const index = (x: number, y: number): number => (y * width + x) * 4;

  const bridge = (a: number, b: number, target: number, t: number, offset: number): void => {
    const trim = TRIM * Math.exp(-(offset * offset) / 1.3);
    for (let ch = 0; ch < 3; ch++) {
      const va = data[a + ch] ?? 0;
      const vb = data[b + ch] ?? 0;
      data[target + ch] = va + (vb - va) * t + trim * (ch === 2 ? 1.1 : 1);
    }
  };

  // Horizontal lines first, skipping the corners; the vertical pass then covers the corners
  // and samples pixels the first pass has already cleaned.
  const x0 = Math.ceil(LEFT_X + REACH);
  const x1 = Math.floor(RIGHT_X - REACH);
  for (const cy of [TOP_Y, BOTTOM_Y]) {
    const above = Math.round(cy - REACH);
    const below = Math.round(cy + REACH);
    for (let x = x0; x <= x1; x++) {
      for (let y = above + 1; y < below; y++) {
        bridge(index(x, above), index(x, below), index(x, y), (y - above) / (below - above), y - cy);
      }
    }
  }
  const y0 = Math.floor(TOP_Y - REACH - 1);
  const y1 = Math.ceil(BOTTOM_Y + REACH + 1);
  for (const cx of [LEFT_X, RIGHT_X]) {
    const left = Math.round(cx - REACH);
    const right = Math.round(cx + REACH);
    for (let y = y0; y <= y1; y++) {
      for (let x = left + 1; x < right; x++) {
        bridge(index(left, y), index(right, y), index(x, y), (x - left) / (right - left), x - cx);
      }
    }
  }
  ctx.putImageData(frame, 0, 0);
  return canvas;
}

export { cleanPlate };
