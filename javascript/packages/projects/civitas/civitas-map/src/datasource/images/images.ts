// Image decoding through the browser: `createImageBitmap` and a 2D canvas. The
// map image becomes an `ImageBitmap` the renderer draws; a provinces export and
// the base map become raw pixels the layer and the detector read.

type LoadedMap = {
  bitmap: ImageBitmap;
  name: string;
  width: number;
  height: number;
};

type ImageCodec = {
  decodeMap(image: Blob, name: string): Promise<LoadedMap>;
  // The pixels of a provinces image as layer words. Refuses an image whose size
  // is not the map's: every province in it would land somewhere else.
  decodeProvinces(image: Blob, width: number, height: number): Promise<Uint32Array>;
  // The RGBA bytes of the loaded map, for border detection.
  readMapPixels(bitmap: ImageBitmap): Uint8ClampedArray;
  // Layer words as a PNG, bit-exact.
  encodePng(pixels: Readonly<Uint32Array>, width: number, height: number): Promise<Blob>;
};

function drawToContext(bitmap: ImageBitmap): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");

  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (!ctx) {
    throw new Error("2d canvas context unavailable");
  }

  // Untransformed and unsmoothed, so this is a pixel-for-pixel copy.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0);

  return ctx;
}

// `createImageBitmap` decodes off the main thread, which matters because the
// maps here run to tens of megapixels and an `<img>` decode blocks the frame.
async function decodeMap(image: Blob, name: string): Promise<LoadedMap> {
  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(image);
  } catch {
    throw new Error(`${name} could not be decoded as an image`);
  }

  return { bitmap, name, width: bitmap.width, height: bitmap.height };
}

async function decodeProvinces(image: Blob, width: number, height: number): Promise<Uint32Array> {
  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(image);
  } catch {
    throw new Error("the province image could not be decoded");
  }

  try {
    if (bitmap.width !== width || bitmap.height !== height) {
      throw new Error(
        `the province image is ${bitmap.width}×${bitmap.height}, the map is ${width}×${height}`,
      );
    }

    const data = drawToContext(bitmap).getImageData(0, 0, width, height).data;

    return new Uint32Array(data.buffer as ArrayBuffer);
  } finally {
    bitmap.close();
  }
}

// The base map is opaque, so reading it back is exact — unlike reading a
// part-transparent layer, where the canvas store is premultiplied.
function readMapPixels(bitmap: ImageBitmap): Uint8ClampedArray {
  return drawToContext(bitmap).getImageData(0, 0, bitmap.width, bitmap.height).data;
}

// Encodes layer words as a PNG.
function encodePng(pixels: Readonly<Uint32Array>, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return Promise.reject(new Error("2d canvas context unavailable"));
  }

  // The layer words and the canvas bytes share one buffer layout on any machine:
  // `colors.ts` packs words in the order the canvas expects.
  const bytes = new Uint8ClampedArray(pixels.slice().buffer as ArrayBuffer);

  ctx.putImageData(new ImageData(bytes, width, height), 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);

        return;
      }

      reject(new Error("canvas.toBlob produced nothing"));
      // PNG only. A province map is read back by exact colour, so a lossy
      // encoder would rename every province it touched.
    }, "image/png");
  });
}

function createImageCodec(): ImageCodec {
  return { decodeMap, decodeProvinces, readMapPixels, encodePng };
}

export {
  createImageCodec,
  encodePng,
  type ImageCodec,
  type LoadedMap,
};
