import { exportToBlob, exportToSvg } from "@excalidraw/excalidraw";

/*
 * Everything below runs inside the Playwright page. The whole export routine
 * lives in this bundle rather than being shipped in through `page.evaluate`,
 * because the Node side is compiled by esbuild with `keepNames` — a function
 * serialised from there reaches the page referencing a `__name` helper that was
 * left behind.
 */

/*
 * Excalidraw registers its hand-drawn fonts as `FontFace`s while it exports, so
 * `document.fonts.ready` has to settle before the bitmap is taken. Otherwise the
 * text falls back to a system font and shifts.
 */
const render = async (input) => {
  const { payload, format } = input;
  const args = {
    elements: payload.elements,
    appState: payload.appState,
    files: payload.files,
    exportPadding: payload.exportPadding,
    exportingFrame: payload.exportingFrame ?? undefined,
  };

  await document.fonts.ready;

  if (format === "svg") {
    const svg = await exportToSvg(args);
    await document.fonts.ready;
    return svg.outerHTML;
  }

  /*
   * `exportToBlob` ignores `appState.exportScale`; the canvas size comes from
   * `getDimensions`.
   */
  const scale = payload.scale;
  const blob = await exportToBlob({
    ...args,
    mimeType: "image/png",
    quality: payload.quality,
    getDimensions: (width, height) => {
      return {
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        scale,
      };
    },
  });

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

window.__excalidrawExport = { render };
