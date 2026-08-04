import { packRgb } from "../map/province-index";
import { shouldSmooth } from "../map/view";
import type { Province } from "../map/manifest";
import type { ProvinceIndex } from "../map/province-index";
import type { View } from "../map/view";

// The hovered and the selected province are filled by stamping a per-province
// RGBA bitmap built from the province art itself, so the fill has exactly the
// province's ragged shape with no polygon approximation and no bleed.
//
// The largest province bounding box on the real map is 12 642 pixels (median
// 2 960), so building a stamp is a fraction of a millisecond. It is cached
// anyway, because a hover repaints on every boundary crossing.

type HighlightRole = "hover" | "select";
type HighlightRequest = { province: Province; role: HighlightRole };

// --accent (216, 162, 74) at two strengths. Baked into the stamp, which is why
// the cache is keyed by role as well as by province.
const HOVER_FILL: readonly [number, number, number, number] = [216, 162, 74, 56];
const SELECT_FILL: readonly [number, number, number, number] = [216, 162, 74, 112];

const STAMP_CACHE_LIMIT = 32;

// Insertion-ordered, oldest evicted first. A Map preserves insertion order, so
// `keys().next()` is the oldest entry.
const stampCache = new Map<string, HTMLCanvasElement>();

// PURE — no DOM. Compares PACKED colours directly rather than calling
// `provinceAt`, which would pay a Map lookup per pixel for no benefit. A
// neighbouring province inside the same bounding box does not match, so it stays
// fully transparent.
// The `<ArrayBuffer>` argument is not decoration: the default `ArrayBufferLike`
// admits a SharedArrayBuffer, and `new ImageData(...)` rejects that.
function buildStampPixels(
  index: ProvinceIndex,
  province: Province,
  rgba: readonly [number, number, number, number],
): Uint8ClampedArray<ArrayBuffer> {
  const bounds = province.bounds;
  const width = Math.max(0, bounds.width);
  const height = Math.max(0, bounds.height);
  const out = new Uint8ClampedArray(width * height * 4);
  const target = packRgb(province.rgb[0], province.rgb[1], province.rgb[2]);

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

// `document.createElement` stays inside a function body on purpose, so this
// module still imports under Node for `highlight-layer.test.ts`.
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

// Drawn under the CSS-pixel transform `prepare` installed, and `dw / sw` is
// exactly `view.scale` — the same property `sourceRect` gives the scene draw — so
// the stamp lands on the art pixel for pixel at every zoom.
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

function clearHighlightCache(): void {
  stampCache.clear();
}

export {
  HOVER_FILL,
  SELECT_FILL,
  buildStampPixels,
  clearHighlightCache,
  drawProvinceHighlight,
  type HighlightRequest,
  type HighlightRole,
};
