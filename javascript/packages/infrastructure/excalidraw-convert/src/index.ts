import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { sceneToMarkdown } from "./markdown.js";
import type { MarkdownImage, MarkdownOptions, MarkdownResult } from "./markdown.js";
import { createRenderer } from "./renderer.js";
import type { ImageFormat, PngResult, RenderOptions, RenderResult, Renderer, SceneInput, SvgResult } from "./renderer.js";
import { parseScene } from "./scene.js";
import type { ExcalidrawElement, ExcalidrawScene } from "./scene.js";

type FileRenderOptions = RenderOptions & {
  /* Defaults to the extension of `output`, then to `svg`. */
  format?: ImageFormat;
};

type FileRenderResult = RenderResult & {
  input: string;
  output: string;
};

function formatFor(output: string, format?: ImageFormat): ImageFormat {
  if (format) {
    return format;
  }
  const extension = extname(output).toLowerCase();
  if (extension === ".png") {
    return "png";
  }
  if (extension === ".svg") {
    return "svg";
  }
  return "svg";
}

/* One-shot helpers. Each launches and closes its own browser — for more than a
 * couple of scenes, hold a `createRenderer()` instead. */
async function excalidrawToSvg(scene: SceneInput, options: RenderOptions = {}): Promise<string> {
  const renderer = await createRenderer();
  try {
    const result = await renderer.renderToSvg(scene, options);
    return result.svg;
  } finally {
    await renderer.close();
  }
}

async function excalidrawToPng(scene: SceneInput, options: RenderOptions = {}): Promise<Buffer> {
  const renderer = await createRenderer();
  try {
    const result = await renderer.renderToPng(scene, options);
    return result.png;
  } finally {
    await renderer.close();
  }
}

type MarkdownFileOptions = MarkdownOptions & RenderOptions & {
  /* Describe the pictures but do not draw them. The links stay in the markdown. */
  drawImages?: boolean;
};

type MarkdownFileResult = {
  input: string;
  output: string;
  images: MarkdownImage[];
};

/*
 * Draws every picture a markdown conversion asked for. They go through one
 * renderer, because a renderer is one browser launch.
 */
async function drawMarkdownImages(
  images: MarkdownImage[],
  options: RenderOptions & { imageFormat?: ImageFormat } = {},
): Promise<void> {
  if (images.length === 0) {
    return;
  }
  const format = options.imageFormat ?? "svg";
  const renderer = await createRenderer();
  try {
    for (const image of images) {
      await mkdir(dirname(image.file), { recursive: true });
      if (format === "png") {
        const result = await renderer.renderToPng(image.scene, options);
        await writeFile(image.file, result.png);
        continue;
      }
      const result = await renderer.renderToSvg(image.scene, options);
      await writeFile(image.file, result.svg, "utf8");
    }
  } finally {
    await renderer.close();
  }
}

/*
 * Scene in, markdown file out, with a picture next to it for every block that
 * holds other blocks.
 */
async function renderMarkdownFile(
  input: string,
  output: string,
  options: MarkdownFileOptions = {},
): Promise<MarkdownFileResult> {
  const source = await readFile(input);
  const { markdown, images } = sceneToMarkdown(source, {
    ...options,
    markdownDir: options.markdownDir ?? dirname(output),
    namePrefix: options.namePrefix ?? `${basename(output, extname(output))}-diagram`,
  });
  if (options.drawImages !== false) {
    await drawMarkdownImages(images, options);
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, markdown, "utf8");
  return { input, output, images };
}

async function renderExcalidrawFile(
  input: string,
  output: string,
  options: FileRenderOptions = {},
): Promise<FileRenderResult> {
  const format = formatFor(output, options.format);
  const source = await readFile(input);
  const renderer = await createRenderer();
  try {
    await mkdir(dirname(output), { recursive: true });
    if (format === "png") {
      const result = await renderer.renderToPng(source, options);
      await writeFile(output, result.png);
      return { format, width: result.width, height: result.height, input, output };
    }
    const result = await renderer.renderToSvg(source, options);
    await writeFile(output, result.svg, "utf8");
    return { format, width: result.width, height: result.height, input, output };
  } finally {
    await renderer.close();
  }
}

export {
  createRenderer,
  drawMarkdownImages,
  excalidrawToPng,
  excalidrawToSvg,
  parseScene,
  renderExcalidrawFile,
  renderMarkdownFile,
  sceneToMarkdown,
};
export type {
  ExcalidrawElement,
  ExcalidrawScene,
  FileRenderOptions,
  FileRenderResult,
  ImageFormat,
  MarkdownFileOptions,
  MarkdownFileResult,
  MarkdownImage,
  MarkdownOptions,
  MarkdownResult,
  PngResult,
  RenderOptions,
  RenderResult,
  Renderer,
  SceneInput,
  SvgResult,
};
