// Hands files to the browser's downloads: the provinces PNG and its manifest.

type Downloads = {
  // Encodes layer words as a PNG and downloads it.
  downloadPixelsPng(pixels: Readonly<Uint32Array>, width: number, height: number, filename: string): Promise<void>;
  downloadJson(value: unknown, filename: string): void;
};

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  // Revoked on the next tick rather than immediately: Safari reads the object
  // URL after the click handler returns.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function pixelsToPngBlob(pixels: Readonly<Uint32Array>, width: number, height: number): Promise<Blob> {
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

function createDownloads(): Downloads {
  return {
    async downloadPixelsPng(pixels, width, height, filename): Promise<void> {
      download(await pixelsToPngBlob(pixels, width, height), filename);
    },
    downloadJson(value, filename): void {
      const text = JSON.stringify(value, null, 2);

      download(new Blob([text], { type: "application/json" }), filename);
    },
  };
}

export {
  createDownloads,
  type Downloads,
};
