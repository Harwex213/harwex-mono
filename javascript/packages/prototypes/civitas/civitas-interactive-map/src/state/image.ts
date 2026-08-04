// Uploads are downscaled and re-encoded before they enter the document, because
// the whole document has to fit inside a ~5 MB localStorage quota.
//
// Every DOM call sits inside a function body, following `decodeProvincePixels`
// in `src/map/province-index.ts`, so `image.test.ts` can import this module in
// Node and test the pure halves.

const FLAG_MAX_EDGE = 256;
const PROVINCE_IMAGE_MAX_EDGE = 320;
const IMAGE_QUALITY = 0.82;
// 256 KB of decoded payload per image.
const IMAGE_TARGET_BYTES = 262144;
const QUALITY_STEPS: readonly number[] = [0.82, 0.7, 0.55, 0.4];

const BASE64_DATA_URL = /^data:[^,]*;base64,/;

type FitResult = {
  width: number;
  height: number;
  scaled: boolean;
};

// Never upscales. A `{ 0, 0, false }` result means the input had no usable
// dimensions and the caller treats it as a failure.
function fitDownscale(width: number, height: number, maxEdge: number): FitResult {
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(maxEdge)) {
    return { width: 0, height: 0, scaled: false };
  }
  if (width <= 0 || height <= 0 || maxEdge <= 0) {
    return { width: 0, height: 0, scaled: false };
  }

  const longest = Math.max(width, height);
  if (longest <= maxEdge) {
    return { width, height, scaled: false };
  }

  const ratio = maxEdge / longest;
  // The `max(1, ...)` is load bearing. A 1 x 4000 strip rounds its short edge to
  // 0 and `drawImage` then throws.
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    scaled: true,
  };
}

// Decoded payload size of a base64 data URL, without decoding it.
function dataUrlBytes(dataUrl: string): number {
  if (typeof dataUrl !== "string" || !BASE64_DATA_URL.test(dataUrl)) {
    return 0;
  }
  const comma = dataUrl.indexOf(",");
  const payload = dataUrl.slice(comma + 1);
  if (payload.length === 0) {
    return 0;
  }
  let padding = 0;
  if (payload.endsWith("==")) {
    padding = 2;
  } else if (payload.endsWith("=")) {
    padding = 1;
  }
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function encodeCanvas(canvas: HTMLCanvasElement, mime: string, quality: number): string {
  return canvas.toDataURL(mime, quality);
}

function drawInto(
  canvas: HTMLCanvasElement,
  bitmap: ImageBitmap,
  width: number,
  height: number,
): void {
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("a 2d canvas context is unavailable");
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
}

// The only way an image enters the store. `setProvinceImage` and
// `updateCountry` validate a data URL's prefix and length; they do not resize.
async function downscaleImage(file: Blob, maxEdge: number, quality?: number): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("the file is not a readable image");
  }

  try {
    const target = fitDownscale(bitmap.width, bitmap.height, maxEdge);
    if (target.width === 0 || target.height === 0) {
      throw new Error("the image has no pixels");
    }

    const canvas = document.createElement("canvas");
    drawInto(canvas, bitmap, target.width, target.height);

    // `toDataURL` silently returns PNG for a type the browser cannot encode, so
    // the prefix of the first result is the probe. WebP is preferred because it
    // keeps alpha — a flag with a transparent background turns black under JPEG.
    const requested = quality ?? IMAGE_QUALITY;
    const steps = QUALITY_STEPS.filter((step) => {
      return step <= requested;
    });
    const ladder = steps.length > 0 ? steps : [QUALITY_STEPS[QUALITY_STEPS.length - 1] as number];

    let mime = "image/webp";
    let best = encodeCanvas(canvas, mime, ladder[0] as number);
    if (!best.startsWith("data:image/webp")) {
      mime = "image/jpeg";
      best = encodeCanvas(canvas, mime, ladder[0] as number);
    }
    if (dataUrlBytes(best) <= IMAGE_TARGET_BYTES) {
      return best;
    }

    for (let at = 1; at < ladder.length; at += 1) {
      const encoded = encodeCanvas(canvas, mime, ladder[at] as number);
      if (dataUrlBytes(encoded) < dataUrlBytes(best)) {
        best = encoded;
      }
      if (dataUrlBytes(best) <= IMAGE_TARGET_BYTES) {
        return best;
      }
    }

    // One last redraw at half the edge. The loop is bounded at five encodes;
    // there is no `while` on size.
    const half = fitDownscale(target.width, target.height, Math.max(1, Math.floor(maxEdge / 2)));
    if (half.width > 0 && half.height > 0) {
      drawInto(canvas, bitmap, half.width, half.height);
      const encoded = encodeCanvas(canvas, mime, ladder[ladder.length - 1] as number);
      if (dataUrlBytes(encoded) < dataUrlBytes(best)) {
        best = encoded;
      }
    }
    return best;
  } finally {
    bitmap.close();
  }
}

export {
  FLAG_MAX_EDGE,
  IMAGE_QUALITY,
  IMAGE_TARGET_BYTES,
  PROVINCE_IMAGE_MAX_EDGE,
  QUALITY_STEPS,
  dataUrlBytes,
  downscaleImage,
  fitDownscale,
  type FitResult,
};
