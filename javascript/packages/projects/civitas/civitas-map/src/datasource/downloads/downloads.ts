import { encodePng } from "../images/images";

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

function createDownloads(): Downloads {
  return {
    async downloadPixelsPng(pixels, width, height, filename): Promise<void> {
      download(await encodePng(pixels, width, height), filename);
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
