import {
  ProvinceIndex,
  shouldSmooth,
  type Province,
  type View,
} from "../../../../domain/index";

// Fills the hovered and the selected province with a stamp built from the province map.
// The stamp follows the exact province shape, with no polygon and no bleed.
// Stamps are cached, because a hover repaints on every boundary crossing.

type HighlightRole = "hover" | "select";
type HighlightRequest = { province: Province; role: HighlightRole };

// `--accent` at two strengths. The colour is baked into the stamp, so the cache key includes the role.
const HOVER_FILL: readonly [number, number, number, number] = [216, 162, 74, 56];
const SELECT_FILL: readonly [number, number, number, number] = [216, 162, 74, 112];

const STAMP_CACHE_LIMIT = 32;

// Evicts the oldest entry first: a Map keeps insertion order.
const stampCache = new Map<string, HTMLCanvasElement>();

// Pure. Compares packed colours, so no per-pixel Map lookup is needed.
// `<ArrayBuffer>` is required: `new ImageData` rejects a SharedArrayBuffer.
function buildStampPixels(
  index: ProvinceIndex,
  province: Province,
  rgba: readonly [number, number, number, number],
): Uint8ClampedArray<ArrayBuffer> {
  const bounds = province.bounds;
  const width = Math.max(0, bounds.width);
  const height = Math.max(0, bounds.height);
  const out = new Uint8ClampedArray(width * height * 4);
  const target = ProvinceIndex.packColor(province.rgb);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (index.packedAt(bounds.x + x, bounds.y + y) !== target) {
        continue;
      }
      const at = (y * width + x) * 4;
      out[at] = rgba[0];
      out[at + 1] = rgba[1];
      out[at + 2] = rgba[2];
      out[at + 3] = rgba[3];
    }
  }

  return out;
}

// `document` is used only inside functions, so the module imports under Node for tests.
function stampFor(
  index: ProvinceIndex,
  province: Province,
  role: HighlightRole,
): HTMLCanvasElement | null {
  const key = province.id + "|" + role;
  const cached = stampCache.get(key);
  if (cached) {
    return cached;
  }

  const bounds = province.bounds;
  // A zero-sized canvas throws on putImageData.
  if (bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }

  const pixels = buildStampPixels(index, province, role === "select" ? SELECT_FILL : HOVER_FILL);
  const canvas = document.createElement("canvas");
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  ctx.putImageData(new ImageData(pixels, bounds.width, bounds.height), 0, 0);

  if (stampCache.size >= STAMP_CACHE_LIMIT) {
    const oldest = stampCache.keys().next();
    if (!oldest.done) {
      stampCache.delete(oldest.value);
    }
  }
  stampCache.set(key, canvas);
  return canvas;
}

// `dw / sw` equals `view.scale`, as in the scene draw, so the stamp matches the art at every zoom.
function drawProvinceHighlight(
  ctx: CanvasRenderingContext2D,
  index: ProvinceIndex,
  request: HighlightRequest,
  view: View,
  dpr: number,
): void {
  const stamp = stampFor(index, request.province, request.role);
  if (!stamp) {
    return;
  }

  const bounds = request.province.bounds;
  ctx.imageSmoothingEnabled = shouldSmooth(view.scale, dpr);
  ctx.drawImage(
    stamp,
    0,
    0,
    bounds.width,
    bounds.height,
    view.x + bounds.x * view.scale,
    view.y + bounds.y * view.scale,
    bounds.width * view.scale,
    bounds.height * view.scale,
  );
}

export {
  buildStampPixels,
  drawProvinceHighlight,
  type HighlightRequest,
};
