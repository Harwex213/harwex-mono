import type { Bounds, Province } from "../map/manifest";
import type { ProvinceIndex } from "../map/province-index";

// The country tint: ONE map-sized offscreen canvas (3653 x 2855, 41.7 MB),
// drawn to the existing overlay with a single `drawImage`. A stamp per province
// like `highlight-layer.ts` would cost 1648 `drawImage` calls per frame at fit
// zoom, and the per-frame cost is the one paid 60 times a second during a pan.
//
// Updates repaint ONE PROVINCE BOUNDING BOX at a time through `putImageData`.
// The median box is 2 961 px and the sum of all 1648 boxes is 5 126 902 px —
// half a map scan — so a per-box repaint always beats a 10.4 M pixel rebuild.
// Do not add a "just rebuild everything" threshold.
//
// ---------------------------------------------------------------------------
// Byte order — the same rule `../map/province-index.ts` states at its top.
//
// `ImageData.data` is laid out R, G, B, A, one byte per channel, on every
// platform. A `Uint32Array` VIEW over the same buffer is NOT
// endian-independent. This module never takes such a view: every pixel is
// written as its four bytes. Do not "optimise" that into a u32 write.
// ---------------------------------------------------------------------------

// Sits between the T04 hover fill (alpha 0.22) and the select fill (0.44), so a
// hovered province still reads as hovered on top of its country tint.
const TINT_ALPHA = 0.32;

// T08's selected country. A visible step up from `TINT_ALPHA` that still does
// not swallow the T04 select fill (alpha 112/255 = 0.44 accent gold) drawn on
// top of it. Emphasis costs no new draw call: it only changes the country's word
// in the tint table, and `diffTintWords` then repaints exactly the provinces
// whose word changed.
const SELECTED_TINT_ALPHA = 0.48;

const COLOR_HEX = /^#[0-9a-f]{6}$/i;

type TintSync = { repainted: number; cleared: boolean; created: boolean };

let canvas: HTMLCanvasElement | null = null;
let context: CanvasRenderingContext2D | null = null;
// The words currently ON the canvas, indexed by province id.
let painted: Uint32Array = new Uint32Array(0);
let hasTint = false;

// PURE. `0xAARRGGBB`, forced unsigned with `>>> 0`. **`0` means "no tint"** and
// is unambiguous, because a tinted province always has alpha >= 1.
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

// PURE — no DOM, so it is unit tested in Node. The `<ArrayBuffer>` argument is
// not decoration: the default `ArrayBufferLike` admits a `SharedArrayBuffer`,
// and `new ImageData(...)` rejects that.
//
// THE CRITICAL DIFFERENCE FROM `buildStampPixels`. That one compares against a
// single province's packed colour and leaves every other pixel transparent.
// This one resolves whatever province actually OWNS each pixel and paints that
// province's current tint. It has to: bounding boxes overlap and `putImageData`
// REPLACES the destination rectangle including its alpha, so a tile that left a
// neighbour transparent would erase that neighbour's tint. The consequence is a
// useful property — a box repaint leaves the rectangle globally correct, so
// repainting it twice in one batch is idempotent and order does not matter.
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

// PURE. The ids whose tint has changed, ascending. `wanted` may be longer than
// `painted` — that is the 0 -> 1651 growth when the manifest arrives — and the
// missing entries count as 0.
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

// `document.createElement` stays inside a function body on purpose, so this
// module still imports under Node for `tint-layer.test.ts`.
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
  // The map has not loaded. Nothing can be tinted, so drop whatever is.
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

  // The fast path that makes "delete the only country" one clear instead of
  // 5.1 M pixel writes.
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
      // An id the manifest lacks (1318, 1458, or a hostile stored document).
      // Nothing to draw, but the word is recorded so it is not re-diffed.
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

// `null` while nothing is tinted, so a project with no countries pays exactly
// the T04 overlay cost.
function getTintCanvas(): HTMLCanvasElement | null {
  if (!hasTint) {
    return null;
  }
  return canvas;
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
  diffTintWords,
  disposeTintLayer,
  getTintCanvas,
  syncTintLayer,
  tintWordFor,
  type TintSync,
};
