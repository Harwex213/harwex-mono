import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { chromium } from "playwright";
import type { Browser, Page } from "playwright";
import { buildBrowserBundle, resolveAssetRoot } from "./browser-bundle.js";
import { parseScene } from "./scene.js";
import type { ExcalidrawElement, ExcalidrawScene } from "./scene.js";

type SceneInput = string | Buffer | object;

type ImageFormat = "png" | "svg";

type RenderOptions = {
  /* Draw `viewBackgroundColor` behind the scene instead of leaving it transparent. */
  background?: boolean;
  /* Overrides the scene's own `viewBackgroundColor`. */
  backgroundColor?: string;
  /* Render with Excalidraw's dark theme. */
  darkMode?: boolean;
  /* Blank margin around the scene bounds, in scene units. */
  padding?: number;
  /* Pixel multiplier. Applies to PNG only; SVG carries its own coordinates. */
  scale?: number;
  /* Crop to one frame element, addressed by its id or its name. */
  frame?: string;
  /* PNG only, 0..1, passed to `canvas.toBlob`. */
  quality?: number;
  /* Milliseconds allowed for the page to produce the image. */
  timeoutMs?: number;
};

type RenderResult = {
  format: "png" | "svg";
  width: number;
  height: number;
};

type SvgResult = RenderResult & {
  format: "svg";
  svg: string;
};

type PngResult = RenderResult & {
  format: "png";
  png: Buffer;
};

type Renderer = {
  renderToSvg: (scene: SceneInput, options?: RenderOptions) => Promise<SvgResult>;
  renderToPng: (scene: SceneInput, options?: RenderOptions) => Promise<PngResult>;
  close: () => Promise<void>;
};

const PAGE_ORIGIN = "https://excalidraw-render.invalid";

const DEFAULT_TIMEOUT_MS = 60_000;

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const PAGE_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>excalidraw-convert</title>
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        background: transparent;
      }
    </style>
    <script>
      window.EXCALIDRAW_ASSET_PATH = "/";
    </script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

function contentTypeFor(pathname: string): string {
  const type = MIME_TYPES[extname(pathname).toLowerCase()];
  return type ?? "application/octet-stream";
}

/*
 * Everything the page asks for is served from memory or from the installed
 * `@excalidraw/excalidraw` dist. A request that escapes that directory is a bug,
 * not a resource, so it is refused rather than resolved.
 */
async function readAsset(assetRoot: string, pathname: string): Promise<Buffer | undefined> {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
  if (relative.startsWith(`..${sep}`) || relative === "..") {
    return undefined;
  }
  try {
    return await readFile(join(assetRoot, relative));
  } catch {
    return undefined;
  }
}

function findFrame(elements: ExcalidrawElement[], frame: string): ExcalidrawElement {
  const match = elements.find((element) => {
    if (element.type !== "frame" && element.type !== "magicframe") {
      return false;
    }
    return element.id === frame || element.name === frame;
  });
  if (!match) {
    throw new Error(`Scene has no frame with id or name "${frame}"`);
  }
  return match;
}

function buildAppState(scene: ExcalidrawScene, options: RenderOptions): Record<string, unknown> {
  const background = options.background ?? true;
  const viewBackgroundColor = options.backgroundColor
    ?? (scene.appState.viewBackgroundColor as string | undefined)
    ?? "#ffffff";
  return {
    ...scene.appState,
    exportBackground: background,
    exportEmbedScene: false,
    exportScale: options.scale ?? 1,
    exportWithDarkMode: options.darkMode ?? false,
    viewBackgroundColor,
  };
}

/*
 * The PNG comes back from the page as base64, so its pixel size is read straight
 * out of the IHDR chunk rather than paid for with a second round trip.
 */
function readPngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Rendered PNG is malformed: no IHDR chunk");
  }
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

