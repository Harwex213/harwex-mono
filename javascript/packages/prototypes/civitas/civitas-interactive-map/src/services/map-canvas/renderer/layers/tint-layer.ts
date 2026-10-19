import { shouldSmooth, sourceRect } from "../../../../domain/index";
import type { Bounds, Country, Province, ProvinceIndex, Size, View } from "../../../../domain/index";

// Country tint layer.
// Decisions:
// - One map-sized offscreen canvas, drawn with one `drawImage` per frame.
//   A stamp per province would cost 1648 draw calls per frame during a pan.
// - An update repaints one province bounding box at a time. All boxes together are half the map,
//   so a full rebuild never wins.
// - Pixels are written byte by byte. A `Uint32Array` view over `ImageData` depends on endianness.

// Between the hover fill (0.22) and the select fill (0.44), so a hover still shows over the tint.
const TINT_ALPHA = 0.32;

// The selected country. Stronger than `TINT_ALPHA`, but the select fill on top still shows.
// Emphasis only changes the tint words, so it needs no extra draw call.
const SELECTED_TINT_ALPHA = 0.48;

const COLOR_HEX = /^#[0-9a-f]{6}$/i;

type TintSync = { repainted: number; cleared: boolean; created: boolean };

let canvas: HTMLCanvasElement | null = null;
let context: CanvasRenderingContext2D | null = null;
// The words now on the canvas, indexed by province id.
let painted: Uint32Array = new Uint32Array(0);
let hasTint = false;

// Pure. Returns unsigned `0xAARRGGBB`. `0` means no tint: a real tint has alpha >= 1.
function tintWordFor(colorHex: string, alpha: number): number {
  if (typeof colorHex !== "string" || !COLOR_HEX.test(colorHex)) {
    return 0;
  }
  if (!Number.isFinite(alpha) || alpha <= 0) {
    return 0;
  }
  const a = Math.min(255, Math.max(1, Math.round(alpha * 255)));
  const r = Number.parseInt(colorHex.slice(1, 3), 16);
  const g = Number.parseInt(colorHex.slice(3, 5), 16);
  const b = Number.parseInt(colorHex.slice(5, 7), 16);
  return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

// Pure. One word per province id. Index 0 is `NO_PROVINCE` and stays 0.
// `emphasisCountryId` is the selected country. It only gets a higher alpha.
function buildTintWordTable(
  list: readonly Country[],
  max: number,
  emphasisCountryId?: number | null,
  emphasisAlpha?: number,
): Uint32Array {
  const out = new Uint32Array(Math.max(0, max) + 1);
  const emphasisId = emphasisCountryId ?? null;
  for (const country of list) {
    const alpha =
      country.id === emphasisId ? (emphasisAlpha ?? SELECTED_TINT_ALPHA) : TINT_ALPHA;
    const word = tintWordFor(country.colorHex, alpha);
    if (word === 0) {
      continue;
    }
    for (const provinceId of country.provinceIds) {
      if (provinceId >= 1 && provinceId <= max) {
        out[provinceId] = word;
      }
    }
  }
  return out;
}

// Pure. `<ArrayBuffer>` is required: `new ImageData` rejects a SharedArrayBuffer.
// Paints the tint of whichever province owns each pixel, not only the target province.
// Boxes overlap, and `putImageData` replaces alpha too, so a transparent neighbour would erase that tint.
// As a result a box repaint is idempotent and order-independent.
function buildTintPixels(
  index: ProvinceIndex,
  bounds: Bounds,
  wordOf: (provinceId: number) => number,
): Uint8ClampedArray<ArrayBuffer> {
  const width = Math.max(0, bounds.width);
  const height = Math.max(0, bounds.height);
  const out = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const id = index.provinceAt(bounds.x + x, bounds.y + y);
      if (id === null) {
        continue;
      }
      const word = wordOf(id);
      if (word === 0) {
        continue;
      }
      const at = (y * width + x) * 4;
      out[at] = (word >>> 16) & 0xff;
      out[at + 1] = (word >>> 8) & 0xff;
      out[at + 2] = word & 0xff;
      out[at + 3] = (word >>> 24) & 0xff;
    }
  }

  return out;
}

