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

function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
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

async function downloadPng(canvas: HTMLCanvasElement, filename: string): Promise<void> {
  download(await toPngBlob(canvas), filename);
}

function downloadJson(value: unknown, filename: string): void {
  const text = JSON.stringify(value, null, 2);

  download(new Blob([text], { type: "application/json" }), filename);
}

function baseName(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, "") || "map";
}

export { baseName, download, downloadJson, downloadPng, toPngBlob };