async function openPage(browser: Browser, assetRoot: string, bundle: string): Promise<Page> {
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  const page = await context.newPage();

  /*
   * Playwright matches routes in reverse registration order, so the catch-all
   * goes first and the origin handler, registered after it, wins. Anything the
   * origin handler does not serve would be a CDN call, and a build step must not
   * depend on one.
   */
  await page.route("**/*", async (route) => {
    await route.abort("blockedbyclient");
  });

  await page.route(`${PAGE_ORIGIN}/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/" || pathname === "/index.html") {
      await route.fulfill({ body: PAGE_HTML, contentType: "text/html; charset=utf-8" });
      return;
    }
    const asset = await readAsset(assetRoot, pathname);
    if (!asset) {
      await route.fulfill({ status: 404, body: "not found", contentType: "text/plain" });
      return;
    }
    await route.fulfill({ body: asset, contentType: contentTypeFor(pathname) });
  });

  await page.goto(`${PAGE_ORIGIN}/index.html`, { waitUntil: "domcontentloaded" });

  /*
   * The bundle is injected rather than served: a `route.fulfill` body of this
   * size crawls over the CDP connection, while `addScriptTag` takes well under a
   * second.
   */
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => {
    return Boolean((globalThis as Record<string, unknown>).__excalidrawExport);
  });
  return page;
}

type ExportPayload = {
  elements: ExcalidrawElement[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
  exportPadding: number;
  exportingFrame: ExcalidrawElement | null;
  quality: number;
  scale: number;
};

function buildPayload(scene: ExcalidrawScene, options: RenderOptions): ExportPayload {
  return {
    elements: scene.elements,
    appState: buildAppState(scene, options),
    files: scene.files,
    exportPadding: options.padding ?? 10,
    exportingFrame: options.frame ? findFrame(scene.elements, options.frame) : null,
    quality: options.quality ?? 1,
    scale: options.scale ?? 1,
  };
}

function readSvgSize(svg: string): { width: number; height: number } {
  const width = /\swidth="([\d.]+)"/.exec(svg);
  const height = /\sheight="([\d.]+)"/.exec(svg);
  return {
    width: width ? Number(width[1]) : 0,
    height: height ? Number(height[1]) : 0,
  };
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Excalidraw export timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, guard]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/*
 * Keeps one Chromium and one prepared page alive. Rendering many scenes through
 * a single renderer costs one browser launch instead of one per file.
 */
async function createRenderer(): Promise<Renderer> {
  const assetRoot = resolveAssetRoot();
  const bundle = await buildBrowserBundle();
  const browser = await chromium.launch({ headless: true });
  const page = await openPage(browser, assetRoot, bundle);
  const failures: string[] = [];
  page.on("pageerror", (error) => {
    failures.push(error.message);
  });

  async function run(scene: SceneInput, options: RenderOptions, format: "png" | "svg"): Promise<string> {
    const payload = buildPayload(parseScene(scene), options);
    failures.length = 0;
    try {
      return await withTimeout(
        page.evaluate((input) => {
          return (globalThis as Record<string, any>).__excalidrawExport.render(input);
        }, { payload, format }),
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
    } catch (error) {
      const detail = failures.length > 0 ? `\nPage errors: ${failures.join("; ")}` : "";
      throw new Error(`Excalidraw export failed: ${(error as Error).message}${detail}`);
    }
  }

  return {
    async renderToSvg(scene, options = {}) {
      const svg = await run(scene, options, "svg");
      return { format: "svg", svg, ...readSvgSize(svg) };
    },
    async renderToPng(scene, options = {}) {
      const base64 = await run(scene, options, "png");
      const png = Buffer.from(base64, "base64");
      return { format: "png", png, ...readPngSize(png) };
    },
    async close() {
      await browser.close();
    },
  };
}

export { createRenderer, PAGE_ORIGIN };
export type { ImageFormat, PngResult, RenderOptions, RenderResult, Renderer, SceneInput, SvgResult };