// Pure. Ids whose tint changed, ascending. Missing entries of the shorter array count as 0.
function diffTintWords(paintedWords: Uint32Array, wanted: Uint32Array): number[] {
  const out: number[] = [];
  const limit = Math.max(paintedWords.length, wanted.length);
  for (let id = 0; id < limit; id += 1) {
    const now = id < paintedWords.length ? paintedWords[id] : 0;
    const next = id < wanted.length ? wanted[id] : 0;
    if (now !== next) {
      out.push(id);
    }
  }
  return out;
}

function anyNonZero(words: Uint32Array): boolean {
  for (let at = 0; at < words.length; at += 1) {
    if (words[at] !== 0) {
      return true;
    }
  }
  return false;
}

// `document` is used only inside functions, so the module imports under Node for tests.
function ensureCanvas(index: ProvinceIndex): boolean {
  if (canvas && context) {
    return true;
  }
  const created = document.createElement("canvas");
  created.width = index.width;
  created.height = index.height;
  const ctx = created.getContext("2d");
  if (!ctx) {
    return false;
  }
  canvas = created;
  context = ctx;
  painted = new Uint32Array(0);
  hasTint = false;
  return true;
}

function syncTintLayer(
  index: ProvinceIndex,
  words: Uint32Array,
  lookup: (provinceId: number) => Province | null,
): TintSync {
  // The map has not loaded, so drop any tint.
  if (words.length <= 1) {
    if (context && canvas && hasTint) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      painted = new Uint32Array(painted.length);
      hasTint = false;
      return { repainted: 0, cleared: true, created: false };
    }
    return { repainted: 0, cleared: false, created: false };
  }

  const existed = canvas !== null;
  if (!ensureCanvas(index)) {
    return { repainted: 0, cleared: false, created: false };
  }
  const created = !existed;
  const ctx = context as CanvasRenderingContext2D;
  const surface = canvas as HTMLCanvasElement;

  if (painted.length < words.length) {
    const grown = new Uint32Array(words.length);
    grown.set(painted);
    painted = grown;
  }

  // Fast path: with no tint left, one clear replaces millions of pixel writes.
  const wanted = anyNonZero(words);
  if (!wanted) {
    if (!hasTint) {
      return { repainted: 0, cleared: false, created };
    }
    ctx.clearRect(0, 0, surface.width, surface.height);
    painted = new Uint32Array(painted.length);
    hasTint = false;
    return { repainted: 0, cleared: true, created };
  }

  const wordOf = (provinceId: number): number => {
    return provinceId >= 0 && provinceId < words.length ? words[provinceId] : 0;
  };

  let repainted = 0;
  for (const id of diffTintWords(painted, words)) {
    const nextWord = wordOf(id);
    const province = lookup(id);
    if (province === null) {
      // An id the manifest lacks. Record the word, so the id is not diffed again.
      painted[id] = nextWord;
      continue;
    }
    const bounds = province.bounds;
    if (bounds.width <= 0 || bounds.height <= 0) {
      painted[id] = nextWord;
      continue;
    }
    const pixels = buildTintPixels(index, bounds, wordOf);
    ctx.putImageData(new ImageData(pixels, bounds.width, bounds.height), bounds.x, bounds.y);
    painted[id] = nextWord;
    repainted += 1;
  }

  hasTint = true;
  return { repainted, cleared: false, created };
}

// `null` while nothing is tinted, so a map with no countries skips the tint draw.
function getTintCanvas(): HTMLCanvasElement | null {
  if (!hasTint) {
    return null;
  }
  return canvas;
}

// `view` is the snapped view of the art draw, or the tint sits off the map.
// `tintSize` is the map size, not the art size: the tint canvas is built from `ProvinceIndex`.
function drawTint(
  ctx: CanvasRenderingContext2D,
  tint: CanvasImageSource,
  tintSize: Size,
  view: View,
  viewport: Size,
  dpr: number,
): void {
  const rect = sourceRect(view, viewport, tintSize);
  if (!rect) {
    return;
  }
  // The art smoothing rule, so a magnified tint keeps sharp province edges.
  ctx.imageSmoothingEnabled = shouldSmooth(view.scale, dpr);
  ctx.drawImage(tint, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
}

function disposeTintLayer(): void {
  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }
  canvas = null;
  context = null;
  painted = new Uint32Array(0);
  hasTint = false;
}

export {
  SELECTED_TINT_ALPHA,
  TINT_ALPHA,
  buildTintPixels,
  buildTintWordTable,
  diffTintWords,
  disposeTintLayer,
  drawTint,
  getTintCanvas,
  syncTintLayer,
  tintWordFor,
  type TintSync,
};
